import { FSRS6_MANIFEST } from "@openrecall/scheduler";
import type Database from "better-sqlite3";
import type { Migration } from "../migrate.js";
import {
  OFFICIAL_PARAMETER_PROFILE_ID,
  SCHEDULER_ADAPTER_VERSION,
  SCHEDULER_ALGORITHM_ID,
  SCHEDULER_ALGORITHM_VERSION,
} from "../review-types.js";

export const reviewCoreMigration: Migration = {
  version: 2,
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE parameter_profiles (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL
          CHECK(scope_type IN ('official', 'global', 'section')),
        section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
        algorithm_id TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        adapter_version INTEGER NOT NULL,
        weights_json TEXT NOT NULL,
        eligible_example_count INTEGER NOT NULL DEFAULT 0,
        review_cutoff_ms INTEGER,
        status TEXT NOT NULL
          CHECK(status IN ('candidate', 'active', 'superseded')),
        created_at_ms INTEGER NOT NULL,
        CHECK(
          (scope_type = 'section' AND section_id IS NOT NULL)
          OR (scope_type <> 'section' AND section_id IS NULL)
        )
      ) STRICT;

      CREATE TABLE scheduler_states (
        learning_item_id TEXT PRIMARY KEY
          REFERENCES learning_items(id) ON DELETE CASCADE,
        section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        due_at_ms INTEGER NOT NULL,
        memory_state TEXT NOT NULL
          CHECK(memory_state IN ('new','learning','review','relearning')),
        step_index INTEGER,
        stability REAL NOT NULL,
        difficulty REAL NOT NULL,
        elapsed_days_at_last_review REAL NOT NULL,
        scheduled_days REAL NOT NULL,
        last_review_at_ms INTEGER,
        repetitions INTEGER NOT NULL CHECK(repetitions >= 0),
        lapses INTEGER NOT NULL CHECK(lapses >= 0),
        revision INTEGER NOT NULL CHECK(revision >= 0),
        algorithm_id TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        adapter_version INTEGER NOT NULL,
        parameter_profile_id TEXT NOT NULL
          REFERENCES parameter_profiles(id),
        CHECK(step_index IS NULL OR step_index >= 0)
      ) STRICT;

      CREATE TABLE review_sessions (
        id TEXT PRIMARY KEY,
        singleton INTEGER NOT NULL DEFAULT 1 CHECK(singleton = 1),
        section_id TEXT NOT NULL REFERENCES sections(id),
        status TEXT NOT NULL
          CHECK(status IN ('active','waiting','paused','completed')),
        started_at_ms INTEGER NOT NULL,
        resumed_at_ms INTEGER,
        paused_at_ms INTEGER,
        completed_at_ms INTEGER,
        revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0)
      ) STRICT;

      CREATE UNIQUE INDEX ux_one_open_review_session
        ON review_sessions(singleton)
        WHERE status IN ('active','waiting','paused');

      CREATE TABLE session_queue_entries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL
          REFERENCES review_sessions(id) ON DELETE CASCADE,
        learning_item_id TEXT NOT NULL REFERENCES learning_items(id),
        status TEXT NOT NULL
          CHECK(status IN ('queued','active','completed','removed')),
        enqueued_due_at_ms INTEGER NOT NULL,
        enqueued_at_ms INTEGER NOT NULL,
        activated_at_ms INTEGER,
        presentation_id TEXT REFERENCES presentations(id),
        shown_at_ms INTEGER,
        revealed_at_ms INTEGER,
        completed_at_ms INTEGER
      ) STRICT;

      CREATE UNIQUE INDEX ux_session_pending_item
        ON session_queue_entries(session_id, learning_item_id)
        WHERE status IN ('queued','active');

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
        review_duration_ms INTEGER NOT NULL CHECK(review_duration_ms >= 0),
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

      CREATE TABLE rating_requests (
        idempotency_key TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES review_sessions(id),
        learning_item_id TEXT NOT NULL REFERENCES learning_items(id),
        expected_revision INTEGER NOT NULL CHECK(expected_revision >= 0),
        response_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX idx_scheduler_due
        ON scheduler_states(due_at_ms, learning_item_id);
      CREATE INDEX idx_scheduler_section_due
        ON scheduler_states(section_id, due_at_ms, learning_item_id);
      CREATE INDEX idx_queue_session_status
        ON session_queue_entries(
          session_id,
          status,
          enqueued_due_at_ms,
          id
        );
      CREATE INDEX idx_review_logs_item_time
        ON review_logs(learning_item_id, rated_at_ms, id);
    `);

    db.prepare(
      `
        INSERT INTO parameter_profiles
          (
            id,
            scope_type,
            section_id,
            algorithm_id,
            algorithm_version,
            adapter_version,
            weights_json,
            eligible_example_count,
            review_cutoff_ms,
            status,
            created_at_ms
          )
        VALUES
          (
            @id,
            'official',
            NULL,
            @algorithmId,
            @algorithmVersion,
            @adapterVersion,
            @weightsJson,
            0,
            NULL,
            'active',
            0
          )
      `,
    ).run({
      id: OFFICIAL_PARAMETER_PROFILE_ID,
      algorithmId: SCHEDULER_ALGORITHM_ID,
      algorithmVersion: SCHEDULER_ALGORITHM_VERSION,
      adapterVersion: SCHEDULER_ADAPTER_VERSION,
      weightsJson: JSON.stringify(FSRS6_MANIFEST.defaultWeights),
    });

    db.prepare(
      `
        INSERT INTO scheduler_states
          (
            learning_item_id,
            section_id,
            due_at_ms,
            memory_state,
            step_index,
            stability,
            difficulty,
            elapsed_days_at_last_review,
            scheduled_days,
            last_review_at_ms,
            repetitions,
            lapses,
            revision,
            algorithm_id,
            algorithm_version,
            adapter_version,
            parameter_profile_id
          )
        SELECT
          id,
          section_id,
          created_at_ms,
          'new',
          NULL,
          0,
          0,
          0,
          0,
          NULL,
          0,
          0,
          0,
          @algorithmId,
          @algorithmVersion,
          @adapterVersion,
          @parameterProfileId
        FROM learning_items
      `,
    ).run({
      algorithmId: SCHEDULER_ALGORITHM_ID,
      algorithmVersion: SCHEDULER_ALGORITHM_VERSION,
      adapterVersion: SCHEDULER_ADAPTER_VERSION,
      parameterProfileId: OFFICIAL_PARAMETER_PROFILE_ID,
    });
  },
};
