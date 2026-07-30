import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabaseWithPreMigrationBackup } from "@openrecall/database";
import {
  buildServer,
  recoverInterruptedOptimizerRuns,
} from "./app.js";
import { loadConfig } from "./config.js";
import { recoverInterruptedRestoreSwap } from "./durability/restore-swap-recovery.js";
import { createJsonLinesLogSink } from "./logging.js";
import { productionStaticClientRoot } from "./production/static-client.js";
import {
  coordinateSingleInstance,
  installGracefulShutdown,
  preflightSingleInstance,
  StartupDiagnosticError,
} from "./startup/single-instance.js";

async function start(): Promise<void> {
  const config = loadConfig();
  const preflight = await preflightSingleInstance({
    host: config.host,
    port: config.port,
  });
  if (preflight.kind === "already-running") {
    process.stdout.write(
      `OPENRECALL_ALREADY_RUNNING ${preflight.url}\n`,
    );
    if (process.connected) process.disconnect();
    return;
  }

  let reservationReleased = false;
  const releaseReservation = async (): Promise<void> => {
    if (reservationReleased) return;
    await preflight.release();
    reservationReleased = true;
  };
  let server:
    | Awaited<ReturnType<typeof buildServer>>
    | undefined;
  let result:
    | Awaited<ReturnType<typeof coordinateSingleInstance>>
    | undefined;
  try {
    await mkdir(config.dataDirectory, { recursive: true });
    const logDirectory = join(config.dataDirectory, "logs");
    await mkdir(logDirectory, { recursive: true });
    const databasePath = join(
      config.dataDirectory,
      "openrecall.sqlite3",
    );
    const restoreRecovery =
      await recoverInterruptedRestoreSwap(databasePath);
    const database = await openDatabaseWithPreMigrationBackup(
      databasePath,
      {
        snapshotDirectory: join(config.dataDirectory, "backups"),
      },
    );
    await restoreRecovery.complete();
    const staticClientRoot = productionStaticClientRoot(
      fileURLToPath(new URL("../../web/dist", import.meta.url)),
      process.env,
    );
    server = await buildServer({
      config,
      database,
      logSink: createJsonLinesLogSink(
        join(logDirectory, "server.jsonl"),
      ),
      ...(staticClientRoot === undefined
        ? {}
        : { staticClientRoot }),
    });
    await releaseReservation();
    result = await coordinateSingleInstance({
      host: config.host,
      port: config.port,
      server,
    });
    if (result.kind === "started") {
      recoverInterruptedOptimizerRuns(server);
    }
  } catch (error) {
    await releaseReservation().catch(() => undefined);
    if (server !== undefined) {
      await server.close().catch(() => undefined);
    }
    throw error;
  }
  if (server === undefined || result === undefined) {
    throw new Error("OPENRECALL_STARTUP_STATE_INVALID");
  }
  if (result.kind === "already-running") {
    process.stdout.write(
      `OPENRECALL_ALREADY_RUNNING ${result.url}\n`,
    );
    if (process.connected) process.disconnect();
    return;
  }

  const onShutdownError = (): void => {
    process.stderr.write("OPENRECALL_SERVER_SHUTDOWN_FAILED\n");
    process.exitCode = 1;
  };
  const shutdown = installGracefulShutdown({
    onError: onShutdownError,
    server,
    signals: process,
  });
  if (typeof process.send === "function") {
    process.once("message", (message: unknown) => {
      if (message !== "OPENRECALL_SHUTDOWN") return;
      void shutdown
        .shutdown()
        .then(() => process.disconnect())
        .catch(onShutdownError);
    });
  }
  process.stdout.write(`OPENRECALL_READY ${result.url}\n`);
}

void start().catch((error: unknown) => {
  const diagnostic =
    error instanceof StartupDiagnosticError
      ? error.code
      : "OPENRECALL_SERVER_START_FAILED";
  process.stderr.write(`${diagnostic}\n`);
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
