import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  lstat,
  rename,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  openDatabase,
  openExistingDatabaseWithPreMigrationBackup,
} from "@openrecall/database";
import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import {
  recoverInterruptedRestoreSwap,
  restoreSwapPaths,
} from "./restore-swap-recovery.js";

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

function seed(path: string, id: string): void {
  const database = openDatabase(path);
  try {
    database.prepare(
      `
        INSERT INTO sections (id, name, created_at_ms, updated_at_ms)
        VALUES (?, ?, 1, 1)
      `,
    ).run(id, id);
  } finally {
    database.close();
  }
}

function sectionIds(path: string): readonly string[] {
  const database = openDatabase(path);
  try {
    return database.prepare(
      "SELECT id FROM sections ORDER BY id",
    ).pluck().all() as string[];
  } finally {
    database.close();
  }
}

function sectionNames(path: string): readonly string[] {
  const database = openDatabase(path);
  try {
    return database.prepare(
      "SELECT name FROM sections ORDER BY id",
    ).pluck().all() as string[];
  } finally {
    database.close();
  }
}

async function hardKillAt(
  phase:
    | "original-renamed"
    | "replacement-installed"
    | "committed",
  livePath: string,
  candidatePath: string,
): Promise<void> {
  const fixture = fileURLToPath(
    new URL(
      "./test-fixtures/restore-hard-kill-fixture.ts",
      import.meta.url,
    ),
  );
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      fixture,
      phase,
      livePath,
      candidatePath,
    ],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  const stderr: Buffer[] = [];
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr.push(chunk);
  });
  const [message] = await Promise.race([
    once(child, "message"),
    once(child, "exit").then(([code]) => {
      throw new Error(
        `HARD_KILL_FIXTURE_EXITED_${String(code)}: ${Buffer.concat(stderr).toString("utf8")}`,
      );
    }),
  ]);
  if (message !== "RESTORE_SWAP_PHASE_READY") {
    child.kill();
    throw new Error("HARD_KILL_FIXTURE_PROTOCOL_INVALID");
  }
  child.kill();
  await once(child, "exit");
}

describe("interrupted restore swap recovery", () => {
  it("restores the original database when the process ended after the first rename", async () => {
    await withTempDatabase(async (livePath) => {
      seed(livePath, "original");
      const paths = restoreSwapPaths(livePath);
      await rename(livePath, paths.rollback);

      const recovery =
        await recoverInterruptedRestoreSwap(livePath);

      expect(sectionIds(livePath)).toEqual(["original"]);
      expect(await exists(paths.rollback)).toBe(false);
      await recovery.complete();
    });
  });

  it("rolls back an installed but uncommitted replacement and its exact SQLite sidecars", async () => {
    await withTempDatabase(async (livePath) => {
      seed(livePath, "original");
      const paths = restoreSwapPaths(livePath);
      await rename(livePath, paths.rollback);
      seed(livePath, "replacement");
      await writeFile(`${livePath}-wal`, "replacement wal");
      await writeFile(`${livePath}-shm`, "replacement shm");

      const recovery =
        await recoverInterruptedRestoreSwap(livePath);

      expect(sectionIds(livePath)).toEqual(["original"]);
      expect(await exists(paths.interruptedCandidate)).toBe(true);
      expect(
        await exists(`${paths.interruptedCandidate}-wal`),
      ).toBe(true);
      expect(
        await exists(`${paths.interruptedCandidate}-shm`),
      ).toBe(true);

      await recovery.complete();

      expect(await exists(paths.interruptedCandidate)).toBe(false);
      expect(
        await exists(`${paths.interruptedCandidate}-wal`),
      ).toBe(false);
      expect(
        await exists(`${paths.interruptedCandidate}-shm`),
      ).toBe(false);
    });
  });

  it("keeps a replacement after the atomic commit point and cleans the old database only after validation", async () => {
    await withTempDatabase(async (livePath) => {
      seed(livePath, "replacement");
      const paths = restoreSwapPaths(livePath);
      seed(paths.committedOld, "original");

      const recovery =
        await recoverInterruptedRestoreSwap(livePath);

      expect(sectionIds(livePath)).toEqual(["replacement"]);
      expect(await exists(paths.committedOld)).toBe(true);

      await recovery.complete();

      expect(await exists(paths.committedOld)).toBe(false);
      expect(sectionIds(livePath)).toEqual(["replacement"]);
    });
  });

  it("falls back to the committed old database when the replacement disappeared", async () => {
    await withTempDatabase(async (livePath) => {
      const paths = restoreSwapPaths(livePath);
      seed(paths.committedOld, "original");

      const recovery =
        await recoverInterruptedRestoreSwap(livePath);

      expect(sectionIds(livePath)).toEqual(["original"]);
      expect(await exists(paths.committedOld)).toBe(false);
      await recovery.complete();
    });
  });

  it("fails closed for conflicting swap markers instead of guessing", async () => {
    await withTempDatabase(async (livePath) => {
      const paths = restoreSwapPaths(livePath);
      seed(paths.rollback, "rollback");
      seed(paths.committedOld, "committed");

      await expect(
        recoverInterruptedRestoreSwap(livePath),
      ).rejects.toThrow("RESTORE_SWAP_STATE_CONFLICT");
      expect(await exists(paths.rollback)).toBe(true);
      expect(await exists(paths.committedOld)).toBe(true);
      expect(await exists(livePath)).toBe(false);
    });
  });

  it("fails closed rather than overwriting an existing interrupted candidate", async () => {
    await withTempDatabase(async (livePath) => {
      seed(livePath, "replacement");
      const paths = restoreSwapPaths(livePath);
      seed(paths.rollback, "original");
      seed(paths.interruptedCandidate, "earlier");

      await expect(
        recoverInterruptedRestoreSwap(livePath),
      ).rejects.toThrow("RESTORE_SWAP_STATE_CONFLICT");
      expect(sectionIds(livePath)).toEqual(["replacement"]);
      expect(sectionIds(paths.rollback)).toEqual(["original"]);
      expect(sectionIds(paths.interruptedCandidate)).toEqual([
        "earlier",
      ]);
    });
  });

  it("fails closed before any rename when rollback is mixed with an interrupted sidecar", async () => {
    await withTempDatabase(async (livePath) => {
      seed(livePath, "replacement");
      const paths = restoreSwapPaths(livePath);
      seed(paths.rollback, "original");
      await writeFile(
        `${paths.interruptedCandidate}-wal`,
        "conflicting wal",
      );

      await expect(
        recoverInterruptedRestoreSwap(livePath),
      ).rejects.toThrow("RESTORE_SWAP_STATE_CONFLICT");
      expect(sectionIds(livePath)).toEqual(["replacement"]);
      expect(sectionIds(paths.rollback)).toEqual(["original"]);
      expect(
        await exists(`${paths.interruptedCandidate}-wal`),
      ).toBe(true);
    });
  });

  it("fails closed when a committed-old marker is mixed with interrupted artifacts", async () => {
    await withTempDatabase(async (livePath) => {
      seed(livePath, "replacement");
      const paths = restoreSwapPaths(livePath);
      seed(paths.committedOld, "original");
      seed(paths.interruptedCandidate, "conflict");

      await expect(
        recoverInterruptedRestoreSwap(livePath),
      ).rejects.toThrow("RESTORE_SWAP_STATE_CONFLICT");
      expect(sectionIds(livePath)).toEqual(["replacement"]);
      expect(sectionIds(paths.committedOld)).toEqual(["original"]);
      expect(sectionIds(paths.interruptedCandidate)).toEqual([
        "conflict",
      ]);
    });
  });

  it("falls back to committed-old when strict recovery open rejects an empty live file", async () => {
    await withTempDatabase(async (livePath) => {
      const paths = restoreSwapPaths(livePath);
      await writeFile(livePath, "");
      seed(paths.committedOld, "original");

      const recovery =
        await recoverInterruptedRestoreSwap(livePath);
      expect(recovery.requiresExistingDatabase).toBe(true);
      await expect(
        openExistingDatabaseWithPreMigrationBackup(livePath, {
          snapshotDirectory: `${livePath}.snapshots`,
        }),
      ).rejects.toThrow("DATABASE_EXISTING_IDENTITY_REQUIRED");

      expect(await recovery.recoverAfterOpenFailure()).toBe(true);
      const database =
        await openExistingDatabaseWithPreMigrationBackup(livePath, {
          snapshotDirectory: `${livePath}.snapshots`,
        });
      try {
        expect(
          database.prepare(
            "SELECT name FROM sections WHERE id = 'original'",
          ).pluck().get(),
        ).toBe("original");
      } finally {
        database.close();
      }
      await recovery.complete();
      expect(await exists(paths.interruptedCandidate)).toBe(false);
    });
  });

  it("never creates an empty live database when only an interrupted candidate remains", async () => {
    await withTempDatabase(async (livePath) => {
      const paths = restoreSwapPaths(livePath);
      seed(paths.interruptedCandidate, "replacement");

      await expect(
        recoverInterruptedRestoreSwap(livePath),
      ).rejects.toThrow("RESTORE_SWAP_STATE_CONFLICT");
      expect(await exists(livePath)).toBe(false);
      expect(sectionIds(paths.interruptedCandidate)).toEqual([
        "replacement",
      ]);
    });
  });

  it.each([
    ["original-renamed", "original", "original"],
    ["replacement-installed", "original", "original"],
    [
      "committed",
      "replacement",
      "replacement-open-during-hard-kill",
    ],
  ] as const)(
    "reopens the correct database after a hard process termination at %s",
    async (phase, expectedId, expectedName) => {
      await withTempDatabase(async (livePath) => {
        seed(livePath, "original");
        const candidatePath = `${livePath}.candidate`;
        seed(candidatePath, "replacement");

        await hardKillAt(phase, livePath, candidatePath);

        const recovery =
          await recoverInterruptedRestoreSwap(livePath);
        expect(sectionIds(livePath)).toEqual([expectedId]);
        expect(sectionNames(livePath)).toEqual([expectedName]);
        await recovery.complete();
      });
    },
  );
});
