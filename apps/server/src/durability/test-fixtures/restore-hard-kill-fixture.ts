import { rename } from "node:fs/promises";
import Database from "better-sqlite3";
import { restoreSwapPaths } from "../restore-swap-recovery.js";

const phase = process.argv[2];
const livePath = process.argv[3];
const candidatePath = process.argv[4];

if (
  (
    phase !== "original-renamed" &&
    phase !== "replacement-installed" &&
    phase !== "committed" &&
    phase !== "fallback-live-quarantined" &&
    phase !== "fallback-sidecars-quarantined" &&
    phase !== "fallback-old-restored"
  ) ||
  livePath === undefined ||
  candidatePath === undefined ||
  typeof process.send !== "function"
) {
  throw new Error("HARD_KILL_FIXTURE_ARGUMENTS_INVALID");
}

const paths = restoreSwapPaths(livePath);
if (phase.startsWith("fallback-")) {
  await rename(livePath, paths.interruptedCandidate);
  if (phase !== "fallback-live-quarantined") {
    await rename(
      `${livePath}-wal`,
      `${paths.interruptedCandidate}-wal`,
    );
    await rename(
      `${livePath}-shm`,
      `${paths.interruptedCandidate}-shm`,
    );
  }
  if (phase === "fallback-old-restored") {
    await rename(paths.committedOld, livePath);
  }
} else {
  await rename(livePath, paths.rollback);
}

let replacement: Database.Database | undefined;
if (
  phase === "replacement-installed" ||
  phase === "committed"
) {
  await rename(candidatePath, livePath);
  replacement = new Database(livePath);
  replacement.pragma("journal_mode = WAL");
  replacement.prepare(
    `
      UPDATE sections
      SET name = 'replacement-open-during-hard-kill'
      WHERE id = 'replacement'
    `,
  ).run();
}

if (phase === "committed") {
  await rename(paths.rollback, paths.committedOld);
}

process.send("RESTORE_SWAP_PHASE_READY");
setInterval(() => {
  replacement?.pragma("user_version", { simple: true });
}, 1_000);
