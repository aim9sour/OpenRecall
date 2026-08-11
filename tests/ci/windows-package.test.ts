import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSafeReleaseDirectory,
  collectDependencyLicenseFiles,
  inspectStagingDirectory,
  pnpmDeployArguments,
  releaseArtifactNames,
  removeDependencySourceMaps,
  sha256File,
  verifySha256,
} from "../../scripts/release/windows-package-core.mjs";
import { parseWindowsPackageArguments } from "../../scripts/package-windows.mjs";
import {
  cmdLauncherArguments,
  cmdLauncherSpawnOptions,
  extractWindowsArchive,
  launcherOutputIsReady,
  parseWindowsSmokeArguments,
  prepareLauncherControlDirectory,
  windowsSmokeCleanupOptions,
} from "../../scripts/smoke-windows-package.mjs";

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
      "LauncherHost.mjs",
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
  it("uses the root manifest version unless a safe explicit version overrides it", async () => {
    const output = join(repositoryRoot, "release-output");
    const repositoryVersion = JSON.parse(
      await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
    ).version;
    await expect(
      parseWindowsPackageArguments([], repositoryRoot),
    ).resolves.toEqual({
      output: resolve(repositoryRoot, "release-output"),
      version: repositoryVersion,
    });
    await expect(
      parseWindowsPackageArguments(["--output", output], repositoryRoot),
    ).resolves.toEqual({
      output: resolve(output),
      version: repositoryVersion,
    });
    await expect(
      parseWindowsPackageArguments(
        ["--version", "2.0.0", "--output", output],
        repositoryRoot,
      ),
    ).resolves.toEqual({ output: resolve(output), version: "2.0.0" });
    await expect(
      parseWindowsPackageArguments(["--version", "2.0.0"], repositoryRoot),
    ).resolves.toEqual({
      output: resolve(repositoryRoot, "release-output"),
      version: "2.0.0",
    });
    for (const args of [
      ["--version", "2.0.0", "--output", output, "--unknown"],
      ["--version", "2.0.0", "--version", "2.0.1"],
      ["--output", "release-output"],
    ]) {
      await expect(
        parseWindowsPackageArguments(args, repositoryRoot),
      ).rejects.toThrow(/OPENRECALL_PACKAGE_(ARGUMENT_INVALID|OUTPUT_UNSAFE)/u);
    }
  });

  it("accepts only one absolute Windows package smoke target", () => {
    const archive = join(repositoryRoot, "release-output", "OpenRecall-v1.1.0-windows-x64.zip");
    expect(parseWindowsSmokeArguments(["--archive", archive])).toEqual({
      archive: resolve(archive),
    });
    for (const args of [
      [],
      ["--archive", "relative.zip"],
      ["--archive", archive, "--unknown"],
    ]) {
      expect(() => parseWindowsSmokeArguments(args)).toThrow(
        "OPENRECALL_PACKAGE_SMOKE_ARGUMENT_INVALID",
      );
    }
  });

  it("waits for the launcher-level readiness marker before stopping", () => {
    expect(
      launcherOutputIsReady("OPENRECALL_READY http://127.0.0.1:3210\n"),
    ).toBe(false);
    expect(
      launcherOutputIsReady(
        "OPENRECALL_READY http://127.0.0.1:3210\nOPENRECALL_LAUNCHER_READY http://127.0.0.1:3210\n",
      ),
    ).toBe(true);
  });

  it("creates the launcher control directory before writing its stop signal", async () => {
    const root = await temporaryRoot();
    const localAppData = join(root, "portable-local-app-data");
    await prepareLauncherControlDirectory(localAppData);
    await expect(
      writeFile(join(localAppData, "openrecall-portable-stop.signal"), "stop\n"),
    ).resolves.toBeUndefined();
  });

  it("retries transient Windows directory locks during smoke cleanup", () => {
    expect(windowsSmokeCleanupOptions).toEqual({
      force: true,
      maxRetries: 20,
      recursive: true,
      retryDelay: 250,
    });
  });

  it.runIf(process.platform === "win32")(
    "launches a CMD file whose absolute path contains spaces",
    async () => {
      const root = await temporaryRoot();
      const directory = join(root, "folder with spaces");
      const launcher = join(directory, "fixture.cmd");
      await mkdir(directory, { recursive: true });
      await writeFile(launcher, "@echo off\r\nexit /b 0\r\n", "utf8");

      const result = spawnSync(
        process.env.ComSpec ?? "cmd.exe",
        cmdLauncherArguments(launcher),
        cmdLauncherSpawnOptions({ encoding: "utf8" }),
      );
      expect(result.status, result.stderr).toBe(0);
    },
  );

  it.runIf(process.platform === "win32")(
    "extracts a ZIP with Windows tar from paths containing spaces",
    async () => {
      const root = await temporaryRoot();
      const source = join(root, "source with spaces");
      const destination = join(root, "destination with spaces");
      const archive = join(root, "fixture archive.zip");
      await write(source, "nested/fixture.txt", "portable archive");
      const created = spawnSync(
        "tar.exe",
        ["-a", "-cf", archive, "-C", source, "."],
        { encoding: "utf8", windowsHide: true },
      );
      expect(created.status, created.stderr).toBe(0);

      await extractWindowsArchive(archive, destination);
      await expect(
        readFile(join(destination, "nested/fixture.txt"), "utf8"),
      ).resolves.toBe("portable archive");
    },
  );

  it("derives stable Windows x64 names from a strict semantic version", () => {
    expect(releaseArtifactNames("1.1.0")).toEqual({
      archive: "OpenRecall-v1.1.0-windows-x64.zip",
      checksum: "OpenRecall-v1.1.0-windows-x64.zip.sha256",
    });
    for (const invalid of ["v1.0.0", "1.0", "1.0.0-beta.1", "../1.0.0"]) {
      expect(() => releaseArtifactNames(invalid)).toThrow(
        "OPENRECALL_PACKAGE_VERSION_INVALID",
      );
    }
  });

  it("requests a lockfile-backed production deploy with a physical hoisted tree", async () => {
    expect(pnpmDeployArguments("C:\\release staging\\server")).toEqual([
      "--config.node-linker=hoisted",
      "--filter",
      "@openrecall/server",
      "--prod",
      "deploy",
      "C:\\release staging\\server",
    ]);
    await expect(
      readFile(join(repositoryRoot, "pnpm-workspace.yaml"), "utf8"),
    ).resolves.toMatch(/^injectWorkspacePackages: true$/mu);
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

  it("requires the graceful launcher host in every staged artifact", async () => {
    const root = await validStagingRoot();
    await rm(join(root, "LauncherHost.mjs"));

    await expect(inspectStagingDirectory(root)).rejects.toThrow(
      "OPENRECALL_PACKAGE_REQUIRED_MISSING:LauncherHost.mjs",
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

  it("accepts only the reviewed esbuild Windows binary license exception", async () => {
    const collect = async (version: string) => {
      const root = await temporaryRoot();
      const nodeModules = join(root, "node_modules");
      await write(
        nodeModules,
        "@esbuild/win32-x64/package.json",
        JSON.stringify({
          name: "@esbuild/win32-x64",
          version,
          license: "MIT",
        }),
      );
      await write(
        nodeModules,
        "esbuild/package.json",
        JSON.stringify({ name: "esbuild", version, license: "MIT" }),
      );
      await write(nodeModules, "esbuild/LICENSE.md", "esbuild license");
      return collectDependencyLicenseFiles({
        destination: join(root, "licenses"),
        nodeModules,
        repositoryRoot,
      });
    };

    await expect(collect("0.28.2")).resolves.toEqual([
      "@esbuild/win32-x64@0.28.2",
      "esbuild@0.28.2",
    ]);
    await expect(collect("0.28.1")).rejects.toThrow(
      "OPENRECALL_PACKAGE_DEPENDENCY_LICENSE_MISSING:@esbuild/win32-x64@0.28.1",
    );
    await expect(collect("0.28.3")).rejects.toThrow(
      "OPENRECALL_PACKAGE_DEPENDENCY_LICENSE_MISSING:@esbuild/win32-x64@0.28.3",
    );
  });

  it("accepts only the current OpenRecall workspace license exception", async () => {
    const collect = async (version: string) => {
      const root = await temporaryRoot();
      const nodeModules = join(root, "node_modules");
      await write(
        nodeModules,
        "@openrecall/example/package.json",
        JSON.stringify({
          name: "@openrecall/example",
          version,
          license: "Apache-2.0",
        }),
      );
      return collectDependencyLicenseFiles({
        destination: join(root, "licenses"),
        nodeModules,
        repositoryRoot,
      });
    };

    await expect(collect("1.1.0")).resolves.toEqual([
      "@openrecall/example@1.1.0",
    ]);
    await expect(collect("1.0.9")).rejects.toThrow(
      "OPENRECALL_PACKAGE_DEPENDENCY_LICENSE_MISSING:@openrecall/example@1.0.9",
    );
    await expect(collect("1.1.1")).rejects.toThrow(
      "OPENRECALL_PACKAGE_DEPENDENCY_LICENSE_MISSING:@openrecall/example@1.1.1",
    );
  });

  it("removes only dependency source maps before artifact inspection", async () => {
    const root = await temporaryRoot();
    await write(root, "node_modules/runtime/index.js", "runtime");
    await write(root, "node_modules/runtime/index.js.map", "development map");
    await write(root, "src/application.js.map", "must remain visible to the inspector");

    await expect(
      removeDependencySourceMaps(join(root, "node_modules")),
    ).resolves.toEqual(["runtime/index.js.map"]);
    await expect(
      readFile(join(root, "node_modules/runtime/index.js"), "utf8"),
    ).resolves.toBe("runtime");
    await expect(access(join(root, "node_modules/runtime/index.js.map")))
      .rejects.toThrow();
    await expect(access(join(root, "src/application.js.map")))
      .resolves.toBeUndefined();
  });

  it("keeps both CMD entry points thin and mode-specific", async () => {
    const [normal, portable, powerShell] = await Promise.all([
      readFile(join(repositoryRoot, "distribution/windows/OpenRecall.cmd"), "utf8"),
      readFile(
        join(repositoryRoot, "distribution/windows/OpenRecall-Portable.cmd"),
        "utf8",
      ),
      readFile(
        join(repositoryRoot, "distribution/windows/Start-OpenRecall.ps1"),
        "utf8",
      ),
    ]);
    expect(normal).toContain('"%~dp0Start-OpenRecall.ps1" -Mode Normal');
    expect(portable).toContain(
      '"%~dp0Start-OpenRecall.ps1" -Mode Portable',
    );
    expect(powerShell).toContain("Remove-Item Env:OPENRECALL_DATA_DIRECTORY");
    expect(powerShell).toContain('Join-Path $PSScriptRoot "Data"');
    expect(powerShell).toContain('Join-Path $PSScriptRoot "runtime\\node.exe"');
    expect(powerShell).toContain("OPENRECALL_LAUNCHER_NO_BROWSER");
    expect(powerShell).not.toMatch(/chrome\.exe|Google\\Chrome/iu);
    expect(powerShell).toContain("Start-Process -FilePath $origin");
    expect(powerShell).toContain("OPENRECALL_LAUNCHER_BROWSER_MARKER");
  });
});
