import type Database from "better-sqlite3";
import type { Migration } from "../migrate.js";

export const coreMigration: Migration = {
  version: 1,
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE sections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE learning_items (
        id TEXT PRIMARY KEY,
        section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        lifecycle TEXT NOT NULL DEFAULT 'active'
          CHECK(lifecycle IN ('active', 'trashed')),
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        trashed_at_ms INTEGER
      ) STRICT;

      CREATE TABLE presentations (
        id TEXT PRIMARY KEY,
        learning_item_id TEXT NOT NULL
          REFERENCES learning_items(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('primary', 'variant')),
        ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
        front TEXT NOT NULL CHECK(length(trim(front)) > 0),
        back TEXT NOT NULL CHECK(length(trim(back)) > 0),
        notes TEXT,
        normalized_front TEXT NOT NULL,
        normalized_back TEXT NOT NULL,
        UNIQUE(learning_item_id, ordinal)
      ) STRICT;

      CREATE TABLE presentation_exposures (
        presentation_id TEXT PRIMARY KEY
          REFERENCES presentations(id) ON DELETE CASCADE,
        first_shown_at_ms INTEGER,
        last_shown_at_ms INTEGER,
        show_count INTEGER NOT NULL DEFAULT 0 CHECK(show_count >= 0),
        last_session_id TEXT,
        last_learning_item_id TEXT
      ) STRICT;

      CREATE TABLE application_settings (
        key TEXT PRIMARY KEY,
        json_value TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX idx_learning_items_section_active
        ON learning_items(section_id, lifecycle, created_at_ms);

      CREATE INDEX idx_presentations_learning_item_order
        ON presentations(learning_item_id, ordinal);
    `);
  },
};
