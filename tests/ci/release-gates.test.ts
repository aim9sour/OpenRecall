import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkAdapterBoundaries,
} from "../../scripts/check-adapter-boundaries.mjs";
import {
  checkLockfileVersions,
} from "../../scripts/check-lockfile-versions.mjs";
import {
  validateDependencyLicenseReports,
} from "../../scripts/check-dependency-licenses.mjs";
import {
  committedWhitespaceArgs,
} from "../../scripts/check-committed-whitespace.mjs";

const temporaryRoots: string[] = [];
const repositoryRoot = resolve(import.meta.dirname, "../..");

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openrecall-gate-"));
  temporaryRoots.push(root);
  return root;
}

async function write(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, content);
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe("adapter and runtime-network boundary gate", () => {
  it("accepts the repository's declared adapter boundaries", async () => {
    await expect(
      checkAdapterBoundaries(repositoryRoot),
    ).resolves.toBeUndefined();
  });

  it("rejects FSRS imports outside adapters and non-loopback runtime URLs", async () => {
    const root = await temporaryRoot();
    await write(
      root,
      "packages/domain/src/forbidden.ts",
      'import { FSRS } from "ts-fsrs";\n',
    );
    await expect(checkAdapterBoundaries(root)).rejects.toThrow(
      "ADAPTER_IMPORT_FORBIDDEN",
    );

    await rm(join(root, "packages"), {
      force: true,
      recursive: true,
    });
    await write(
      root,
      "apps/web/src/remote.ts",
      'export const endpoint = "https://telemetry.example";\n',
    );
    await expect(checkAdapterBoundaries(root)).rejects.toThrow(
      "RUNTIME_EXTERNAL_URL_FORBIDDEN",
    );
  });

  it("does not allow a scheduler package subpath to bypass the adapter", async () => {
    const root = await temporaryRoot();
    await write(
      root,
      "packages/domain/src/forbidden.ts",
      'import { FSRS } from "ts-fsrs/experimental";\n',
    );

    await expect(checkAdapterBoundaries(root)).rejects.toThrow(
      "ADAPTER_IMPORT_FORBIDDEN",
    );
  });

  it("rejects side-effect imports and unproved URL templates", async () => {
    const root = await temporaryRoot();
    await write(
      root,
      "packages/domain/src/forbidden.ts",
      'import "ts-fsrs";\n',
    );
    await expect(checkAdapterBoundaries(root)).rejects.toThrow(
      "ADAPTER_IMPORT_FORBIDDEN",
    );

    await rm(join(root, "packages"), {
      force: true,
      recursive: true,
    });
    await write(
      root,
      "apps/web/src/remote.ts",
      'export const endpoint = `https://${host}/collect`;\n',
    );
    await expect(checkAdapterBoundaries(root)).rejects.toThrow(
      "RUNTIME_EXTERNAL_URL_FORBIDDEN",
    );

    await rm(join(root, "apps"), {
      force: true,
      recursive: true,
    });
    await write(
      root,
      "apps/web/src/remote.ts",
      'fetch("http://openrecall.invalid/collect");\n',
    );
    await expect(checkAdapterBoundaries(root)).rejects.toThrow(
      "RUNTIME_EXTERNAL_URL_FORBIDDEN",
    );
  });

  it("allows only the pinned Node distribution URL in the Windows packager", async () => {
    const root = await temporaryRoot();
    await write(
      root,
      "scripts/package-windows.mjs",
      'export const source = `https://nodejs.org/dist/v${nodeVersion}`;\n',
    );
    await expect(checkAdapterBoundaries(root)).resolves.toBeUndefined();

    await write(
      root,
      "scripts/package-windows.mjs",
      'export const source = "https://downloads.example/node.zip";\n',
    );
    await expect(checkAdapterBoundaries(root)).rejects.toThrow(
      "RUNTIME_EXTERNAL_URL_FORBIDDEN:scripts/package-windows.mjs",
    );

    await rm(join(root, "scripts"), { force: true, recursive: true });
    await write(
      root,
      "apps/server/src/remote.ts",
      'export const source = "https://nodejs.org/dist/v24.18.0";\n',
    );
    await expect(checkAdapterBoundaries(root)).rejects.toThrow(
      "RUNTIME_EXTERNAL_URL_FORBIDDEN:apps/server/src/remote.ts",
    );
  });
});

describe("lockfile and install-script gate", () => {
  it("accepts exact direct versions and only the required build scripts", async () => {
    await expect(
      checkLockfileVersions(repositoryRoot),
    ).resolves.toBeUndefined();
  });

  it("does not auto-install optional peers with vulnerable native trees", async () => {
    const [workspace, lockfile] = await Promise.all([
      readFile(join(repositoryRoot, "pnpm-workspace.yaml"), "utf8"),
      readFile(join(repositoryRoot, "pnpm-lock.yaml"), "utf8"),
    ]);

    expect(workspace).toMatch(/^autoInstallPeers: false$/mu);
    expect(lockfile).not.toContain("sharp@0.33.5:");
  });

  it("rejects version ranges and any extra dependency build permission", async () => {
    const root = await temporaryRoot();
    await write(
      root,
      "package.json",
      JSON.stringify({
        dependencies: { example: "^1.2.3" },
        packageManager: "pnpm@11.17.0",
      }),
    );
    await write(
      root,
      "pnpm-workspace.yaml",
      [
        "packages:",
        "  - apps/*",
        "allowBuilds:",
        "  better-sqlite3: true",
        "  esbuild: true",
        "  sharp: true",
        "  unexpected-native-package: true",
      ].join("\n"),
    );
    await write(
      root,
      "pnpm-lock.yaml",
      [
        "lockfileVersion: '9.0'",
        "importers:",
        "  .:",
        "    dependencies:",
        "      example:",
        "        specifier: ^1.2.3",
        "        version: 1.2.3",
        "packages:",
        "  better-sqlite3@13.0.1:",
        "  esbuild@0.28.1:",
      ].join("\n"),
    );

    await expect(checkLockfileVersions(root)).rejects.toThrow(
      /DIRECT_VERSION_NOT_EXACT|BUILD_PERMISSION_NOT_APPROVED/u,
    );
  });

  it("reaches and rejects an extra build permission with exact manifests", async () => {
    const root = await temporaryRoot();
    await write(
      root,
      "package.json",
      JSON.stringify({ packageManager: "pnpm@11.17.0" }),
    );
    await write(
      root,
      "pnpm-workspace.yaml",
      [
        "packages: []",
        "allowBuilds:",
        "  better-sqlite3: true",
        "  esbuild: true",
        "  sharp: true",
        "  unexpected-native-package: true",
      ].join("\n"),
    );
    await write(
      root,
      "pnpm-lock.yaml",
      [
        "lockfileVersion: '9.0'",
        "importers:",
        "  .:",
        "packages:",
        "  better-sqlite3@13.0.1:",
        "  esbuild@0.28.1:",
        "  sharp@0.35.3:",
        "snapshots:",
      ].join("\n"),
    );

    await expect(checkLockfileVersions(root)).rejects.toThrow(
      "BUILD_PERMISSION_NOT_APPROVED:unexpected-native-package",
    );
  });

  it("accepts CRLF package and snapshot section boundaries", async () => {
    const root = await temporaryRoot();
    await write(
      root,
      "package.json",
      JSON.stringify({ packageManager: "pnpm@11.17.0" }),
    );
    await write(
      root,
      "pnpm-workspace.yaml",
      [
        "packages: []",
        "allowBuilds:",
        "  better-sqlite3: true",
        "  esbuild: true",
        "  sharp: true",
      ].join("\r\n"),
    );
    await write(
      root,
      "pnpm-lock.yaml",
      [
        "lockfileVersion: '9.0'",
        "importers:",
        "  .:",
        "packages:",
        "  better-sqlite3@13.0.1:",
        "  esbuild@0.28.1:",
        "  sharp@0.35.3:",
        "snapshots:",
      ].join("\r\n"),
    );

    await expect(
      checkLockfileVersions(root),
    ).resolves.toBeUndefined();
  });
});

describe("dependency license review gate", () => {
  const entry = (name: string) => ({
    license: "fixture",
    name,
    paths: [`/fixture/${name}`],
    versions: ["1.0.0"],
  });

  it("accepts reviewed tool licenses while keeping production permissive", () => {
    expect(() =>
      validateDependencyLicenseReports(
        {
          "Apache-2.0": [entry("runtime")],
          MIT: [entry("runtime-helper")],
        },
        {
          "Apache-2.0": [entry("runtime")],
          "Apache-2.0 AND LGPL-3.0-or-later": [entry("build-binary")],
          "CC-BY-4.0": [entry("browser-data")],
          "LGPL-3.0-or-later": [entry("linux-build-library")],
          MIT: [entry("runtime-helper")],
          "MPL-2.0": [entry("test-tool")],
        },
      ),
    ).not.toThrow();
  });

  it("rejects an unreviewed license and a tooling-only license in production", () => {
    expect(() =>
      validateDependencyLicenseReports(
        { GPL: [entry("new-runtime")] },
        { GPL: [entry("new-runtime")] },
      ),
    ).toThrow("DEPENDENCY_LICENSE_UNREVIEWED:GPL");

    expect(() =>
      validateDependencyLicenseReports(
        {
          "Apache-2.0 AND LGPL-3.0-or-later": [
            entry("unexpected-runtime-binary"),
          ],
        },
        {
          "Apache-2.0 AND LGPL-3.0-or-later": [
            entry("unexpected-runtime-binary"),
          ],
        },
      ),
    ).toThrow(
      "PRODUCTION_DEPENDENCY_LICENSE_NOT_APPROVED:Apache-2.0 AND LGPL-3.0-or-later",
    );
  });
});

describe("repository release automation", () => {
  it("provides serial local verification commands for resource-heavy gates", async () => {
    const [packageJsonText, agentInstructions] = await Promise.all([
      readFile(join(repositoryRoot, "package.json"), "utf8"),
      readFile(join(repositoryRoot, "AGENTS.md"), "utf8"),
    ]);
    const packageJson = JSON.parse(packageJsonText) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["verify"]).toBe(
      "pnpm check && pnpm release:licenses && pnpm test && pnpm build",
    );
    expect(packageJson.scripts?.["verify:full"]).toBe(
      "pnpm verify && node scripts/smoke-production.mjs --skip-build && pnpm test:e2e",
    );
    expect(agentInstructions).toContain("pnpm verify:full");
    expect(agentInstructions).toContain("must not run concurrently");
  });

  it("checks a pull request range or the complete pushed commit", () => {
    expect(committedWhitespaceArgs("abc1234")).toEqual([
      "diff",
      "--check",
      "abc1234...HEAD",
    ]);
    expect(committedWhitespaceArgs(undefined)).toEqual([
      "diff-tree",
      "--check",
      "--no-commit-id",
      "--root",
      "-r",
      "HEAD",
    ]);
  });

  it("keeps every required Node 24 release gate in the Linux workflow", async () => {
    const workflow = await readFile(
      join(repositoryRoot, ".github/workflows/ci.yml"),
      "utf8",
    );

    expect(workflow).toContain("node-version: 24.18.0");
    expect(workflow).toContain("PNPM_VERSION: 11.17.0");
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).toContain(
      "node scripts/check-committed-whitespace.mjs",
    );
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain(
      "node scripts/check-adapter-boundaries.mjs",
    );
    expect(workflow).toContain(
      "node scripts/check-lockfile-versions.mjs",
    );
    expect(workflow).toContain("pnpm release:licenses");
    expect(workflow).toContain("pnpm check");
    expect(workflow).toContain("pnpm test");
    expect(workflow).toContain("pnpm build");
    expect(workflow).toContain(
      "pnpm exec playwright install --with-deps chromium",
    );
    expect(workflow).toContain("pnpm test:e2e");
    expect(workflow).toContain(
      "node scripts/smoke-production.mjs",
    );
    expect(workflow).toMatch(
      /migrations.*backup-service\.test\.ts.*restore-service\.test\.ts/su,
    );
  });

  it("keeps Node 26 informational and Windows Chrome gates explicit", async () => {
    const [linux, windows, playwright] = await Promise.all([
      readFile(join(repositoryRoot, ".github/workflows/ci.yml"), "utf8"),
      readFile(
        join(repositoryRoot, ".github/workflows/windows-smoke.yml"),
        "utf8",
      ),
      readFile(join(repositoryRoot, "playwright.config.ts"), "utf8"),
    ]);

    expect(linux).toMatch(
      /node-26-compatibility:[\s\S]*continue-on-error: true[\s\S]*node-version: 26/u,
    );
    expect(windows).toContain("runs-on: windows-latest");
    expect(windows).toContain("node-version: 24.18.0");
    expect(windows).toContain("PNPM_VERSION: 11.17.0");
    expect(windows).toContain("pnpm install --frozen-lockfile");
    expect(windows).toContain("fetch-depth: 0");
    expect(windows).toContain(
      "node scripts/check-committed-whitespace.mjs",
    );
    expect(windows).toContain("pnpm release:licenses");
    expect(windows).toContain(
      "node scripts/smoke-production.mjs",
    );
    expect(windows).toContain(
      "OPENRECALL_BROWSER_CHANNEL: chrome",
    );
    expect(windows).toContain("pnpm test:e2e");
    expect(playwright).toContain(
      'process.env["OPENRECALL_BROWSER_CHANNEL"]',
    );
    expect(playwright).toContain('channel: "chrome"');
  });

  it("keeps risky dependency upgrades separate and exposes the PR checklist", async () => {
    const [dependabot, template] = await Promise.all([
      readFile(join(repositoryRoot, ".github/dependabot.yml"), "utf8"),
      readFile(
        join(repositoryRoot, ".github/pull_request_template.md"),
        "utf8",
      ),
    ]);

    for (const dependency of [
      "ts-fsrs",
      "@open-spaced-repetition/binding",
      "better-sqlite3",
      "fastify",
      "react",
      "vite-plugin-pwa",
    ]) {
      expect(dependabot).toContain(dependency);
    }
    expect(template).toContain("upstream changelog");
    expect(template).toContain("adapter fixtures");
    expect(template).toContain("migration");
    expect(template).toContain("backup");
    expect(template).toContain("RTL");
    expect(template).toContain("LTR");
    expect(template).toContain("NVDA");
  });

  it("reviews pull-request dependencies and scans JavaScript with current security actions", async () => {
    const [dependencyReview, codeql] = await Promise.all([
      readFile(
        join(repositoryRoot, ".github/workflows/dependency-review.yml"),
        "utf8",
      ),
      readFile(join(repositoryRoot, ".github/workflows/codeql.yml"), "utf8"),
    ]);

    expect(dependencyReview).toContain("pull_request:");
    expect(dependencyReview).toContain("contents: read");
    expect(dependencyReview).toContain("actions/dependency-review-action@v5");
    expect(dependencyReview).toContain("fail-on-severity: moderate");
    expect(codeql).toContain("security-events: write");
    expect(codeql).toContain("github/codeql-action/init@v4");
    expect(codeql).toContain("github/codeql-action/analyze@v4");
    expect(codeql).toContain("languages: javascript-typescript");
    expect(codeql).toContain("cron:");
  });

  it("builds, smokes, attests, and only then publishes an exact tagged release", async () => {
    const workflow = await readFile(
      join(repositoryRoot, ".github/workflows/release.yml"),
      "utf8",
    );
    for (const permission of [
      "contents: write",
      "id-token: write",
      "attestations: write",
      "artifact-metadata: write",
    ]) {
      expect(workflow).toContain(permission);
    }
    expect(workflow).toContain('tags: ["v*.*.*"]');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("timeout-minutes: 45");
    expect(workflow).toContain("node-version: 24.18.0");
    expect(workflow).toContain("PNPM_VERSION: 11.17.0");
    expect(workflow).toContain('"v$Version"');
    expect(workflow).toContain("github.ref_name");
    expect(workflow).toContain("pnpm package:windows");
    expect(workflow).toContain(
      "OpenRecall-v1.0.0-windows-x64.zip",
    );
    expect(workflow).toContain("pnpm smoke:package:windows --archive");
    expect(workflow).not.toContain("smoke:package:windows -- --archive");
    expect(workflow).toContain("actions/upload-artifact@v7");
    expect(workflow).toContain("actions/attest@v4");
    expect(workflow).toContain("subject-path:");
    const draftAt = workflow.indexOf("gh release create");
    const uploadAt = workflow.indexOf("gh release upload");
    const publishAt = workflow.indexOf("--draft=false");
    expect(draftAt).toBeGreaterThan(-1);
    expect(workflow.slice(draftAt, uploadAt)).toContain("--draft");
    expect(uploadAt).toBeGreaterThan(draftAt);
    expect(publishAt).toBeGreaterThan(uploadAt);
  });

  it("runs package contracts on Windows with explicit shells and bounded jobs", async () => {
    const [linux, windows] = await Promise.all([
      readFile(join(repositoryRoot, ".github/workflows/ci.yml"), "utf8"),
      readFile(
        join(repositoryRoot, ".github/workflows/windows-smoke.yml"),
        "utf8",
      ),
    ]);
    expect(linux).toContain("timeout-minutes: 30");
    expect(linux).toContain("shell: bash");
    expect(windows).toContain("timeout-minutes: 35");
    expect(windows).toContain("shell: pwsh");
    expect(windows).toContain("pnpm test:package");
  });

  it("uses the current supported GitHub Actions majors", async () => {
    const [ci, windows, release, dependencyReview, codeql] = await Promise.all(
      [
        "ci.yml",
        "windows-smoke.yml",
        "release.yml",
        "dependency-review.yml",
        "codeql.yml",
      ].map((filename) =>
        readFile(join(repositoryRoot, ".github/workflows", filename), "utf8"),
      ),
    );

    for (const workflow of [ci, windows, release, dependencyReview, codeql]) {
      expect(workflow).toContain("actions/checkout@v7");
      expect(workflow).not.toContain("actions/checkout@v6");
    }
    for (const workflow of [ci, windows, release]) {
      expect(workflow).toContain("actions/setup-node@v7");
      expect(workflow).not.toContain("actions/setup-node@v6");
    }
    expect(release).toContain("actions/upload-artifact@v7");
    expect(release).not.toContain("actions/upload-artifact@v6");
  });
});
