import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withTempDatabase } from "@openrecall/test-support";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrateDatabase } from "../migrate.js";
import { OFFICIAL_PARAMETER_PROFILE_ID } from "../review-types.js";
import { coreMigration } from "./001-core.js";
import { reviewCoreMigration } from "./002-review-core.js";
import { cardManagementMigration } from "./003-card-management.js";
import { statisticsMigration } from "./004-statistics.js";
import { settingsOptimizerMigration } from "./005-settings-optimizer.js";
import { sectionDeletionMigration } from "./006-section-deletion.js";

const versionFiveMigrations = [
  coreMigration,
  reviewCoreMigration,
  cardManagementMigration,
  statisticsMigration,
  settingsOptimizerMigration,
] as const;

interface ForeignKeyRow {
  readonly from: string;
  readonly table: string;
  readonly to: string;
  readonly on_delete: string;
}

function foreignKey(
  db: Database.Database,
  table: string,
  from: string,
): ForeignKeyRow | undefined {
  return (
    db.pragma(`foreign_key_list(${table})`) as ForeignKeyRow[]
  ).find((row) => row.from === from);
}

describe("section deletion migration", () => {
  it("rebuilds every ownership edge and cascades one section without deleting global or unrelated data", async () => {
    await withTempDatabase(async (databasePath) => {
      const firstBackup = join(dirname(databasePath), "section-backup.sqlite3");
      const globalBackup = join(dirname(databasePath), "global-backup.sqlite3");
      await writeFile(firstBackup, "section backup bytes");
      await writeFile(globalBackup, "global backup bytes");
      const db = new Database(databasePath);
      db.pragma("foreign_keys = ON");
      try {
        migrateDatabase(db, versionFiveMigrations);
        db.exec(`
          INSERT INTO sections (id, name, created_at_ms, updated_at_ms)
          VALUES
            ('section-1', 'Delete me', 100, 100),
            ('section-2', 'Keep me', 100, 100);

          INSERT INTO learning_items
            (id, section_id, lifecycle, created_at_ms, updated_at_ms, trashed_at_ms)
          VALUES
            ('item-1', 'section-1', 'active', 100, 100, NULL),
            ('item-trashed', 'section-1', 'trashed', 100, 100, 200),
            ('item-2', 'section-2', 'active', 100, 100, NULL);

          INSERT INTO presentations
            (id, learning_item_id, kind, ordinal, front, back, notes,
             normalized_front, normalized_back, lifecycle)
          VALUES
            ('presentation-1', 'item-1', 'primary', 0, 'Q1', 'A1', NULL, 'q1', 'a1', 'active'),
            ('variant-1', 'item-1', 'variant', 1, 'Q1v', 'A1', 'N', 'q1v', 'a1', 'active'),
            ('presentation-trashed', 'item-trashed', 'primary', 0, 'QT', 'AT', NULL, 'qt', 'at', 'active'),
            ('presentation-2', 'item-2', 'primary', 0, 'Q2', 'A2', NULL, 'q2', 'a2', 'active');

          INSERT INTO presentation_exposures
            (presentation_id, first_shown_at_ms, last_shown_at_ms, show_count)
          VALUES
            ('presentation-1', 100, 100, 1),
            ('variant-1', 100, 100, 1),
            ('presentation-2', 100, 100, 1);

          INSERT INTO parameter_profiles
            (id, scope_type, section_id, algorithm_id, algorithm_version,
             adapter_version, weights_json, eligible_example_count,
             review_cutoff_ms, status, created_at_ms)
          VALUES
            ('profile-section-1', 'section', 'section-1', 'FSRS-6', '6.0', 1, '[]', 1, 100, 'active', 100),
            ('profile-section-2', 'section', 'section-2', 'FSRS-6', '6.0', 1, '[]', 1, 100, 'active', 100),
            ('profile-global', 'global', NULL, 'FSRS-6', '6.0', 1, '[]', 1, 100, 'active', 100);

          INSERT INTO scheduler_states
            (learning_item_id, section_id, due_at_ms, memory_state, step_index,
             stability, difficulty, elapsed_days_at_last_review, scheduled_days,
             last_review_at_ms, repetitions, lapses, revision, algorithm_id,
             algorithm_version, adapter_version, parameter_profile_id)
          VALUES
            ('item-1', 'section-1', 200, 'review', NULL, 1, 5, 1, 1, 100, 1, 0, 1, 'FSRS-6', '6.0', 1, 'profile-section-1'),
            ('item-trashed', 'section-1', 200, 'new', NULL, 0, 0, 0, 0, NULL, 0, 0, 0, 'FSRS-6', '6.0', 1, '${OFFICIAL_PARAMETER_PROFILE_ID}'),
            ('item-2', 'section-2', 200, 'review', NULL, 1, 5, 1, 1, 100, 1, 0, 1, 'FSRS-6', '6.0', 1, 'profile-section-2');

          INSERT INTO review_sessions
            (id, section_id, status, started_at_ms, completed_at_ms, revision)
          VALUES
            ('session-open-1', 'section-1', 'paused', 100, NULL, 1),
            ('session-done-1', 'section-1', 'completed', 100, 200, 1),
            ('session-done-2', 'section-2', 'completed', 100, 200, 1);

          INSERT INTO session_queue_entries
            (id, session_id, learning_item_id, status, enqueued_due_at_ms,
             enqueued_at_ms, activated_at_ms, presentation_id, shown_at_ms,
             revealed_at_ms, completed_at_ms)
          VALUES
            ('queue-open-1', 'session-open-1', 'item-1', 'queued', 100, 100, NULL, NULL, NULL, NULL, NULL),
            ('queue-done-1', 'session-done-1', 'item-1', 'completed', 100, 100, 100, 'presentation-1', 100, 110, 120),
            ('queue-done-2', 'session-done-2', 'item-2', 'completed', 100, 100, 100, 'presentation-2', 100, 110, 120);

          INSERT INTO review_logs
            (id, session_id, queue_entry_id, learning_item_id, section_id,
             presentation_id, front_snapshot, back_snapshot, notes_snapshot,
             rating, shown_at_ms, revealed_at_ms, rated_at_ms,
             review_duration_ms, study_day_delta, prior_state_json,
             result_state_json, algorithm_id, algorithm_version,
             adapter_version, parameter_profile_id, time_zone,
             boundary_minutes, settings_json, retrievability_before,
             resulting_due_at_ms)
          VALUES
            ('log-1', 'session-done-1', 'queue-done-1', 'item-1', 'section-1', 'presentation-1', 'Q1', 'A1', NULL, 3, 100, 110, 120, 20, 0, '{}', '{}', 'FSRS-6', '6.0', 1, 'profile-section-1', 'UTC', 0, '{}', 0.9, 200),
            ('log-2', 'session-done-2', 'queue-done-2', 'item-2', 'section-2', 'presentation-2', 'Q2', 'A2', NULL, 3, 100, 110, 120, 20, 0, '{}', '{}', 'FSRS-6', '6.0', 1, 'profile-section-2', 'UTC', 0, '{}', 0.9, 200);

          INSERT INTO rating_requests
            (idempotency_key, session_id, learning_item_id, expected_revision,
             response_json, created_at_ms)
          VALUES
            ('rating-1', 'session-done-1', 'item-1', 1, '{}', 120),
            ('rating-2', 'session-done-2', 'item-2', 1, '{}', 120);

          INSERT INTO scheduler_setting_scopes
            (id, scope_type, section_id, adapter_version, settings_json, updated_at_ms)
          VALUES
            ('settings-section-1', 'section', 'section-1', 1, '{}', 100),
            ('settings-section-2', 'section', 'section-2', 1, '{}', 100);

          INSERT INTO optimizer_runs
            (id, scope_type, section_id, status, raw_review_count,
             eligible_example_count, source_review_cutoff_ms, package_version,
             algorithm_version, progress, created_at_ms)
          VALUES
            ('run-section-1', 'section', 'section-1', 'succeeded', 1, 1, 100, '0.5.0', '6.0', 1, 100),
            ('run-global', 'global', NULL, 'succeeded', 2, 2, 100, '0.5.0', '6.0', 1, 100);

          INSERT INTO profile_applications
            (id, profile_id, previous_profile_id, scope_type, section_id,
             source_review_cutoff_ms, backup_filename, applied_at_ms)
          VALUES
            ('application-section-1', 'profile-section-1', '${OFFICIAL_PARAMETER_PROFILE_ID}', 'section', 'section-1', 100, 'section-backup.sqlite3', 100),
            ('application-section-2', 'profile-section-2', '${OFFICIAL_PARAMETER_PROFILE_ID}', 'section', 'section-2', 100, 'section-2-backup.sqlite3', 100),
            ('application-global', 'profile-global', '${OFFICIAL_PARAMETER_PROFILE_ID}', 'global', NULL, 100, 'global-backup.sqlite3', 100);
        `);

        migrateDatabase(db, [
          ...versionFiveMigrations,
          sectionDeletionMigration,
        ]);

        for (const [table, from] of [
          ["review_sessions", "section_id"],
          ["review_logs", "section_id"],
          ["rating_requests", "session_id"],
          ["rating_requests", "learning_item_id"],
          ["profile_applications", "section_id"],
        ] as const) {
          expect(foreignKey(db, table, from)).toMatchObject({
            table:
              from === "session_id"
                ? "review_sessions"
                : from === "learning_item_id"
                  ? "learning_items"
                  : "sections",
            to: "id",
            on_delete: "CASCADE",
          });
        }

        db.prepare("DELETE FROM sections WHERE id = ?").run("section-1");

        for (const table of [
          "learning_items",
          "presentations",
          "presentation_exposures",
          "scheduler_states",
          "review_sessions",
          "session_queue_entries",
          "review_logs",
          "rating_requests",
        ]) {
          expect(
            db.prepare(`SELECT count(*) FROM ${table}`).pluck().get(),
          ).toBe(1);
        }
        expect(db.prepare("SELECT count(*) FROM sections WHERE id = 'section-1'").pluck().get()).toBe(0);
        expect(db.prepare("SELECT count(*) FROM learning_items WHERE section_id = 'section-1'").pluck().get()).toBe(0);
        expect(db.prepare("SELECT count(*) FROM scheduler_states WHERE section_id = 'section-1'").pluck().get()).toBe(0);
        expect(db.prepare("SELECT count(*) FROM review_sessions WHERE section_id = 'section-1'").pluck().get()).toBe(0);
        expect(db.prepare("SELECT count(*) FROM review_logs WHERE section_id = 'section-1'").pluck().get()).toBe(0);
        expect(db.prepare("SELECT count(*) FROM parameter_profiles WHERE section_id = 'section-1'").pluck().get()).toBe(0);
        expect(db.prepare("SELECT count(*) FROM scheduler_setting_scopes WHERE section_id = 'section-1'").pluck().get()).toBe(0);
        expect(db.prepare("SELECT count(*) FROM optimizer_runs WHERE section_id = 'section-1'").pluck().get()).toBe(0);
        expect(db.prepare("SELECT count(*) FROM profile_applications WHERE section_id = 'section-1'").pluck().get()).toBe(0);

        expect(db.prepare("SELECT name FROM sections WHERE id = 'section-2'").pluck().get()).toBe("Keep me");
        expect(db.prepare("SELECT count(*) FROM review_logs WHERE section_id = 'section-2'").pluck().get()).toBe(1);
        expect(db.prepare("SELECT count(*) FROM optimizer_runs WHERE scope_type = 'global'").pluck().get()).toBe(1);
        expect(db.prepare("SELECT count(*) FROM profile_applications WHERE scope_type = 'global'").pluck().get()).toBe(1);
        expect(db.prepare("SELECT count(*) FROM parameter_profiles WHERE id = ?").pluck().get(OFFICIAL_PARAMETER_PROFILE_ID)).toBe(1);
        expect(await readFile(firstBackup, "utf8")).toBe("section backup bytes");
        expect(await readFile(globalBackup, "utf8")).toBe("global backup bytes");
        expect(db.pragma("quick_check", { simple: true })).toBe("ok");
        expect(db.pragma("foreign_key_check")).toEqual([]);

        expect(() =>
          db
            .prepare("DELETE FROM profile_applications WHERE id = ?")
            .run("application-global"),
        ).toThrow("PROFILE_APPLICATION_AUDIT_IMMUTABLE");
        expect(() =>
          db
            .prepare("DELETE FROM profile_applications WHERE id = ?")
            .run("application-section-2"),
        ).toThrow("PROFILE_APPLICATION_AUDIT_IMMUTABLE");
      } finally {
        db.close();
      }
    });
  });
});
