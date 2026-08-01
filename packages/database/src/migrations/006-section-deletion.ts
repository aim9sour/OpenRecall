import type Database from "better-sqlite3";
import type { Migration } from "../migrate.js";

export const sectionDeletionMigration: Migration = {
  version: 6,
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE new_review_sessions (
        id TEXT PRIMARY KEY,
        singleton INTEGER NOT NULL DEFAULT 1 CHECK(singleton = 1),
        section_id TEXT NOT NULL
          REFERENCES sections(id) ON DELETE CASCADE,
        status TEXT NOT NULL
          CHECK(status IN ('active','waiting','paused','completed')),
        started_at_ms INTEGER NOT NULL,
        resumed_at_ms INTEGER,
        paused_at_ms INTEGER,
        completed_at_ms INTEGER,
        revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)
      ) STRICT;

      INSERT INTO new_review_sessions
        (
          id, singleton, section_id, status, started_at_ms,
          resumed_at_ms, paused_at_ms, completed_at_ms, revision
        )
      SELECT
        id, singleton, section_id, status, started_at_ms,
        resumed_at_ms, paused_at_ms, completed_at_ms, revision
      FROM review_sessions;

      DROP TABLE review_sessions;
      ALTER TABLE new_review_sessions RENAME TO review_sessions;

      CREATE UNIQUE INDEX ux_one_open_review_session
        ON review_sessions(singleton)
        WHERE status IN ('active','waiting','paused');

      CREATE TABLE new_review_logs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES review_sessions(id),
        queue_entry_id TEXT NOT NULL REFERENCES session_queue_entries(id),
        learning_item_id TEXT NOT NULL REFERENCES learning_items(id),
        section_id TEXT NOT NULL
          REFERENCES sections(id) ON DELETE CASCADE,
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

      INSERT INTO new_review_logs
        (
          id, session_id, queue_entry_id, learning_item_id, section_id,
          presentation_id, front_snapshot, back_snapshot, notes_snapshot,
          rating, shown_at_ms, revealed_at_ms, rated_at_ms,
          review_duration_ms, study_day_delta, prior_state_json,
          result_state_json, algorithm_id, algorithm_version,
          adapter_version, parameter_profile_id, time_zone,
          boundary_minutes, settings_json, retrievability_before,
          resulting_due_at_ms
        )
      SELECT
        id, session_id, queue_entry_id, learning_item_id, section_id,
        presentation_id, front_snapshot, back_snapshot, notes_snapshot,
        rating, shown_at_ms, revealed_at_ms, rated_at_ms,
        review_duration_ms, study_day_delta, prior_state_json,
        result_state_json, algorithm_id, algorithm_version,
        adapter_version, parameter_profile_id, time_zone,
        boundary_minutes, settings_json, retrievability_before,
        resulting_due_at_ms
      FROM review_logs;

      DROP TABLE review_logs;
      ALTER TABLE new_review_logs RENAME TO review_logs;

      CREATE INDEX idx_review_logs_item_time
        ON review_logs(learning_item_id, rated_at_ms, id);
      CREATE INDEX idx_review_logs_time
        ON review_logs(rated_at_ms, id);
      CREATE INDEX idx_review_logs_section_time
        ON review_logs(section_id, rated_at_ms, id);

      CREATE TABLE new_rating_requests (
        idempotency_key TEXT PRIMARY KEY,
        session_id TEXT NOT NULL
          REFERENCES review_sessions(id) ON DELETE CASCADE,
        learning_item_id TEXT NOT NULL
          REFERENCES learning_items(id) ON DELETE CASCADE,
        expected_revision INTEGER NOT NULL CHECK(expected_revision >= 0),
        response_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      ) STRICT;

      INSERT INTO new_rating_requests
        (
          idempotency_key, session_id, learning_item_id,
          expected_revision, response_json, created_at_ms
        )
      SELECT
        idempotency_key, session_id, learning_item_id,
        expected_revision, response_json, created_at_ms
      FROM rating_requests;

      DROP TABLE rating_requests;
      ALTER TABLE new_rating_requests RENAME TO rating_requests;

      CREATE TABLE new_profile_applications (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES parameter_profiles(id),
        previous_profile_id TEXT NOT NULL REFERENCES parameter_profiles(id),
        scope_type TEXT NOT NULL CHECK(scope_type IN ('global','section')),
        section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
        source_review_cutoff_ms INTEGER
          CHECK(
            source_review_cutoff_ms IS NULL
            OR source_review_cutoff_ms >= 0
          ),
        backup_filename TEXT NOT NULL
          CHECK(length(trim(backup_filename)) > 0),
        applied_at_ms INTEGER NOT NULL CHECK(applied_at_ms >= 0),
        CHECK(
          (scope_type = 'global' AND section_id IS NULL) OR
          (scope_type = 'section' AND section_id IS NOT NULL)
        )
      ) STRICT;

      INSERT INTO new_profile_applications
        (
          id, profile_id, previous_profile_id, scope_type, section_id,
          source_review_cutoff_ms, backup_filename, applied_at_ms
        )
      SELECT
        id, profile_id, previous_profile_id, scope_type, section_id,
        source_review_cutoff_ms, backup_filename, applied_at_ms
      FROM profile_applications;

      DROP TABLE profile_applications;
      ALTER TABLE new_profile_applications RENAME TO profile_applications;

      CREATE INDEX idx_profile_applications_scope_time
        ON profile_applications(
          scope_type,
          section_id,
          applied_at_ms DESC,
          id
        );

      CREATE TRIGGER profile_applications_immutable_update
      BEFORE UPDATE ON profile_applications
      BEGIN
        SELECT RAISE(ABORT, 'PROFILE_APPLICATION_AUDIT_IMMUTABLE');
      END;

      CREATE TRIGGER profile_applications_immutable_delete
      BEFORE DELETE ON profile_applications
      WHEN
        OLD.section_id IS NULL
        OR EXISTS (
          SELECT 1 FROM sections WHERE id = OLD.section_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'PROFILE_APPLICATION_AUDIT_IMMUTABLE');
      END;
    `);
  },
};
