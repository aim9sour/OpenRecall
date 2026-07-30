import {
  copyFile,
  mkdir,
  readFile,
  rename as renameFile,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  createBackupService,
  BUSY_TIMEOUT_MS,
  coreMigration,
  migrateDatabase,
  openDatabase,
  SCHEMA_VERSION,
} from "@openrecall/database";
import { withTempDatabase } from "@openrecall/test-support";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { MaintenanceMode } from "./maintenance-mode.js";
import {
  RestoreService,
  type RestoreLifecycle,
} from "./restore-service.js";

function seedCurrent(path: string, id: string, name: string): void {
  const db = openDatabase(path);
  try {
    db.prepare(
      `
        INSERT INTO sections (id, name, created_at_ms, updated_at_ms)
        VALUES (?, ?, 1, 1)
      `,
    ).run(id, name);
  } finally {
    db.close();
  }
}

function seedVersionOne(path: string): void {
  const db = new Database(path);
  try {
    migrateDatabase(db, [coreMigration]);
    db.prepare(
      `
        INSERT INTO sections (id, name, created_at_ms, updated_at_ms)
        VALUES ('restored-v1', 'Version one', 1, 1)
      `,
    ).run();
  } finally {
    db.close();
  }
}

async function fileHash(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function harness(
  livePath: string,
  options: {
    readonly rename?: (from: string, to: string) => Promise<void>;
    readonly openFailureCount?: number;
  } = {},
) {
  let current = openDatabase(livePath);
  let remainingOpenFailures = options.openFailureCount ?? 0;
  const stopDue = vi.fn();
  const closeEvents = vi.fn();
  const rearmDue = vi.fn();
  const lifecycle: RestoreLifecycle = {
    stop: vi.fn(async () => {
      stopDue();
      closeEvents();
      current.close();
    }),
    open: vi.fn(async (path) => {
      if (remainingOpenFailures > 0) {
        remainingOpenFailures -= 1;
        throw new Error("SIMULATED_REOPEN_FAILURE");
      }
      current = openDatabase(path);
      rearmDue();
    }),
  };
  const root = dirname(livePath);
  const backups = createBackupService({
    db: current,
    snapshotDirectory: join(root, "backups"),
    nowMs: () => 9_000,
  });
  const service = new RestoreService({
    liveDatabasePath: livePath,
    workingDirectory: join(root, "restore-work"),
    maintenance: new MaintenanceMode(),
    backups,
    lifecycle,
    nowMs: () => 9_000,
    ...(options.rename === undefined
      ? {}
      : { fileSystem: { rename: options.rename } }),
  });
  return {
    service,
    lifecycle,
    stopDue,
    closeEvents,
    rearmDue,
    current: () => current,
  };
}

describe("RestoreService", () => {
  it("rejects corrupt, foreign, future-schema, and foreign-key-invalid files before stopping the live database", async () => {
    await withTempDatabase(async (livePath) => {
      seedCurrent(livePath, "current", "Current data");
      const root = dirname(livePath);
      const invalid = join(root, "invalid.sqlite3");
      await writeFile(invalid, "not sqlite");

      const wrongApplication = join(root, "wrong.sqlite3");
      const wrong = new Database(wrongApplication);
      wrong.pragma(`user_version = ${SCHEMA_VERSION}`);
      wrong.close();

      const future = join(root, "future.sqlite3");
      seedCurrent(future, "future", "Future");
      const futureDb = new Database(future);
      futureDb.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
      futureDb.close();

      const brokenForeignKey = join(root, "foreign-key.sqlite3");
      seedCurrent(brokenForeignKey, "valid", "Valid");
      const broken = new Database(brokenForeignKey);
      broken.pragma("foreign_keys = OFF");
      broken.prepare(
        `
          INSERT INTO learning_items
            (id, section_id, lifecycle, created_at_ms, updated_at_ms)
          VALUES ('orphan', 'missing', 'active', 1, 1)
        `,
      ).run();
      broken.close();

      const h = harness(livePath);
      try {
        const beforeHash = await fileHash(livePath);
        for (const [path, code] of [
          [invalid, "RESTORE_FILE_INVALID"],
          [wrongApplication, "RESTORE_APPLICATION_MISMATCH"],
          [future, "RESTORE_SCHEMA_FUTURE"],
          [brokenForeignKey, "RESTORE_FOREIGN_KEYS_INVALID"],
        ] as const) {
          await expect(
            h.service.restoreFromUpload(path, 1),
          ).rejects.toThrow(code);
        }
        expect(h.lifecycle.stop).not.toHaveBeenCalled();
        expect(await fileHash(livePath)).toBe(beforeHash);
        expect(
          h.current().prepare(
            "SELECT name FROM sections WHERE id = 'current'",
          ).pluck().get(),
        ).toBe("Current data");
      } finally {
        if (h.current().open) h.current().close();
      }
    });
  });

  it("migrates an older validated candidate separately, snapshots current data, swaps, reopens, and rearms", async () => {
    await withTempDatabase(async (livePath) => {
      seedCurrent(livePath, "current", "Current data");
      const root = dirname(livePath);
      const upload = join(root, "version-one-upload.sqlite3");
      seedVersionOne(upload);
      const h = harness(livePath);

      try {
        const result = await h.service.restoreFromUpload(upload, 1);

        expect(result).toMatchObject({
          databaseRevision: 2,
          restoredUserVersion: SCHEMA_VERSION,
          preRestoreBackupFilename: expect.stringMatching(
            /^openrecall-automatic-9000-/,
          ),
        });
        expect(h.stopDue).toHaveBeenCalledOnce();
        expect(h.closeEvents).toHaveBeenCalledOnce();
        expect(h.rearmDue).toHaveBeenCalledOnce();
        expect(
          h.current().pragma("user_version", { simple: true }),
        ).toBe(SCHEMA_VERSION);
        expect(
          h.current().pragma("busy_timeout", { simple: true }),
        ).toBe(BUSY_TIMEOUT_MS);
        expect(
          h.current().pragma("foreign_keys", { simple: true }),
        ).toBe(1);
        expect(
          h.current().pragma("journal_mode", { simple: true }),
        ).toBe("wal");
        expect(
          h.current().pragma("synchronous", { simple: true }),
        ).toBe(2);
        expect(
          h.current().pragma("trusted_schema", { simple: true }),
        ).toBe(0);
        expect(
          h.current().prepare(
            "SELECT name FROM sections WHERE id = 'restored-v1'",
          ).pluck().get(),
        ).toBe("Version one");
        expect(
          h.current().prepare(
            "SELECT count(*) FROM sections WHERE id = 'current'",
          ).pluck().get(),
        ).toBe(0);
        const backupFiles = await readFile(
          join(root, "backups", result.preRestoreBackupFilename),
        );
        expect(backupFiles.subarray(0, 16).toString("utf8")).toBe(
          "SQLite format 3\u0000",
        );
      } finally {
        if (h.current().open) h.current().close();
      }
    });
  });

  it("restores the rollback file and reopens old data after a Windows rename failure", async () => {
    await withTempDatabase(async (livePath) => {
      seedCurrent(livePath, "current", "Current data");
      const upload = join(dirname(livePath), "replacement.sqlite3");
      seedCurrent(upload, "replacement", "Replacement");
      let renameCount = 0;
      const rename = vi.fn(async (from: string, to: string) => {
        renameCount += 1;
        if (renameCount === 2) {
          throw new Error("EPERM");
        }
        await renameFile(from, to);
      });
      const h = harness(livePath, { rename });

      try {
        await expect(
          h.service.restoreFromUpload(upload, 1),
        ).rejects.toThrow("RESTORE_SWAP_FAILED");
        expect(
          h.current().prepare(
            "SELECT name FROM sections WHERE id = 'current'",
          ).pluck().get(),
        ).toBe("Current data");
        expect(
          h.current().prepare(
            "SELECT count(*) FROM sections WHERE id = 'replacement'",
          ).pluck().get(),
        ).toBe(0);
        expect(h.lifecycle.open).toHaveBeenCalledOnce();
      } finally {
        if (h.current().open) h.current().close();
      }
    });
  });

  it("restores and reopens old data when opening the replacement fails", async () => {
    await withTempDatabase(async (livePath) => {
      seedCurrent(livePath, "current", "Current data");
      const upload = join(dirname(livePath), "replacement.sqlite3");
      seedCurrent(upload, "replacement", "Replacement");
      const h = harness(livePath, { openFailureCount: 1 });

      try {
        await expect(
          h.service.restoreFromUpload(upload, 1),
        ).rejects.toThrow("RESTORE_SWAP_FAILED");
        expect(h.lifecycle.open).toHaveBeenCalledTimes(2);
        expect(
          h.current().prepare(
            "SELECT name FROM sections WHERE id = 'current'",
          ).pluck().get(),
        ).toBe("Current data");
      } finally {
        if (h.current().open) h.current().close();
      }
    });
  });
});
import { createHash } from "node:crypto";
