import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  assertSafeReleaseDirectory,
  collectDependencyLicenseFiles,
  inspectStagingDirectory,
  pnpmDeployArguments,
  releaseArtifactNames,
  sha256File,
  verifySha256,
} from "./release/windows-package-core.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const nodeVersion = "24.18.0";
const nodeArchiveName = `node-v${nodeVersion}-win-x64.zip`;
const nodeDistributionRoot = `https://nodejs.org/dist/v${nodeVersion}`;

function packageError(code, detail) {
  return new Error(detail === undefined ? code : `${code}:${detail}`);
}

export function parseWindowsPackageArguments(args, root = repositoryRoot) {
  if (args.length !== 2 && args.length !== 4) {
    throw packageError("OPENRECALL_PACKAGE_ARGUMENT_INVALID");
  }
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (
      (name !== "--version" && name !== "--output") ||
      value === undefined ||
      value === "" ||
      values.has(name)
    ) {
      throw packageError("OPENRECALL_PACKAGE_ARGUMENT_INVALID");
    }
    values.set(name, value);
  }
  const version = values.get("--version");
  if (version === undefined) {
    throw packageError("OPENRECALL_PACKAGE_ARGUMENT_INVALID");
  }
  releaseArtifactNames(version);
  const outputValue = values.get("--output") ?? resolve(root, "release-output");
  return {
    output: assertSafeReleaseDirectory(outputValue, root),
    version,
  };
}

function runProcess(command, args, { cwd = repositoryRoot, env = process.env } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      reject(
        packageError(
          "OPENRECALL_PACKAGE_COMMAND_FAILED",
          `${basename(command)}:${code ?? signal ?? "unknown"}`,
        ),
      );
    });
  });
}

function pnpmInvocation(args) {
  const pnpmCli = process.env["npm_execpath"];
  if (pnpmCli === undefined || pnpmCli === "") {
    throw packageError("OPENRECALL_PACKAGE_PNPM_CONTEXT_REQUIRED");
  }
  return { command: process.execPath, args: [pnpmCli, ...args] };
}

async function runPnpm(args, env = process.env) {
  const invocation = pnpmInvocation(args);
  await runProcess(invocation.command, invocation.args, { env });
}

async function download(url, destination) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || response.body === null) {
    throw packageError(
      "OPENRECALL_PACKAGE_DOWNLOAD_FAILED",
      `${response.status}:${url}`,
    );
  }
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(destination, { flags: "wx" }),
  );
}

function expectedNodeArchiveSha256(checksums) {
  const escaped = nodeArchiveName.replaceAll(".", "\\.");
  const match = checksums.match(
    new RegExp(`^([a-f\\d]{64})\\s+${escaped}$`, "imu"),
  );
  if (match?.[1] === undefined) {
    throw packageError("OPENRECALL_PACKAGE_NODE_CHECKSUM_MISSING");
  }
  return match[1].toLowerCase();
}

async function expandArchive(archive, destination) {
  await runProcess(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "& { param([string]$Archive,[string]$Destination) $ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force }",
      archive,
      destination,
    ],
  );
}

async function compressArchive(source, destination) {
  await runProcess(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "& { param([string]$Source,[string]$Destination) $ErrorActionPreference='Stop'; Compress-Archive -Path (Join-Path $Source '*') -DestinationPath $Destination -CompressionLevel Optimal -Force }",
      source,
      destination,
    ],
  );
}

function assertDirectChild(child, parent) {
  if (dirname(child) !== parent || child === parent) {
    throw packageError("OPENRECALL_PACKAGE_STAGING_UNSAFE");
  }
}

async function assembleWindowsPackage({ output, version }) {
  if (process.platform !== "win32") {
    throw packageError("OPENRECALL_PACKAGE_WINDOWS_REQUIRED");
  }
  const names = releaseArtifactNames(version);
  await mkdir(output, { recursive: true });
  const staging = resolve(output, `.openrecall-staging-v${version}-windows-x64`);
  assertDirectChild(staging, output);
  const downloadRoot = await mkdtemp(join(tmpdir(), "openrecall-package-download-"));
  const archivePath = resolve(output, names.archive);
  const checksumPath = resolve(output, names.checksum);
  let deployAttempted = false;
  try {
    await rm(staging, { force: true, recursive: true });
    await mkdir(staging, { recursive: true });
    await runPnpm(["build"]);

    const serverRoot = resolve(staging, "app", "server");
    deployAttempted = true;
    await runPnpm(pnpmDeployArguments(serverRoot), {
      ...process.env,
      CI: "true",
    });
    await cp(
      resolve(repositoryRoot, "apps", "web", "dist"),
      resolve(staging, "app", "web", "dist"),
      { recursive: true },
    );

    const nodeArchive = resolve(downloadRoot, nodeArchiveName);
    const nodeChecksums = resolve(downloadRoot, "SHASUMS256.txt");
    await Promise.all([
      download(`${nodeDistributionRoot}/${nodeArchiveName}`, nodeArchive),
      download(`${nodeDistributionRoot}/SHASUMS256.txt`, nodeChecksums),
    ]);
    const expectedNodeSha = expectedNodeArchiveSha256(
      await readFile(nodeChecksums, "utf8"),
    );
    await verifySha256(nodeArchive, expectedNodeSha);
    const expandedNode = resolve(downloadRoot, "node-expanded");
    await mkdir(expandedNode, { recursive: true });
    await expandArchive(nodeArchive, expandedNode);
    const nodeRoot = resolve(expandedNode, `node-v${nodeVersion}-win-x64`);
    await mkdir(resolve(staging, "runtime"), { recursive: true });
    await mkdir(resolve(staging, "licenses", "node"), { recursive: true });
    await Promise.all([
      copyFile(resolve(nodeRoot, "node.exe"), resolve(staging, "runtime", "node.exe")),
      copyFile(resolve(nodeRoot, "LICENSE"), resolve(staging, "licenses", "node", "LICENSE")),
    ]);

    await Promise.all([
      copyFile(resolve(repositoryRoot, "LICENSE"), resolve(staging, "LICENSE")),
      copyFile(resolve(repositoryRoot, "NOTICE"), resolve(staging, "NOTICE")),
      copyFile(
        resolve(repositoryRoot, "THIRD_PARTY_NOTICES.md"),
        resolve(staging, "THIRD_PARTY_NOTICES.md"),
      ),
      copyFile(
        resolve(repositoryRoot, "distribution", "windows", "OpenRecall.cmd"),
        resolve(staging, "OpenRecall.cmd"),
      ),
      copyFile(
        resolve(repositoryRoot, "distribution", "windows", "OpenRecall-Portable.cmd"),
        resolve(staging, "OpenRecall-Portable.cmd"),
      ),
      copyFile(
        resolve(repositoryRoot, "distribution", "windows", "Start-OpenRecall.ps1"),
        resolve(staging, "Start-OpenRecall.ps1"),
      ),
      copyFile(
        resolve(repositoryRoot, "distribution", "windows", "README.txt"),
        resolve(staging, "README.txt"),
      ),
    ]);
    await collectDependencyLicenseFiles({
      destination: resolve(staging, "licenses", "npm"),
      nodeModules: resolve(serverRoot, "node_modules"),
      repositoryRoot,
    });
    await writeFile(
      resolve(staging, "VERSION.txt"),
      `OpenRecall ${version}\nNode.js ${nodeVersion}\n`,
      "utf8",
    );
    await inspectStagingDirectory(staging);

    await Promise.all([
      rm(archivePath, { force: true }),
      rm(checksumPath, { force: true }),
    ]);
    await compressArchive(staging, archivePath);
    const archiveSha = await sha256File(archivePath);
    await writeFile(
      checksumPath,
      `${archiveSha}  ${names.archive}\n`,
      "utf8",
    );
    process.stdout.write(
      `OPENRECALL_WINDOWS_PACKAGE_OK archive=${archivePath} sha256=${archiveSha}\n`,
    );
  } finally {
    await rm(downloadRoot, { force: true, recursive: true }).catch(() => undefined);
    await rm(staging, { force: true, recursive: true }).catch(() => undefined);
    if (deployAttempted) {
      await runPnpm(["install", "--frozen-lockfile"], {
        ...process.env,
        CI: "true",
      }).catch(() => {
        process.stderr.write("OPENRECALL_PACKAGE_WORKSPACE_RESTORE_FAILED\n");
      });
    }
  }
}

function isDirectExecution() {
  return process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  try {
    await assembleWindowsPackage(
      parseWindowsPackageArguments(process.argv.slice(2)),
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
