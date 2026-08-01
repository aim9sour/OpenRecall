import { fork } from "node:child_process";
import { access } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const serverEntry = fileURLToPath(
  new URL("./app/server/src/index.ts", import.meta.url),
);
const serverRoot = fileURLToPath(new URL("./app/server/", import.meta.url));
const stopFile = process.env["OPENRECALL_LAUNCHER_STOP_FILE"];
if (stopFile !== undefined && !isAbsolute(stopFile)) {
  process.stderr.write("OPENRECALL_LAUNCHER_STOP_FILE_INVALID\n");
  process.exit(1);
}

const server = fork(serverEntry, [], {
  cwd: serverRoot,
  env: process.env,
  execArgv: ["--import", "tsx"],
  execPath: process.execPath,
  stdio: ["inherit", "inherit", "inherit", "ipc"],
});
let shutdownStarted = false;
let stopFileTimer;
let shutdownTimer;

function requestShutdown() {
  if (shutdownStarted || server.exitCode !== null) return;
  shutdownStarted = true;
  if (server.connected) server.send("OPENRECALL_SHUTDOWN");
  shutdownTimer = setTimeout(() => {
    if (server.exitCode === null) server.kill();
  }, 10_000);
}

process.on("SIGINT", requestShutdown);
process.on("SIGTERM", requestShutdown);

if (stopFile !== undefined) {
  stopFileTimer = setInterval(() => {
    void access(stopFile).then(requestShutdown).catch(() => undefined);
  }, 100);
}

server.once("error", () => {
  process.stderr.write("OPENRECALL_LAUNCHER_SERVER_START_FAILED\n");
  process.exitCode = 1;
});
server.once("exit", (code) => {
  if (stopFileTimer !== undefined) clearInterval(stopFileTimer);
  if (shutdownTimer !== undefined) clearTimeout(shutdownTimer);
  process.exitCode = code ?? 1;
});
