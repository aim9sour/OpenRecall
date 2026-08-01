import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSafeReleaseDirectory,
  collectDependencyLicenseFiles,
  inspectStagingDirectory,
  pnpmDeployArguments,
  releaseArtifactNames,
  sha256File,
  verifySha256,
} from "../../scripts/release/windows-package-core.mjs";
import { parseWindowsPackageArguments } from "../../scripts/package-windows.mjs";

const temporaryRoots: string[] = [];
const repositoryRoot = resolve(import.meta.dirname, "../..");

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openrecall-package-"));
  temporaryRoots.push(root);
  return root;
}

async function write(
  root: string,
  relativePath: string,
  content = "fixture",
): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, content);
}

async function validStagingRoot(): Promise<string> {
  const root = await temporaryRoot();
  await Promise.all(
    [
      "LICENSE",
      "NOTICE",
      "THIRD_PARTY_NOTICES.md",
      "OpenRecall.cmd",
      "OpenRecall-Portable.cmd",
      "Start-OpenRecall.ps1",
      "runtime/node.exe",
      "app/server/src/index.ts",
      "app/server/node_modules/runtime-package/LICENSE",
      "app/web/dist/index.html",
      "licenses/node/LICENSE",
      "licenses/npm/runtime-package/1.0.0/LICENSE",
    ].map((path) => write(root, path)),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe("Windows release artifact contracts", () => {
  it("parses only an explicit stable version and safe absolute output", () => {
    const output = join(repositoryRoot, "release-output");
    expect(
      parseWindowsPackageArguments(
        ["--version", "1.0.0", "--output", output],
        repositoryRoot,
      ),
    ).toEqual({ output: resolve(output), version: "1.0.0" });
    expect(
      parseWindowsPackageArguments(["--version", "1.0.0"], repositoryRoot),
    ).toEqual({
      output: resolve(repositoryRoot, "release-output"),
      version: "1.0.0",
    });
    for (const args of [
      ["--output", output],
      ["--version", "1.0.0", "--output", output, "--unknown"],
    ]) {
      expect(() =>
        parseWindowsPackageArguments(args, repositoryRoot),
      ).toThrow("OPENRECALL_PACKAGE_ARGUMENT_INVALID");
    }
  });

  it("derives stable Windows x64 names from a strict semantic version", () => {
    expect(releaseArtifactNames("1.0.0")).toEqual({
      archive: "OpenRecall-v1.0.0-windows-x64.zip",
      checksum: "OpenRecall-v1.0.0-windows-x64.zip.sha256",
    });
    for (const invalid of ["v1.0.0", "1.0", "1.0.0-beta.1", "../1.0.0"]) {
      expect(() => releaseArtifactNames(invalid)).toThrow(
        "OPENRECALL_PACKAGE_VERSION_INVALID",
      );
    }
  });

  it("requests a production legacy deploy with a physical hoisted tree", () => {
    expect(pnpmDeployArguments("C:\\release staging\\server")).toEqual([
      "--config.node-linker=hoisted",
      "--filter",
      "@openrecall/server",
      "--prod",
      "deploy",
      "C:\\release staging\\server",
      "--legacy",
    ]);
  });

  it("refuses release directories that could erase broad or source paths", async () => {
    const safe = join(repositoryRoot, "release-output");
    expect(assertSafeReleaseDirectory(safe, repositoryRoot)).toBe(
      resolve(safe),
    );
    for (const unsafe of [
      "release-output",
      parse(repositoryRoot).root,
      repositoryRoot,
      resolve(repositoryRoot, ".."),
    ]) {
      expect(() =>
        assertSafeReleaseDirectory(unsafe, repositoryRoot),
      ).toThrow("OPENRECALL_PACKAGE_OUTPUT_UNSAFE");
    }
  });

  it("verifies the archive digest and rejects malformed or mismatched SHA-256", async () => {
    const root = await temporaryRoot();
    const archive = join(root, "artifact.zip");
    await writeFile(archive, "OpenRecall artifact fixture");
    const expected =
      "c3d6cde055609f337c56701066bb321c841afdb32ca44ee680ea4729bae17fce";

    await expect(sha256File(archive)).resolves.toBe(expected);
    await expect(verifySha256(archive, expected)).resolves.toBe(expected);
    await expect(verifySha256(archive, "0".repeat(64))).rejects.toThrow(
      "OPENRECALL_PACKAGE_SHA256_MISMATCH",
    );
    await expect(verifySha256(archive, "not-a-digest")).rejects.toThrow(
      "OPENRECALL_PACKAGE_SHA256_INVALID",
    );
  });

  it("returns a deterministic manifest only when every runtime and notice exists", async () => {
    const root = await validStagingRoot();
    const manifest = await inspectStagingDirectory(root);

    expect(manifest).toEqual([...manifest].sort((left, right) =>
      left.localeCompare(right, "en"),
    ));
    expect(manifest).toContain("runtime/node.exe");
    expect(manifest).toContain("licenses/node/LICENSE");

    await rm(join(root, "NOTICE"));
    await expect(inspectStagingDirectory(root)).rejects.toThrow(
      "OPENRECALL_PACKAGE_REQUIRED_MISSING:NOTICE",
    );
  });

  it.each([
    "Data/openrecall.sqlite3",
    "Data/openrecall.sqlite3-backup",
    "logs/server.log",
    "test-results/trace.zip",
    "app/web/dist/app.js.map",
    ".env.production",
  ])("rejects private or development artifact %s", async (relativePath) => {
    const root = await validStagingRoot();
    await write(root, relativePath);

    await expect(inspectStagingDirectory(root)).rejects.toThrow(
      `OPENRECALL_PACKAGE_FORBIDDEN:${relativePath}`,
    );
  });

  it("copies dependency licenses by package identity and fails closed", async () => {
    const root = await temporaryRoot();
    const nodeModules = join(root, "node_modules");
    const destination = join(root, "licenses");
    await write(
      nodeModules,
      "licensed/package.json",
      JSON.stringify({ name: "licensed", version: "2.3.4", license: "MIT" }),
    );
    await write(nodeModules, "licensed/LICENSE.md", "license text");

    await expect(
      collectDependencyLicenseFiles({
        destination,
        nodeModules,
        repositoryRoot,
      }),
    ).resolves.toEqual(["licensed@2.3.4"]);
    await expect(
      readFile(
        join(destination, "licensed", "2.3.4", "LICENSE.md"),
        "utf8",
      ),
    ).resolves.toBe("license text");

    await write(
      nodeModules,
      "missing/package.json",
      JSON.stringify({ name: "missing", version: "1.0.0", license: "MIT" }),
    );
    await expect(
      collectDependencyLicenseFiles({
        destination,
        nodeModules,
        repositoryRoot,
      }),
    ).rejects.toThrow(
      "OPENRECALL_PACKAGE_DEPENDENCY_LICENSE_MISSING:missing@1.0.0",
    );
  });
});
