import {
  DEFAULT_SCHEDULER_SETTINGS,
  FSRS6_MANIFEST,
} from "@openrecall/scheduler";
import type Database from "better-sqlite3";
import type { Migration } from "../migrate.js";

export const GLOBAL_SCHEDULER_SETTINGS_ID = "scheduler-settings-global";

export const settingsOptimizerMigration: Migration = {
  version: 5,
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE scheduler_setting_scopes (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL CHECK(scope_type IN ('global','section')),
        section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
        adapter_version INTEGER NOT NULL CHECK(adapter_version >= 1),
        settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),
        updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= 0),
        CHECK(
          (scope_type = 'global' AND section_id IS NULL) OR
          (scope_type = 'section' AND section_id IS NOT NULL)
        )
      ) STRICT;

      CREATE UNIQUE INDEX ux_scheduler_settings_global
        ON scheduler_setting_scopes(scope_type)
        WHERE scope_type = 'global';
      CREATE UNIQUE INDEX ux_scheduler_settings_section
        ON scheduler_setting_scopes(section_id)
        WHERE scope_type = 'section';

      CREATE TABLE optimizer_runs (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL CHECK(scope_type IN ('global','section')),
        section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
        status TEXT NOT NULL
          CHECK(status IN ('queued','running','cancelled','failed','succeeded')),
        raw_review_count INTEGER NOT NULL CHECK(raw_review_count >= 0),
        eligible_example_count INTEGER NOT NULL
          CHECK(
            eligible_example_count >= 0
            AND eligible_example_count <= raw_review_count
          ),
        source_review_cutoff_ms INTEGER
          CHECK(
            source_review_cutoff_ms IS NULL
            OR source_review_cutoff_ms >= 0
          ),
        package_version TEXT NOT NULL CHECK(length(trim(package_version)) > 0),
        algorithm_version TEXT NOT NULL
          CHECK(length(trim(algorithm_version)) > 0),
        progress REAL NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 1),
        result_profile_id TEXT REFERENCES parameter_profiles(id),
        metric_log_loss REAL
          CHECK(metric_log_loss IS NULL OR metric_log_loss >= 0),
        metric_rmse_bins REAL
          CHECK(metric_rmse_bins IS NULL OR metric_rmse_bins >= 0),
        error_code TEXT,
        created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
        started_at_ms INTEGER CHECK(started_at_ms IS NULL OR started_at_ms >= 0),
        finished_at_ms INTEGER
          CHECK(finished_at_ms IS NULL OR finished_at_ms >= 0),
        CHECK(
          (scope_type = 'global' AND section_id IS NULL) OR
          (scope_type = 'section' AND section_id IS NOT NULL)
        ),
        CHECK(started_at_ms IS NULL OR started_at_ms >= created_at_ms),
        CHECK(
          finished_at_ms IS NULL
          OR (
            started_at_ms IS NOT NULL
            AND finished_at_ms >= started_at_ms
          )
        )
      ) STRICT;

      CREATE INDEX idx_optimizer_runs_scope_created
        ON optimizer_runs(scope_type, section_id, created_at_ms DESC, id);
      CREATE INDEX idx_optimizer_runs_status
        ON optimizer_runs(status, created_at_ms, id);

      CREATE TABLE profile_applications (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES parameter_profiles(id),
        previous_profile_id TEXT NOT NULL REFERENCES parameter_profiles(id),
        scope_type TEXT NOT NULL CHECK(scope_type IN ('global','section')),
        section_id TEXT REFERENCES sections(id),
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
      BEGIN
        SELECT RAISE(ABORT, 'PROFILE_APPLICATION_AUDIT_IMMUTABLE');
      END;
    `);

    db.prepare(
      `
        INSERT INTO scheduler_setting_scopes
          (
            id,
            scope_type,
            section_id,
            adapter_version,
            settings_json,
            updated_at_ms
          )
        VALUES (?, 'global', NULL, ?, ?, 0)
      `,
    ).run(
      GLOBAL_SCHEDULER_SETTINGS_ID,
      FSRS6_MANIFEST.adapterSchemaVersion,
      JSON.stringify(DEFAULT_SCHEDULER_SETTINGS),
    );
  },
};
