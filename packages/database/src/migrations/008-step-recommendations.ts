import type Database from "better-sqlite3";
import type { Migration } from "../migrate.js";

export const stepRecommendationsMigration: Migration = {
  version: 8,
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE step_recommendation_runs (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL CHECK(scope_type IN ('global','section')),
        section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('queued','running','cancelled','failed','succeeded')),
        source_review_cutoff_ms INTEGER CHECK(source_review_cutoff_ms IS NULL OR source_review_cutoff_ms >= 0),
        source_fingerprint TEXT NOT NULL CHECK(length(source_fingerprint) = 64 AND source_fingerprint NOT GLOB '*[^0-9a-f]*'),
        revision_token TEXT NOT NULL CHECK(length(revision_token) = 64 AND revision_token NOT GLOB '*[^0-9a-f]*'),
        input_snapshot_json TEXT NOT NULL CHECK(json_valid(input_snapshot_json)),
        result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
        error_code TEXT CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 100),
        applied_parts_json TEXT CHECK(applied_parts_json IS NULL OR json_valid(applied_parts_json)),
        prior_steps_json TEXT CHECK(prior_steps_json IS NULL OR json_valid(prior_steps_json)),
        applied_steps_json TEXT CHECK(applied_steps_json IS NULL OR json_valid(applied_steps_json)),
        applied_at_ms INTEGER CHECK(applied_at_ms IS NULL OR applied_at_ms >= 0),
        restored_at_ms INTEGER CHECK(restored_at_ms IS NULL OR restored_at_ms >= applied_at_ms),
        created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
        started_at_ms INTEGER CHECK(started_at_ms IS NULL OR started_at_ms >= created_at_ms),
        finished_at_ms INTEGER CHECK(finished_at_ms IS NULL OR (started_at_ms IS NOT NULL AND finished_at_ms >= started_at_ms)),
        CHECK((scope_type = 'global' AND section_id IS NULL) OR (scope_type = 'section' AND section_id IS NOT NULL)),
        CHECK((status = 'succeeded' AND result_json IS NOT NULL) OR (status <> 'succeeded' AND result_json IS NULL)),
        CHECK(
          (applied_parts_json IS NULL AND prior_steps_json IS NULL AND applied_steps_json IS NULL AND applied_at_ms IS NULL AND restored_at_ms IS NULL) OR
          (applied_parts_json IS NOT NULL AND prior_steps_json IS NOT NULL AND applied_steps_json IS NOT NULL AND applied_at_ms IS NOT NULL)
        )
      ) STRICT;
      CREATE INDEX idx_step_recommendation_scope_created
        ON step_recommendation_runs(scope_type, section_id, created_at_ms DESC, id);
      CREATE INDEX idx_step_recommendation_status
        ON step_recommendation_runs(status, created_at_ms, id);
    `);
  },
};
