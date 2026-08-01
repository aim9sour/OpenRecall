import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectStagingDirectory } from "./release/windows-package-core.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const origin = "http://127.0.0.1:3210";
export const windowsSmokeCleanupOptions = Object.freeze({
  force: true,
  maxRetries: 20,
  recursive: true,
  retryDelay: 250,
});

function smokeError(code, detail) {
  return new Error(detail === undefined ? code : `${code}:${detail}`);
}

export function parseWindowsSmokeArguments(args) {
  if (
    args.length !== 2 ||
    args[0] !== "--archive" ||
    args[1] === undefined ||
    !isAbsolute(args[1])
  ) {
    throw smokeError("OPENRECALL_PACKAGE_SMOKE_ARGUMENT_INVALID");
  }
  return { archive: resolve(args[1]) };
}

export function cmdLauncherArguments(launcher) {
  return ["/d", "/s", "/c", `call "${launcher}"`];
}

export function cmdLauncherSpawnOptions(options) {
  return {
    ...options,
    windowsHide: true,
    windowsVerbatimArguments: true,
  };
}

export async function extractWindowsArchive(archive, destination) {
  await mkdir(destination, { recursive: true });
  await new Promise((resolveRun, reject) => {
    const child = spawn(
      "tar.exe",
      ["-xf", archive, "-C", destination],
      { stdio: "inherit", windowsHide: true },
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(smokeError("OPENRECALL_PACKAGE_SMOKE_EXTRACT_FAILED"));
    });
  });
}

async function endpointIsServing() {
  try {
    const response = await fetch(`${origin}/api/v1/health`, {
      signal: AbortSignal.timeout(750),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function launcherOutputIsReady(output) {
  return output.split(/\r?\n/u).some(
    (line) => line === `OPENRECALL_LAUNCHER_READY ${origin}`,
  );
}

async function waitForReady(child, output) {
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    if (launcherOutputIsReady(output.value) && await endpointIsServing()) {
      return;
    }
    if (child.exitCode !== null) {
      throw smokeError(
        "OPENRECALL_PACKAGE_SMOKE_LAUNCHER_EXITED",
        output.value.slice(-1_000),
      );
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw smokeError("OPENRECALL_PACKAGE_SMOKE_READY_TIMEOUT");
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return child.exitCode;
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(
      () => reject(smokeError("OPENRECALL_PACKAGE_SMOKE_EXIT_TIMEOUT")),
      timeoutMs,
    );
    timer.unref();
  });
  const [code] = await Promise.race([once(child, "exit"), timeout]);
  return code;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function prepareLauncherControlDirectory(localAppData) {
  await mkdir(localAppData, { recursive: true });
}

function verifyDatabase(path) {
  const requireFromDatabase = createRequire(
    resolve(repositoryRoot, "packages/database/package.json"),
  );
  const Database = requireFromDatabase("better-sqlite3");
  const database = new Database(path, { readonly: true });
  try {
    if (database.pragma("quick_check", { simple: true }) !== "ok") {
      throw smokeError("OPENRECALL_PACKAGE_SMOKE_DATABASE_INVALID");
    }
  } finally {
    database.close();
  }
}

async function runMode({ extractedRoot, mode, localAppData }) {
  await prepareLauncherControlDirectory(localAppData);
  const launcher = resolve(
    extractedRoot,
    mode === "Normal" ? "OpenRecall.cmd" : "OpenRecall-Portable.cmd",
  );
  const stopFile = resolve(
    localAppData,
    `openrecall-${mode.toLowerCase()}-stop.signal`,
  );
  const environment = {
    ...process.env,
    LOCALAPPDATA: localAppData,
    OPENRECALL_LAUNCHER_NO_BROWSER: "1",
    OPENRECALL_LAUNCHER_STOP_FILE: stopFile,
  };
  delete environment.OPENRECALL_DATA_DIRECTORY;
  const child = spawn(
    process.env.ComSpec ?? "cmd.exe",
    cmdLauncherArguments(launcher),
    cmdLauncherSpawnOptions({
      cwd: extractedRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const output = { value: "" };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output.value += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output.value += chunk;
  });
  try {
    await waitForReady(child, output);
    const databasePath = mode === "Normal"
      ? resolve(localAppData, "OpenRecall-nodejs", "Data", "openrecall.sqlite3")
      : resolve(extractedRoot, "Data", "openrecall.sqlite3");
    const forbiddenDatabase = mode === "Normal"
      ? resolve(extractedRoot, "Data", "openrecall.sqlite3")
      : resolve(localAppData, "OpenRecall-nodejs", "Data", "openrecall.sqlite3");
    if (!await pathExists(databasePath) || await pathExists(forbiddenDatabase)) {
      throw smokeError("OPENRECALL_PACKAGE_SMOKE_DATA_ISOLATION_FAILED", mode);
    }
    await writeFile(stopFile, "stop\n", "utf8");
    const exitCode = await waitForExit(child, 20_000);
    if (exitCode !== 0) {
      throw smokeError(
        "OPENRECALL_PACKAGE_SMOKE_LAUNCHER_FAILED",
        `${mode}:${exitCode}:${output.value.slice(-1_000)}`,
      );
    }
    verifyDatabase(databasePath);
  } catch (error) {
    if (child.exitCode === null) {
      await writeFile(stopFile, "stop\n", "utf8").catch(() => undefined);
      await waitForExit(child, 12_000).catch(() => child.kill());
    }
    throw error;
  }
}

async function smokeWindowsPackage({ archive }) {
  if (process.platform !== "win32") {
    throw smokeError("OPENRECALL_PACKAGE_SMOKE_WINDOWS_REQUIRED");
  }
  if (await endpointIsServing()) {
    throw smokeError("OPENRECALL_PACKAGE_SMOKE_PORT_UNAVAILABLE");
  }
  await access(archive);
  const root = await mkdtemp(join(tmpdir(), "openrecall-package-smoke-"));
  const extractedRoot = resolve(root, "extracted");
  const normalLocalAppData = resolve(root, "normal-local-app-data");
  const portableLocalAppData = resolve(root, "portable-local-app-data");
  try {
    process.stdout.write("OPENRECALL_WINDOWS_PACKAGE_SMOKE phase=extract\n");
    await extractWindowsArchive(archive, extractedRoot);
    process.stdout.write("OPENRECALL_WINDOWS_PACKAGE_SMOKE phase=inspect\n");
    await inspectStagingDirectory(extractedRoot);
    process.stdout.write("OPENRECALL_WINDOWS_PACKAGE_SMOKE phase=normal\n");
    await runMode({
      extractedRoot,
      localAppData: normalLocalAppData,
      mode: "Normal",
    });
    if (await endpointIsServing()) {
      throw smokeError("OPENRECALL_PACKAGE_SMOKE_SERVER_STILL_RUNNING");
    }
    process.stdout.write("OPENRECALL_WINDOWS_PACKAGE_SMOKE phase=portable\n");
    await runMode({
      extractedRoot,
      localAppData: portableLocalAppData,
      mode: "Portable",
    });
    if (await endpointIsServing()) {
      throw smokeError("OPENRECALL_PACKAGE_SMOKE_SERVER_STILL_RUNNING");
    }
    process.stdout.write("OPENRECALL_WINDOWS_PACKAGE_SMOKE_OK modes=2\n");
  } finally {
    await rm(root, windowsSmokeCleanupOptions);
  }
}

function isDirectExecution() {
  return process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  try {
    await smokeWindowsPackage(
      parseWindowsSmokeArguments(process.argv.slice(2)),
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
