import type Database from "better-sqlite3";
import type { Migration } from "../migrate.js";

export const cardManagementMigration: Migration = {
  version: 3,
  up(db: Database.Database): void {
    db.exec(`
      ALTER TABLE presentations
      ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'active'
        CHECK(lifecycle IN ('active', 'retired'));

      CREATE INDEX idx_presentations_item_lifecycle_order
        ON presentations(learning_item_id, lifecycle, ordinal, id);
    `);
  },
};
