import {
  DEFAULT_OPTIMIZER_TRAINING_SETTINGS,
  OPTIMIZER_TRAINING_MANIFEST,
} from "@openrecall/optimizer";
import type Database from "better-sqlite3";
import type { Migration } from "../migrate.js";

export const GLOBAL_OPTIMIZER_SETTINGS_ID = "optimizer-settings-global";

export const optimizerTrainingSettingsMigration: Migration = {
  version: 7,
  up(db: Database.Database): void {
    db.exec(`
      CREATE TABLE optimizer_setting_scopes (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL CHECK(scope_type IN ('global','section')),
        section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
        adapter_version INTEGER NOT NULL CHECK(adapter_version >= 1),
        settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),
        created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
        updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= created_at_ms),
        CHECK(
          (scope_type = 'global' AND section_id IS NULL) OR
          (scope_type = 'section' AND section_id IS NOT NULL)
        )
      ) STRICT;

      CREATE UNIQUE INDEX ux_optimizer_settings_global
        ON optimizer_setting_scopes(scope_type) WHERE scope_type = 'global';
      CREATE UNIQUE INDEX ux_optimizer_settings_section
        ON optimizer_setting_scopes(section_id) WHERE scope_type = 'section';

      ALTER TABLE optimizer_runs ADD COLUMN input_snapshot_json TEXT
        CHECK(input_snapshot_json IS NULL OR json_valid(input_snapshot_json));
      ALTER TABLE optimizer_runs ADD COLUMN max_sequence_excluded_count INTEGER
        NOT NULL DEFAULT 0 CHECK(max_sequence_excluded_count >= 0);
      ALTER TABLE optimizer_runs ADD COLUMN source_review_fingerprint TEXT
        CHECK(
          source_review_fingerprint IS NULL OR
          (length(source_review_fingerprint) = 64 AND
           source_review_fingerprint NOT GLOB '*[^0-9a-f]*')
        );
    `);

    db.prepare(`
      INSERT INTO optimizer_setting_scopes
        (id, scope_type, section_id, adapter_version, settings_json,
         created_at_ms, updated_at_ms)
      VALUES (?, 'global', NULL, ?, ?, 0, 0)
    `).run(
      GLOBAL_OPTIMIZER_SETTINGS_ID,
      OPTIMIZER_TRAINING_MANIFEST.adapterVersion,
      JSON.stringify(DEFAULT_OPTIMIZER_TRAINING_SETTINGS),
    );
  },
};
