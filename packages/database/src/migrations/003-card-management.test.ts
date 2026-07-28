import { withTempDatabase } from "@openrecall/test-support";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrateDatabase } from "../migrate.js";
import { coreMigration } from "./001-core.js";
import { reviewCoreMigration } from "./002-review-core.js";

describe("card management migration", () => {
  it("keeps existing presentations active while adding retirement support", async () => {
    await withTempDatabase((databasePath) => {
      const db = new Database(databasePath);
      db.pragma("foreign_keys = ON");
      try {
        migrateDatabase(db, [coreMigration, reviewCoreMigration]);
        db.exec(`
          INSERT INTO sections
            (id, name, created_at_ms, updated_at_ms)
          VALUES ('section-1', 'Biology', 0, 0);
          INSERT INTO learning_items
            (id, section_id, lifecycle, created_at_ms, updated_at_ms)
          VALUES ('item-1', 'section-1', 'active', 0, 0);
          INSERT INTO presentations
            (
              id, learning_item_id, kind, ordinal, front, back, notes,
              normalized_front, normalized_back
            )
          VALUES
            (
              'presentation-1', 'item-1', 'primary', 0,
              'Question', 'Answer', NULL, 'Question', 'Answer'
            );
        `);

        migrateDatabase(db);

        expect(db.pragma("user_version", { simple: true })).toBe(3);
        expect(
          db
            .prepare(
              "SELECT lifecycle FROM presentations WHERE id = 'presentation-1'",
            )
            .pluck()
            .get(),
        ).toBe("active");
      } finally {
        db.close();
      }
    });
  });
});
