import type Database from "better-sqlite3";
import type { Migration } from "../migrate.js";

export const statisticsMigration: Migration = {
  version: 4,
  up(db: Database.Database): void {
    db.exec(`
      ALTER TABLE review_logs RENAME TO review_logs_v3;

      CREATE TABLE review_logs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES review_sessions(id),
        queue_entry_id TEXT NOT NULL REFERENCES session_queue_entries(id),
        learning_item_id TEXT NOT NULL REFERENCES learning_items(id),
        section_id TEXT NOT NULL REFERENCES sections(id),
        presentation_id TEXT NOT NULL REFERENCES presentations(id),
        front_snapshot TEXT NOT NULL,
        back_snapshot TEXT NOT NULL,
        notes_snapshot TEXT,
        rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 4),
        shown_at_ms INTEGER NOT NULL,
        revealed_at_ms INTEGER NOT NULL,
        rated_at_ms INTEGER NOT NULL,
        review_duration_ms INTEGER
          CHECK(review_duration_ms IS NULL OR review_duration_ms >= 0),
        study_day_delta INTEGER NOT NULL CHECK(study_day_delta >= 0),
        prior_state_json TEXT NOT NULL,
        result_state_json TEXT NOT NULL,
        algorithm_id TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        adapter_version INTEGER NOT NULL,
        parameter_profile_id TEXT NOT NULL
          REFERENCES parameter_profiles(id),
        time_zone TEXT NOT NULL CHECK(length(trim(time_zone)) > 0),
        boundary_minutes INTEGER NOT NULL
          CHECK(boundary_minutes BETWEEN 0 AND 1439),
        settings_json TEXT NOT NULL,
        retrievability_before REAL
          CHECK(
            retrievability_before IS NULL
            OR retrievability_before BETWEEN 0 AND 1
          ),
        resulting_due_at_ms INTEGER NOT NULL,
        CHECK(revealed_at_ms >= shown_at_ms),
        CHECK(rated_at_ms >= revealed_at_ms)
      ) STRICT;

      INSERT INTO review_logs
      SELECT * FROM review_logs_v3;

      DROP TABLE review_logs_v3;

      CREATE INDEX idx_review_logs_item_time
        ON review_logs(learning_item_id, rated_at_ms, id);
      CREATE INDEX idx_review_logs_time
        ON review_logs(rated_at_ms, id);
      CREATE INDEX idx_review_logs_section_time
        ON review_logs(section_id, rated_at_ms, id);
    `);
  },
};
