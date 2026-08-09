import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  isAbsolute,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

const stableVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const forbiddenArtifact =
  /(?:\.sqlite3(?:-|$)|\.log$|\.trace$|trace\.zip$|\.map$|test-results|playwright-report|\.env(?:\.|$))/iu;

const requiredPaths = [
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "OpenRecall.cmd",
  "OpenRecall-Portable.cmd",
  "Start-OpenRecall.ps1",
  "LauncherHost.mjs",
  "runtime/node.exe",
  "app/server/src/index.ts",
  "app/server/node_modules",
  "app/web/dist/index.html",
  "licenses/node/LICENSE",
];
const dependencyLicenseFile =
  /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/iu;

function packageError(code, detail) {
  return new Error(detail === undefined ? code : `${code}:${detail}`);
}

function portablePath(path) {
  return path.split(sep).join("/");
}

function containsPath(parent, candidate) {
  const child = relative(parent, candidate);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== "..");
}

export function releaseArtifactNames(version) {
  if (!stableVersion.test(version)) {
    throw packageError("OPENRECALL_PACKAGE_VERSION_INVALID");
  }
  const archive = `OpenRecall-v${version}-windows-x64.zip`;
  return {
    archive,
    checksum: `${archive}.sha256`,
  };
}

export function pnpmDeployArguments(target) {
  return [
    "--config.node-linker=hoisted",
    "--filter",
    "@openrecall/server",
    "--prod",
    "deploy",
    target,
    "--legacy",
  ];
}

export function assertSafeReleaseDirectory(path, repositoryRoot) {
  if (!isAbsolute(path) || !isAbsolute(repositoryRoot)) {
    throw packageError("OPENRECALL_PACKAGE_OUTPUT_UNSAFE");
  }
  const output = resolve(path);
  const repository = resolve(repositoryRoot);
  const filesystemRoot = parse(output).root;
  if (
    output === filesystemRoot ||
    output === repository ||
    containsPath(output, repository)
  ) {
    throw packageError("OPENRECALL_PACKAGE_OUTPUT_UNSAFE");
  }
  return output;
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifySha256(path, expectedHex) {
  if (!/^[a-f\d]{64}$/iu.test(expectedHex)) {
    throw packageError("OPENRECALL_PACKAGE_SHA256_INVALID");
  }
  const actual = await sha256File(path);
  if (actual !== expectedHex.toLowerCase()) {
    throw packageError("OPENRECALL_PACKAGE_SHA256_MISMATCH");
  }
  return actual;
}

async function packageRoots(nodeModules) {
  const roots = [];
  let entries;
  try {
    entries = await readdir(nodeModules, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return roots;
    }
    throw error;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".bin" || entry.name === ".pnpm") {
      continue;
    }
    if (entry.name.startsWith("@")) {
      const scopeRoot = resolve(nodeModules, entry.name);
      const scoped = await readdir(scopeRoot, { withFileTypes: true });
      for (const child of scoped) {
        if (child.isDirectory()) roots.push(resolve(scopeRoot, child.name));
      }
      continue;
    }
    roots.push(resolve(nodeModules, entry.name));
  }
  return roots;
}

async function copyAuditedLicenseException({
  destination,
  name,
  nodeModules,
  packageRoot,
  repositoryRoot,
  version,
}) {
  if (name.startsWith("@openrecall/") && version === "1.0.1") {
    await Promise.all([
      copyFile(resolve(repositoryRoot, "LICENSE"), resolve(destination, "LICENSE")),
      copyFile(resolve(repositoryRoot, "NOTICE"), resolve(destination, "NOTICE")),
    ]);
    return true;
  }
  if (name === "@esbuild/win32-x64" && version === "0.28.1") {
    await copyFile(
      resolve(nodeModules, "esbuild", "LICENSE.md"),
      resolve(destination, "LICENSE.md"),
    );
    return true;
  }
  if (name === "abstract-logging" && version === "2.0.1") {
    await Promise.all([
      copyFile(
        resolve(packageRoot, "package.json"),
        resolve(destination, "package.json"),
      ),
      copyFile(
        resolve(packageRoot, "Readme.md"),
        resolve(destination, "Readme.md"),
      ),
      writeFile(
        resolve(destination, "LICENSE-DECLARATION.txt"),
        [
          "abstract-logging 2.0.1 declares MIT in its published package.json.",
          "The npm archive does not include a separate license text.",
          "The published package.json and Readme.md are preserved beside this notice.",
          "",
        ].join("\n"),
        "utf8",
      ),
    ]);
    return true;
  }
  return false;
}

export async function collectDependencyLicenseFiles({
  destination,
  nodeModules,
  repositoryRoot,
}) {
  const identities = new Set();
  const pending = await packageRoots(nodeModules);
  while (pending.length > 0) {
    const packageRoot = pending.shift();
    const manifest = JSON.parse(
      await readFile(resolve(packageRoot, "package.json"), "utf8"),
    );
    if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
      throw packageError("OPENRECALL_PACKAGE_DEPENDENCY_IDENTITY_INVALID");
    }
    const identity = `${manifest.name}@${manifest.version}`;
    if (!identities.has(identity)) {
      identities.add(identity);
      const encodedName = encodeURIComponent(manifest.name);
      const packageDestination = resolve(
        destination,
        encodedName,
        manifest.version,
      );
      await mkdir(packageDestination, { recursive: true });
      const entries = await readdir(packageRoot, { withFileTypes: true });
      const licenses = entries.filter(
        (entry) => entry.isFile() && dependencyLicenseFile.test(entry.name),
      );
      if (licenses.length > 0) {
        await Promise.all(
          licenses.map((entry) =>
            copyFile(
              resolve(packageRoot, entry.name),
              resolve(packageDestination, entry.name),
            ),
          ),
        );
      } else if (!await copyAuditedLicenseException({
        destination: packageDestination,
        name: manifest.name,
        nodeModules,
        packageRoot,
        repositoryRoot,
        version: manifest.version,
      })) {
        throw packageError(
          "OPENRECALL_PACKAGE_DEPENDENCY_LICENSE_MISSING",
          identity,
        );
      }
    }
    pending.push(...await packageRoots(resolve(packageRoot, "node_modules")));
  }
  return [...identities].sort((left, right) => left.localeCompare(right, "en"));
}

export async function removeDependencySourceMaps(
  nodeModules,
  directory = nodeModules,
) {
  const removed = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      removed.push(...await removeDependencySourceMaps(nodeModules, absolute));
    } else if (entry.isFile() && entry.name.endsWith(".map")) {
      await rm(absolute);
      removed.push(portablePath(relative(nodeModules, absolute)));
    }
  }
  return removed.sort((left, right) => left.localeCompare(right, "en"));
}

async function listFiles(root, directory = root) {
  const paths = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    const relativePath = portablePath(relative(root, absolute));
    if (entry.isSymbolicLink()) {
      throw packageError("OPENRECALL_PACKAGE_SYMLINK", relativePath);
    }
    if (entry.isDirectory()) {
      paths.push(...await listFiles(root, absolute));
      continue;
    }
    if (!entry.isFile()) {
      throw packageError("OPENRECALL_PACKAGE_ENTRY_INVALID", relativePath);
    }
    paths.push(relativePath);
  }
  return paths;
}

export async function inspectStagingDirectory(root) {
  const stagingRoot = resolve(root);
  for (const requiredPath of requiredPaths) {
    try {
      await access(resolve(stagingRoot, requiredPath));
    } catch {
      throw packageError(
        "OPENRECALL_PACKAGE_REQUIRED_MISSING",
        requiredPath,
      );
    }
  }

  const manifest = await listFiles(stagingRoot);
  for (const relativePath of manifest) {
    if (forbiddenArtifact.test(relativePath)) {
      throw packageError("OPENRECALL_PACKAGE_FORBIDDEN", relativePath);
    }
  }
  return manifest.sort((left, right) => left.localeCompare(right, "en"));
}
