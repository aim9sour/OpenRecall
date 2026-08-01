import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withTempDatabase } from "@openrecall/test-support";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import type { BackupService } from "./backup-service.js";
import { APPLICATION_ID, SCHEMA_VERSION } from "./constants.js";
import { migrateDatabase } from "./migrate.js";
import { coreMigration } from "./migrations/001-core.js";
import { reviewCoreMigration } from "./migrations/002-review-core.js";
import { cardManagementMigration } from "./migrations/003-card-management.js";
import { statisticsMigration } from "./migrations/004-statistics.js";
import { settingsOptimizerMigration } from "./migrations/005-settings-optimizer.js";
import {
  isExistingDatabaseValidationError,
  openDatabase,
  openDatabaseWithPreMigrationBackup,
  openExistingDatabaseWithPreMigrationBackup,
} from "./open-database.js";

const versionFiveMigrations = [
  coreMigration,
  reviewCoreMigration,
  cardManagementMigration,
  statisticsMigration,
  settingsOptimizerMigration,
] as const;

function createVersionFiveDatabase(path: string): void {
  const db = new Database(path);
  try {
    migrateDatabase(db, versionFiveMigrations);
    db.prepare(
      `
        INSERT INTO sections (id, name, created_at_ms, updated_at_ms)
        VALUES ('legacy-section', 'Kept data', 1, 1)
      `,
    ).run();
  } finally {
    db.close();
  }
}

describe("pre-migration backup", () => {
  it("validates an automatic old-schema snapshot before migrating an existing database", async () => {
    await withTempDatabase(async (databasePath) => {
      createVersionFiveDatabase(databasePath);
      const snapshotDirectory = join(dirname(databasePath), "snapshots");

      const db = await openDatabaseWithPreMigrationBackup(databasePath, {
        snapshotDirectory,
        nowMs: () => 5_000,
      });
      try {
        expect(db.pragma("user_version", { simple: true })).toBe(
          SCHEMA_VERSION,
        );
        expect(
          db.prepare(
            "SELECT name FROM sections WHERE id = 'legacy-section'",
          ).pluck().get(),
        ).toBe("Kept data");
        const files = await readdir(snapshotDirectory);
        expect(files).toHaveLength(1);
        expect(files[0]).toMatch(
          /^openrecall-automatic-5000-[0-9a-f-]{36}\.sqlite3$/,
        );
        const snapshot = new Database(
          join(snapshotDirectory, files[0]!),
          { readonly: true, fileMustExist: true },
        );
        try {
          expect(
            snapshot.pragma("application_id", { simple: true }),
          ).toBe(APPLICATION_ID);
          expect(
            snapshot.pragma("user_version", { simple: true }),
          ).toBe(5);
          expect(
            snapshot.prepare(
              "SELECT name FROM sections WHERE id = 'legacy-section'",
            ).pluck().get(),
          ).toBe("Kept data");
        } finally {
          snapshot.close();
        }
      } finally {
        db.close();
      }
    });
  });

  it("does not migrate when snapshot validation fails and requires the guarded API for old schemas", async () => {
    await withTempDatabase(async (databasePath) => {
      createVersionFiveDatabase(databasePath);
      expect(() => openDatabase(databasePath)).toThrow(
        "DATABASE_PRE_MIGRATION_BACKUP_REQUIRED",
      );
      const invalidBackup: BackupService = {
        createSnapshot: vi.fn(async () => ({
          kind: "automatic" as const,
          filename: "invalid.sqlite3",
          path: "invalid.sqlite3",
          createdAtMs: 5_000,
        })),
        validateSnapshot: vi.fn(async () => {
          throw new Error("BACKUP_QUICK_CHECK_FAILED");
        }),
      };

      await expect(
        openDatabaseWithPreMigrationBackup(databasePath, {
          snapshotDirectory: join(dirname(databasePath), "snapshots"),
          nowMs: () => 5_000,
          backupFactory: () => invalidBackup,
        }),
      ).rejects.toThrow("BACKUP_QUICK_CHECK_FAILED");

      const unchanged = new Database(databasePath, {
        readonly: true,
        fileMustExist: true,
      });
      try {
        expect(
          unchanged.pragma("user_version", { simple: true }),
        ).toBe(5);
        expect(
          unchanged
            .prepare(
              "SELECT count(*) FROM pragma_foreign_key_list('review_sessions') WHERE [from] = 'section_id' AND on_delete = 'CASCADE'",
            )
            .pluck()
            .get(),
        ).toBe(0);
      } finally {
        unchanged.close();
      }
    });
  });

  it("does not create a snapshot for a new empty database", async () => {
    await withTempDatabase(async (databasePath) => {
      const backupFactory = vi.fn();
      const db = await openDatabaseWithPreMigrationBackup(databasePath, {
        snapshotDirectory: join(dirname(databasePath), "snapshots"),
        nowMs: () => 5_000,
        backupFactory,
      });
      try {
        expect(db.pragma("user_version", { simple: true })).toBe(
          SCHEMA_VERSION,
        );
        expect(backupFactory).not.toHaveBeenCalled();
      } finally {
        db.close();
      }
    });
  });

  it("keeps an operational pre-migration backup failure distinct from database validation failure", async () => {
    await withTempDatabase(async (databasePath) => {
      createVersionFiveDatabase(databasePath);
      const transient = new Error("TRANSIENT_BACKUP_FAILURE");
      const failingBackup: BackupService = {
        createSnapshot: vi.fn(async () => {
          throw transient;
        }),
        validateSnapshot: vi.fn(),
      };

      const opening =
        openExistingDatabaseWithPreMigrationBackup(databasePath, {
          snapshotDirectory: join(
            dirname(databasePath),
            "snapshots",
          ),
          backupFactory: () => failingBackup,
        });
      await expect(opening).rejects.toBe(transient);
      await opening.catch((error: unknown) => {
        expect(isExistingDatabaseValidationError(error)).toBe(
          false,
        );
      });

      const unchanged = new Database(databasePath, {
        readonly: true,
        fileMustExist: true,
      });
      try {
        expect(
          unchanged.pragma("user_version", { simple: true }),
        ).toBe(5);
      } finally {
        unchanged.close();
      }
    });
  });
});
