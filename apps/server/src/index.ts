import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { openDatabase } from "@openrecall/database";
import { buildServer } from "./app.js";
import { loadConfig } from "./config.js";

async function start(): Promise<void> {
  const config = loadConfig();
  await mkdir(config.dataDirectory, { recursive: true });
  const database = openDatabase(join(config.dataDirectory, "openrecall.sqlite3"));
  const server = await buildServer({ config, database });
  await server.listen({ host: config.host, port: config.port });
}

void start().catch(() => {
  process.stderr.write("OPENRECALL_SERVER_START_FAILED\n");
  process.exitCode = 1;
});
