import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../../apps/server/src/app.js";
import { openDatabase } from "../../packages/database/src/index.js";

const directory = await mkdtemp(join(tmpdir(), "openrecall-e2e-"));
const database = openDatabase(join(directory, "openrecall.sqlite3"));
const server = await buildServer({
  config: {
    authority: "127.0.0.1:3210",
    dataDirectory: directory,
    host: "127.0.0.1",
    locale: "ar",
    port: 3_210,
    publicOrigin: "http://127.0.0.1:5173",
  },
  database,
});

async function stop(): Promise<void> {
  await server.close();
  await rm(directory, { force: true, recursive: true });
}

process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));

await server.listen({ host: "127.0.0.1", port: 3_210 });
