import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabaseWithPreMigrationBackup } from "@openrecall/database";
import { buildServer } from "./app.js";
import { loadConfig } from "./config.js";
import { createJsonLinesLogSink } from "./logging.js";
import { productionStaticClientRoot } from "./production/static-client.js";

async function start(): Promise<void> {
  const config = loadConfig();
  await mkdir(config.dataDirectory, { recursive: true });
  const logDirectory = join(config.dataDirectory, "logs");
  await mkdir(logDirectory, { recursive: true });
  const database = await openDatabaseWithPreMigrationBackup(
    join(config.dataDirectory, "openrecall.sqlite3"),
    {
      snapshotDirectory: join(config.dataDirectory, "backups"),
    },
  );
  const staticClientRoot = productionStaticClientRoot(
    fileURLToPath(new URL("../../web/dist", import.meta.url)),
    process.env,
  );
  const server = await buildServer({
    config,
    database,
    logSink: createJsonLinesLogSink(
      join(logDirectory, "server.jsonl"),
    ),
    ...(staticClientRoot === undefined
      ? {}
      : { staticClientRoot }),
  });
  await server.listen({ host: config.host, port: config.port });
}

void start().catch(() => {
  process.stderr.write("OPENRECALL_SERVER_START_FAILED\n");
  process.exitCode = 1;
});
