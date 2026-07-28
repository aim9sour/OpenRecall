import {
  readFileSync,
  unwatchFile,
  watchFile,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../../apps/server/src/app.js";
import type { DueWakeService } from "../../apps/server/src/review/due-wake-service.js";
import { openDatabase } from "../../packages/database/src/index.js";

const INITIAL_NOW_MS = Date.UTC(2025, 0, 1, 12);
const clockPath = join(process.cwd(), "tests", "e2e", ".openrecall-clock");
writeFileSync(clockPath, String(INITIAL_NOW_MS), "utf8");
let currentNowMs = INITIAL_NOW_MS;

function refreshClock(): void {
  const candidate = Number(readFileSync(clockPath, "utf8"));
  if (Number.isSafeInteger(candidate) && candidate >= currentNowMs) {
    currentNowMs = candidate;
  }
}

const directory = await mkdtemp(join(tmpdir(), "openrecall-e2e-"));
const database = openDatabase(join(directory, "openrecall.sqlite3"));
let dueWake: Pick<DueWakeService, "rearm"> | undefined;
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
  nowMs: () => currentNowMs,
  onDueWakeReady(wake) {
    dueWake = wake;
  },
});

watchFile(clockPath, { interval: 20 }, () => {
  refreshClock();
  dueWake?.rearm();
});

async function stop(): Promise<void> {
  unwatchFile(clockPath);
  await server.close();
  await rm(directory, { force: true, recursive: true });
  await rm(clockPath, { force: true });
}

process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));

await server.listen({ host: "127.0.0.1", port: 3_210 });
