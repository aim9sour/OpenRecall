import {
  DEFAULT_SCHEDULER_SETTINGS,
  FSRS6_MANIFEST,
} from "@openrecall/scheduler";
import { withTempDatabase } from "@openrecall/test-support";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../constants.js";
import { migrateDatabase } from "../migrate.js";
import { OFFICIAL_PARAMETER_PROFILE_ID } from "../review-types.js";
import { coreMigration } from "./001-core.js";
import { reviewCoreMigration } from "./002-review-core.js";
import { cardManagementMigration } from "./003-card-management.js";
import { statisticsMigration } from "./004-statistics.js";

const priorMigrations = [
  coreMigration,
  reviewCoreMigration,
  cardManagementMigration,
  statisticsMigration,
] as const;

describe("settings and optimizer migration", () => {
  it("upgrades schema v4, seeds adapter defaults, and preserves an active session", async () => {
    await withTempDatabase((databasePath) => {
      const db = new Database(databasePath);
      db.pragma("foreign_keys = ON");
      try {
        migrateDatabase(db, priorMigrations);
        db.exec(`
          INSERT INTO sections
            (id, name, created_at_ms, updated_at_ms)
          VALUES ('section-1', 'Biology', 0, 0);
          INSERT INTO review_sessions
            (id, section_id, status, started_at_ms, revision)
          VALUES ('session-1', 'section-1', 'active', 0, 0);
        `);

        migrateDatabase(db);

        expect(db.pragma("user_version", { simple: true })).toBe(
          SCHEMA_VERSION,
        );
        expect(
          db
            .prepare(
              `
                SELECT
                  scope_type,
                  section_id,
                  adapter_version,
                  settings_json
                FROM scheduler_setting_scopes
              `,
            )
            .get(),
        ).toEqual({
          scope_type: "global",
          section_id: null,
          adapter_version: FSRS6_MANIFEST.adapterSchemaVersion,
          settings_json: JSON.stringify(DEFAULT_SCHEDULER_SETTINGS),
        });
        expect(
          db
            .prepare("SELECT status FROM review_sessions WHERE id = ?")
            .pluck()
            .get("session-1"),
        ).toBe("active");
        expect(db.pragma("quick_check", { simple: true })).toBe("ok");
      } finally {
        db.close();
      }
    });
  });

  it("enforces unique scopes, run state constraints, audit foreign keys, and immutable audit rows", async () => {
    await withTempDatabase((databasePath) => {
      const db = new Database(databasePath);
      db.pragma("foreign_keys = ON");
      try {
        migrateDatabase(db);
        db.exec(`
          INSERT INTO sections
            (id, name, created_at_ms, updated_at_ms)
          VALUES ('section-1', 'Biology', 0, 0);
        `);
        const settings = JSON.stringify(DEFAULT_SCHEDULER_SETTINGS);
        db.prepare(
          `
            INSERT INTO scheduler_setting_scopes
              (
                id, scope_type, section_id, adapter_version,
                settings_json, updated_at_ms
              )
            VALUES (?, 'section', 'section-1', ?, ?, 1)
          `,
        ).run("section-settings-1", FSRS6_MANIFEST.adapterSchemaVersion, settings);

        expect(() =>
          db.prepare(
            `
              INSERT INTO scheduler_setting_scopes
                (
                  id, scope_type, section_id, adapter_version,
                  settings_json, updated_at_ms
                )
              VALUES (?, 'section', 'section-1', ?, ?, 2)
            `,
          ).run("section-settings-2", FSRS6_MANIFEST.adapterSchemaVersion, settings),
        ).toThrow();
        expect(() =>
          db.prepare(
            `
              INSERT INTO scheduler_setting_scopes
                (
                  id, scope_type, section_id, adapter_version,
                  settings_json, updated_at_ms
                )
              VALUES (?, 'global', NULL, ?, ?, 2)
            `,
          ).run("global-settings-2", FSRS6_MANIFEST.adapterSchemaVersion, settings),
        ).toThrow();

        const insertRun = db.prepare(
          `
            INSERT INTO optimizer_runs
              (
                id, scope_type, section_id, status, raw_review_count,
                eligible_example_count, package_version, algorithm_version,
                progress, created_at_ms
              )
            VALUES (
              @id, @scopeType, @sectionId, @status, 0, 0,
              '0.5.0', 'FSRS-6', @progress, 0
            )
          `,
        );
        expect(() =>
          insertRun.run({
            id: "run-scope",
            scopeType: "global",
            sectionId: "section-1",
            status: "running",
            progress: 0,
          }),
        ).toThrow();
        expect(() =>
          insertRun.run({
            id: "run-progress",
            scopeType: "global",
            sectionId: null,
            status: "running",
            progress: 2,
          }),
        ).toThrow();
        expect(() =>
          insertRun.run({
            id: "run-status",
            scopeType: "global",
            sectionId: null,
            status: "unknown",
            progress: 0,
          }),
        ).toThrow();

        db.prepare(
          `
            INSERT INTO profile_applications
              (
                id, profile_id, previous_profile_id, scope_type, section_id,
                source_review_cutoff_ms, backup_filename, applied_at_ms
              )
            VALUES (?, ?, ?, 'global', NULL, NULL, ?, 1)
          `,
        ).run(
          "application-1",
          OFFICIAL_PARAMETER_PROFILE_ID,
          OFFICIAL_PARAMETER_PROFILE_ID,
          "before-application.sqlite3",
        );
        expect(() =>
          db
            .prepare(
              "UPDATE profile_applications SET backup_filename = ? WHERE id = ?",
            )
            .run("changed.sqlite3", "application-1"),
        ).toThrow("PROFILE_APPLICATION_AUDIT_IMMUTABLE");
        expect(() =>
          db
            .prepare("DELETE FROM profile_applications WHERE id = ?")
            .run("application-1"),
        ).toThrow("PROFILE_APPLICATION_AUDIT_IMMUTABLE");
        expect(() =>
          db.prepare(
            `
              INSERT INTO profile_applications
                (
                  id, profile_id, previous_profile_id, scope_type, section_id,
                  backup_filename, applied_at_ms
                )
              VALUES ('application-bad', 'missing', ?, 'global', NULL, ?, 2)
            `,
          ).run(OFFICIAL_PARAMETER_PROFILE_ID, "missing.sqlite3"),
        ).toThrow();
      } finally {
        db.close();
      }
    });
  });
});
