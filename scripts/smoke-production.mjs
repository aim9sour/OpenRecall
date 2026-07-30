import { fork, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
const serverEntry = resolve(
  repositoryRoot,
  "apps/server/src/index.ts",
);
const origin = "http://127.0.0.1:3210";
const dataDirectory = await mkdtemp(
  join(tmpdir(), "openrecall-production-smoke-"),
);
let child;
let childOutput = "";

function runBuild() {
  return new Promise((resolveBuild, reject) => {
    const command =
      process.platform === "win32"
        ? (process.env.ComSpec ?? "cmd.exe")
        : "pnpm";
    const args =
      process.platform === "win32"
        ? ["/d", "/s", "/c", "pnpm build"]
        : ["build"];
    const build = spawn(command, args, {
      cwd: repositoryRoot,
      stdio: "inherit",
    });
    build.once("error", reject);
    build.once("exit", (code) => {
      if (code === 0) resolveBuild();
      else reject(new Error("OPENRECALL_SMOKE_BUILD_FAILED"));
    });
  });
}

function launchServer() {
  const options = {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      OPENRECALL_DATA_DIRECTORY: dataDirectory,
      OPENRECALL_HOST: "127.0.0.1",
      OPENRECALL_LOCALE: "en",
      OPENRECALL_PORT: "3210",
      OPENRECALL_PUBLIC_ORIGIN: origin,
    },
  };
  if (process.platform === "win32") {
    return fork(serverEntry, [], {
      ...options,
      execArgv: ["--import", "tsx"],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
  }
  return spawn(process.execPath, ["--import", "tsx", serverEntry], {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForReady(server, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (childOutput.includes(`OPENRECALL_READY ${origin}`)) return;
    if (childOutput.includes("OPENRECALL_ALREADY_RUNNING")) {
      throw new Error("OPENRECALL_SMOKE_PORT_UNAVAILABLE");
    }
    if (server.exitCode !== null) {
      throw new Error("OPENRECALL_SMOKE_SERVER_EXITED");
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("OPENRECALL_SMOKE_READY_TIMEOUT");
}

async function verifySecondLaunch() {
  const requireFromDatabase = createRequire(
    resolve(repositoryRoot, "packages/database/package.json"),
  );
  const Database = requireFromDatabase("better-sqlite3");
  const liveDatabase = new Database(
    join(dataDirectory, "openrecall.sqlite3"),
  );
  try {
    liveDatabase
      .prepare(
        `
          INSERT INTO optimizer_runs
            (
              id, scope_type, section_id, status, raw_review_count,
              eligible_example_count, source_review_cutoff_ms,
              package_version, algorithm_version, progress,
              created_at_ms, started_at_ms
            )
          VALUES
            (
              'production-smoke-running', 'global', NULL, 'running',
              500, 400, 10, 'smoke', 'smoke', 0.5, 100, 100
            )
        `,
      )
      .run();
  } finally {
    liveDatabase.close();
  }

  const second = launchServer();
  let output = "";
  second.stdout.setEncoding("utf8");
  second.stderr.setEncoding("utf8");
  second.stdout.on("data", (chunk) => {
    output += chunk;
  });
  second.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error("OPENRECALL_SMOKE_SECOND_TIMEOUT")),
      10_000,
    );
    timer.unref();
  });
  let code;
  try {
    [code] = await Promise.race([once(second, "exit"), timeout]);
  } catch (error) {
    await stopAfterFailure(second);
    throw error;
  }
  if (
    code !== 0 ||
    !output.includes(`OPENRECALL_ALREADY_RUNNING ${origin}`)
  ) {
    if (second.exitCode === null) second.kill();
    throw new Error("OPENRECALL_SMOKE_SECOND_INSTANCE_FAILED");
  }

  const verificationDatabase = new Database(
    join(dataDirectory, "openrecall.sqlite3"),
    { readonly: true },
  );
  try {
    const status = verificationDatabase
      .prepare(
        "SELECT status FROM optimizer_runs WHERE id = 'production-smoke-running'",
      )
      .pluck()
      .get();
    if (status !== "running") {
      throw new Error(
        "OPENRECALL_SMOKE_SECOND_INSTANCE_TOUCHED_DATABASE",
      );
    }
  } finally {
    verificationDatabase.close();
  }
}

async function checkedFetch(path, init) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    signal: AbortSignal.timeout(2_000),
  });
  return response;
}

async function shutdownServer(server) {
  if (server.exitCode !== null) return server.exitCode;
  if (process.platform === "win32" && server.connected) {
    server.send("OPENRECALL_SHUTDOWN");
  } else {
    server.kill("SIGTERM");
  }
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error("OPENRECALL_SMOKE_SHUTDOWN_TIMEOUT")),
      10_000,
    );
    timer.unref();
  });
  const [code] = await Promise.race([once(server, "exit"), timeout]);
  return code;
}

async function stopAfterFailure(server) {
  if (server.exitCode !== null) return;
  if (server.connected) server.send("OPENRECALL_SHUTDOWN");
  else server.kill();
  await Promise.race([
    once(server, "exit"),
    new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
  ]);
  if (server.exitCode === null) {
    server.kill();
    await Promise.race([
      once(server, "exit"),
      new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
    ]);
  }
}

function verifyDatabaseReopens() {
  const requireFromDatabase = createRequire(
    resolve(repositoryRoot, "packages/database/package.json"),
  );
  const Database = requireFromDatabase("better-sqlite3");
  const database = new Database(
    join(dataDirectory, "openrecall.sqlite3"),
    { readonly: true },
  );
  try {
    const integrity = database
      .pragma("quick_check", { simple: true });
    const sectionCount = database
      .prepare("SELECT COUNT(*) AS count FROM sections")
      .get().count;
    if (integrity !== "ok" || sectionCount !== 1) {
      throw new Error("OPENRECALL_SMOKE_DATABASE_INVALID");
    }
  } finally {
    database.close();
  }
}

try {
  await runBuild();
  child = launchServer();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    childOutput += chunk;
  });
  child.stderr.on("data", (chunk) => {
    childOutput += chunk;
  });
  await waitForReady(child);
  await verifySecondLaunch();

  const health = await checkedFetch("/api/v1/health");
  const healthBody = await health.json();
  if (
    !health.ok ||
    healthBody.app !== "OpenRecall" ||
    healthBody.apiVersion !== 1
  ) {
    throw new Error("OPENRECALL_SMOKE_HEALTH_FAILED");
  }

  const bootstrap = await checkedFetch("/api/v1/bootstrap");
  const { csrfToken } = await bootstrap.json();
  if (!bootstrap.ok || typeof csrfToken !== "string") {
    throw new Error("OPENRECALL_SMOKE_BOOTSTRAP_FAILED");
  }
  const created = await checkedFetch("/api/v1/sections", {
    body: JSON.stringify({ name: "Production smoke" }),
    headers: {
      "content-type": "application/json",
      "x-openrecall-csrf": csrfToken,
      origin,
    },
    method: "POST",
  });
  if (created.status !== 201) {
    throw new Error("OPENRECALL_SMOKE_MUTATION_FAILED");
  }

  const shell = await checkedFetch("/");
  const shellBody = await shell.text();
  if (
    !shell.ok ||
    !shell.headers.get("content-type")?.startsWith("text/html") ||
    !shellBody.includes('<div id="root">')
  ) {
    throw new Error("OPENRECALL_SMOKE_SHELL_FAILED");
  }

  const exitCode = await shutdownServer(child);
  if (exitCode !== 0) {
    throw new Error("OPENRECALL_SMOKE_UNCLEAN_EXIT");
  }
  verifyDatabaseReopens();
  process.stdout.write("OPENRECALL_SMOKE_OK\n");
} catch {
  if (child !== undefined && child.exitCode === null) {
    await stopAfterFailure(child);
  }
  process.stderr.write("OPENRECALL_SMOKE_FAILED\n");
  process.exitCode = 1;
} finally {
  if (child === undefined || child.exitCode !== null) {
    await rm(dataDirectory, { force: true, recursive: true });
  }
}
