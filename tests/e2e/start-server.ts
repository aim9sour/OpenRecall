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
import { seedOptimizerFixture } from "./seed-optimizer-fixture.js";
import { e2eClockPath } from "./e2e-paths.js";

const INITIAL_NOW_MS = Date.UTC(2025, 0, 1, 12);
const serverPort = Number(process.env["OPENRECALL_E2E_API_PORT"] ?? "3210");
const webPort = Number(process.env["OPENRECALL_E2E_WEB_PORT"] ?? "5173");
const localeCandidate = process.env["OPENRECALL_E2E_LOCALE"];
const locale =
  localeCandidate === "en-XA"
    ? "en-XA"
    : localeCandidate === "en"
      ? "en"
      : "ar";
const clockPath = e2eClockPath(serverPort);
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
seedOptimizerFixture(database);
let dueWake: Pick<DueWakeService, "rearm"> | undefined;
const server = await buildServer({
  config: {
    authority: `127.0.0.1:${serverPort}`,
    dataDirectory: directory,
    host: "127.0.0.1",
    locale,
    port: serverPort,
    publicOrigin: `http://127.0.0.1:${webPort}`,
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

await server.listen({ host: "127.0.0.1", port: serverPort });
