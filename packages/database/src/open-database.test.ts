import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { APPLICATION_ID, SCHEMA_VERSION } from "./constants.js";
import { migrateDatabase } from "./migrate.js";
import {
  isExistingDatabaseValidationError,
  openDatabase,
  openExistingDatabaseWithPreMigrationBackup,
} from "./open-database.js";

describe("openDatabase", () => {
  it("enforces and verifies the durable connection policy", async () => {
    await withTempDatabase((databasePath) => {
      expect(SCHEMA_VERSION).toBe(6);
      const db = openDatabase(databasePath);

      try {
        expect(db.pragma("busy_timeout", { simple: true })).toBe(5_000);
        expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
        expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
        expect(db.pragma("synchronous", { simple: true })).toBe(2);
        expect(db.pragma("trusted_schema", { simple: true })).toBe(0);
        expect(db.pragma("application_id", { simple: true })).toBe(
          APPLICATION_ID,
        );
        expect(db.pragma("user_version", { simple: true })).toBe(
          SCHEMA_VERSION,
        );
      } finally {
        db.close();
      }
    });
  });

  it("creates the core schema and cascades section deletion", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        const schemaObjects = db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type IN ('table', 'index')",
          )
          .pluck()
          .all();

        expect(schemaObjects).toEqual(
          expect.arrayContaining([
            "sections",
            "learning_items",
            "presentations",
            "presentation_exposures",
            "application_settings",
            "idx_learning_items_section_active",
            "idx_presentations_learning_item_order",
          ]),
        );

        db.exec(`
          INSERT INTO sections
            (id, name, created_at_ms, updated_at_ms)
          VALUES
            ('section-1', 'Biology', 1000, 1000);

          INSERT INTO learning_items
            (id, section_id, lifecycle, created_at_ms, updated_at_ms)
          VALUES
            ('item-active', 'section-1', 'active', 1000, 1000),
            ('item-trashed', 'section-1', 'trashed', 1000, 1000);

          INSERT INTO presentations
            (
              id,
              learning_item_id,
              kind,
              ordinal,
              front,
              back,
              notes,
              normalized_front,
              normalized_back
            )
          VALUES
            (
              'presentation-active',
              'item-active',
              'primary',
              0,
              'Question',
              'Answer',
              NULL,
              'question',
              'answer'
            ),
            (
              'presentation-trashed',
              'item-trashed',
              'primary',
              0,
              'Old question',
              'Old answer',
              NULL,
              'old question',
              'old answer'
            );

          INSERT INTO presentation_exposures
            (presentation_id, show_count)
          VALUES
            ('presentation-active', 1),
            ('presentation-trashed', 2);

          DELETE FROM sections WHERE id = 'section-1';
        `);

        for (const table of [
          "learning_items",
          "presentations",
          "presentation_exposures",
        ]) {
          const count = db
            .prepare(`SELECT count(*) FROM ${table}`)
            .pluck()
            .get();
          expect(count).toBe(0);
        }
      } finally {
        db.close();
      }
    });
  });

  it("rolls back every change made by a failed migration", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        let foreignKeysDuringMigration: number | undefined;
        expect(() =>
          migrateDatabase(db, [
            {
              version: SCHEMA_VERSION + 1,
              up(database) {
                foreignKeysDuringMigration = database.pragma(
                  "foreign_keys",
                  { simple: true },
                ) as number;
                database.exec(
                  "CREATE TABLE must_be_rolled_back (id TEXT PRIMARY KEY) STRICT;",
                );
                throw new Error("EXPECTED_TEST_MIGRATION_FAILURE");
              },
            },
          ]),
        ).toThrow("EXPECTED_TEST_MIGRATION_FAILURE");

        expect(foreignKeysDuringMigration).toBe(0);
        expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
        expect(db.pragma("user_version", { simple: true })).toBe(
          SCHEMA_VERSION,
        );
        expect(
          db
            .prepare(
              "SELECT count(*) FROM sqlite_schema WHERE name = 'must_be_rolled_back'",
            )
            .pluck()
            .get(),
        ).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  it("restores an intentionally disabled foreign-key pragma after migration", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        db.pragma("foreign_keys = OFF");
        migrateDatabase(db, [
          {
            version: SCHEMA_VERSION + 1,
            up(database) {
              expect(
                database.pragma("foreign_keys", { simple: true }),
              ).toBe(0);
              database.exec(
                "CREATE TABLE migration_with_fk_off (id TEXT PRIMARY KEY) STRICT;",
              );
            },
          },
        ]);
        expect(db.pragma("foreign_keys", { simple: true })).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  it("never initializes an empty or missing file through the existing-database recovery path", async () => {
    await withTempDatabase(async (databasePath) => {
      await writeFile(databasePath, "");
      const before = await readFile(databasePath);

      const invalidOpen =
        openExistingDatabaseWithPreMigrationBackup(databasePath, {
          snapshotDirectory: join(
            dirname(databasePath),
            "snapshots",
          ),
        });
      await expect(invalidOpen).rejects.toThrow(
        "DATABASE_EXISTING_IDENTITY_REQUIRED",
      );
      await invalidOpen.catch((error: unknown) => {
        expect(isExistingDatabaseValidationError(error)).toBe(
          true,
        );
      });
      expect(
        isExistingDatabaseValidationError(
          new Error("TRANSIENT_BACKUP_FAILURE"),
        ),
      ).toBe(false);
      expect(await readFile(databasePath)).toEqual(before);

      const missing = `${databasePath}.missing`;
      await expect(
        openExistingDatabaseWithPreMigrationBackup(missing, {
          snapshotDirectory: join(
            dirname(databasePath),
            "snapshots",
          ),
        }),
      ).rejects.toThrow();
      await expect(readFile(missing)).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });
});
