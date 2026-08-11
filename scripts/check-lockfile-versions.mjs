import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
];
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const APPROVED_BUILD_PACKAGES = new Set([
  "better-sqlite3",
  "esbuild",
  "sharp",
]);
const REQUIRED_LOCKED_VERSIONS = new Map([
  ["better-sqlite3", new Set(["13.0.3"])],
  ["esbuild", new Set(["0.28.2"])],
  ["sharp", new Set(["0.35.3"])],
]);

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function packageManifests(root) {
  const paths = [resolve(root, "package.json")];
  for (const workspaceRoot of ["apps", "packages"]) {
    const directory = resolve(root, workspaceRoot);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        paths.push(resolve(directory, entry.name, "package.json"));
      }
    }
  }
  return Promise.all(
    paths.map(async (path) => ({
      directory:
        path === resolve(root, "package.json")
          ? "."
          : relative(root, resolve(path, "..")).replaceAll("\\", "/"),
      manifest: await json(path),
    })),
  );
}

function directDependencies(manifest) {
  const dependencies = new Map();
  for (const section of DEPENDENCY_SECTIONS) {
    const entries = manifest[section] ?? {};
    for (const [name, specifier] of Object.entries(entries)) {
      dependencies.set(name, specifier);
    }
  }
  return dependencies;
}

function assertExactDirectVersions(manifests) {
  for (const { directory, manifest } of manifests) {
    for (const [name, specifier] of directDependencies(manifest)) {
      if (
        specifier !== "workspace:*" &&
        (typeof specifier !== "string" || !EXACT_VERSION.test(specifier))
      ) {
        throw new Error(
          `DIRECT_VERSION_NOT_EXACT:${directory}:${name}`,
        );
      }
    }
  }
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseLockfileSpecifiers(source) {
  const importers = new Map();
  let importer;
  let section;
  let dependency;
  for (const line of source.split(/\r?\n/u)) {
    if (line === "packages:") break;
    const importerMatch = /^  ([^ ].*):$/u.exec(line);
    if (importerMatch !== null) {
      importer = unquote(importerMatch[1]);
      importers.set(importer, new Map());
      section = undefined;
      dependency = undefined;
      continue;
    }
    const sectionMatch =
      /^    (dependencies|devDependencies|optionalDependencies):$/u.exec(
        line,
      );
    if (sectionMatch !== null) {
      section = sectionMatch[1];
      dependency = undefined;
      continue;
    }
    const dependencyMatch = /^      (.+):$/u.exec(line);
    if (dependencyMatch !== null && section !== undefined) {
      dependency = unquote(dependencyMatch[1]);
      continue;
    }
    const specifierMatch = /^        specifier: (.+)$/u.exec(line);
    if (
      specifierMatch !== null &&
      importer !== undefined &&
      dependency !== undefined
    ) {
      importers
        .get(importer)
        .set(dependency, unquote(specifierMatch[1]));
    }
  }
  return importers;
}

function assertLockfileSpecifiers(manifests, lockfile) {
  const importers = parseLockfileSpecifiers(lockfile);
  for (const { directory, manifest } of manifests) {
    const locked = importers.get(directory);
    if (locked === undefined) {
      throw new Error(`LOCKFILE_IMPORTER_MISSING:${directory}`);
    }
    for (const [name, specifier] of directDependencies(manifest)) {
      if (locked.get(name) !== specifier) {
        throw new Error(
          `LOCKFILE_SPECIFIER_MISMATCH:${directory}:${name}`,
        );
      }
    }
  }
}

function parseBuildPermissions(source) {
  const permissions = new Map();
  let inside = false;
  for (const line of source.split(/\r?\n/u)) {
    if (line === "allowBuilds:") {
      inside = true;
      continue;
    }
    if (inside && /^\S/u.test(line)) break;
    if (!inside) continue;
    const match = /^  ([^:]+):\s*(true|false)$/u.exec(line);
    if (match !== null) {
      permissions.set(unquote(match[1]), match[2] === "true");
    }
  }
  return permissions;
}

function assertBuildPermissions(workspace) {
  const permissions = parseBuildPermissions(workspace);
  for (const [name, permitted] of permissions) {
    if (!APPROVED_BUILD_PACKAGES.has(name) || permitted !== true) {
      throw new Error(`BUILD_PERMISSION_NOT_APPROVED:${name}`);
    }
  }
  for (const name of APPROVED_BUILD_PACKAGES) {
    if (permissions.get(name) !== true) {
      throw new Error(`BUILD_PERMISSION_MISSING:${name}`);
    }
  }
}

function assertRequiredLockEntries(lockfile) {
  const normalizedLockfile = lockfile.replace(/\r\n?/gu, "\n");
  const packagesStart = normalizedLockfile.indexOf("\npackages:\n");
  const snapshotsStart = normalizedLockfile.indexOf(
    "\nsnapshots:",
    packagesStart,
  );
  if (
    packagesStart === -1 ||
    snapshotsStart === -1 ||
    snapshotsStart <= packagesStart
  ) {
    throw new Error("LOCKFILE_PACKAGE_SECTION_MISSING");
  }
  const lines = normalizedLockfile
    .slice(packagesStart + 1, snapshotsStart)
    .split(/\r?\n/u);
  for (const [name, versions] of REQUIRED_LOCKED_VERSIONS) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const pattern = new RegExp(`^  ${escaped}@([^:]+):$`, "u");
    const entries = new Set(
      lines
        .map((line) => pattern.exec(line)?.[1])
        .filter((version) => version !== undefined),
    );
    if (
      entries.size !== versions.size ||
      [...versions].some((version) => !entries.has(version))
    ) {
      throw new Error(`LOCKED_NATIVE_VERSION_INVALID:${name}`);
    }
  }
}

export async function checkLockfileVersions(root = process.cwd()) {
  const repositoryRoot = resolve(root);
  const [manifests, lockfile, workspace] = await Promise.all([
    packageManifests(repositoryRoot),
    readFile(resolve(repositoryRoot, "pnpm-lock.yaml"), "utf8"),
    readFile(resolve(repositoryRoot, "pnpm-workspace.yaml"), "utf8"),
  ]);
  const rootManifest = manifests.find(
    ({ directory }) => directory === ".",
  )?.manifest;
  if (rootManifest?.packageManager !== "pnpm@11.17.0") {
    throw new Error("PACKAGE_MANAGER_VERSION_INVALID");
  }
  assertExactDirectVersions(manifests);
  assertLockfileSpecifiers(manifests, lockfile);
  assertBuildPermissions(workspace);
  assertRequiredLockEntries(lockfile);
}

const invokedPath =
  process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  checkLockfileVersions()
    .then(() => {
      process.stdout.write("OPENRECALL_LOCKFILE_VERSIONS_OK\n");
    })
    .catch((error) => {
      const diagnostic =
        error instanceof Error
          ? error.message
          : "LOCKFILE_VERSION_CHECK_FAILED";
      process.stderr.write(`${diagnostic}\n`);
      process.exitCode = 1;
    });
}
