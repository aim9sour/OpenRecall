import { withTempDatabase } from "@openrecall/test-support";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../constants.js";
import { migrateDatabase } from "../migrate.js";
import { coreMigration } from "./001-core.js";

function insertVersionOneFixture(db: Database.Database): void {
  db.exec(`
    INSERT INTO sections
      (id, name, created_at_ms, updated_at_ms)
    VALUES
      ('section-1', 'Biology', 1000, 1000),
      ('section-2', 'Chemistry', 1000, 1000);

    INSERT INTO learning_items
      (id, section_id, lifecycle, created_at_ms, updated_at_ms)
    VALUES
      ('item-1', 'section-1', 'active', 2000, 2000);

    INSERT INTO presentations
      (
        id,
        learning_item_id,
        kind,
        ordinal,
        front,
        back,
        notes,
        normalized_front,
        normalized_back
      )
    VALUES
      (
        'presentation-1',
        'item-1',
        'primary',
        0,
        'Question',
        'Answer',
        NULL,
        'question',
        'answer'
      );

    INSERT INTO presentation_exposures
      (presentation_id, show_count)
    VALUES
      ('presentation-1', 0);
  `);
}

describe("review core migration", () => {
  it("upgrades a v1 card into a versioned official scheduler state", async () => {
    await withTempDatabase((databasePath) => {
      const db = new Database(databasePath);
      db.pragma("foreign_keys = ON");

      try {
        migrateDatabase(db, [coreMigration]);
        insertVersionOneFixture(db);
        expect(db.pragma("user_version", { simple: true })).toBe(1);

        migrateDatabase(db);

        expect(db.pragma("user_version", { simple: true })).toBe(
          SCHEMA_VERSION,
        );
        const tables = db
          .prepare(
            `
              SELECT name
              FROM sqlite_schema
              WHERE type = 'table'
              ORDER BY name
            `,
          )
          .pluck()
          .all();
        expect(tables).toEqual(
          expect.arrayContaining([
            "parameter_profiles",
            "scheduler_states",
            "review_logs",
            "review_sessions",
            "session_queue_entries",
            "rating_requests",
          ]),
        );
        const reviewLogColumns = db
          .prepare("PRAGMA table_xinfo(review_logs)")
          .all() as Array<{ name: string }>;
        expect(reviewLogColumns.map((column) => column.name)).toEqual(
          expect.arrayContaining([
            "prior_state_json",
            "result_state_json",
            "presentation_id",
            "front_snapshot",
            "back_snapshot",
            "notes_snapshot",
            "rating",
            "shown_at_ms",
            "revealed_at_ms",
            "rated_at_ms",
            "review_duration_ms",
            "study_day_delta",
            "algorithm_id",
            "algorithm_version",
            "adapter_version",
            "parameter_profile_id",
            "time_zone",
            "boundary_minutes",
            "settings_json",
            "retrievability_before",
            "resulting_due_at_ms",
          ]),
        );
        const profile = db
          .prepare(
            `
              SELECT
                id,
                algorithm_id,
                algorithm_version,
                adapter_version,
                weights_json,
                status
              FROM parameter_profiles
              WHERE id = 'official-fsrs6-v1'
            `,
          )
          .get() as {
          id: string;
          algorithm_id: string;
          algorithm_version: string;
          adapter_version: number;
          weights_json: string;
          status: string;
        };
        expect(profile).toMatchObject({
          id: "official-fsrs6-v1",
          algorithm_id: "FSRS-6",
          algorithm_version: "6.0",
          adapter_version: 1,
          status: "active",
        });
        expect(JSON.parse(profile.weights_json)).toHaveLength(21);
        expect(
          db
            .prepare(
              `
                SELECT
                  section_id,
                  due_at_ms,
                  memory_state,
                  step_index,
                  stability,
                  difficulty,
                  repetitions,
                  lapses,
                  revision,
                  parameter_profile_id
                FROM scheduler_states
                WHERE learning_item_id = 'item-1'
              `,
            )
            .get(),
        ).toEqual({
          section_id: "section-1",
          due_at_ms: 2000,
          memory_state: "new",
          step_index: null,
          stability: 0,
          difficulty: 0,
          repetitions: 0,
          lapses: 0,
          revision: 0,
          parameter_profile_id: "official-fsrs6-v1",
        });

        const queryPlan = db
          .prepare(
            `
              EXPLAIN QUERY PLAN
              SELECT learning_item_id
              FROM scheduler_states
              WHERE section_id = ?
                AND due_at_ms <= ?
              ORDER BY due_at_ms, learning_item_id
            `,
          )
          .all("section-1", 2000) as Array<{ detail: string }>;
        expect(queryPlan.some((row) =>
          row.detail.includes("idx_scheduler_section_due"),
        )).toBe(true);
      } finally {
        db.close();
      }
    });
  });

  it("enforces pending-appearance and global-open-session uniqueness", async () => {
    await withTempDatabase((databasePath) => {
      const db = new Database(databasePath);
      db.pragma("foreign_keys = ON");

      try {
        migrateDatabase(db, [coreMigration]);
        insertVersionOneFixture(db);
        migrateDatabase(db);

        db.prepare(
          `
            INSERT INTO review_sessions
              (id, section_id, status, started_at_ms)
            VALUES
              ('session-1', 'section-1', 'active', 3000)
          `,
        ).run();
        const insertEntry = db.prepare(`
          INSERT INTO session_queue_entries
            (
              id,
              session_id,
              learning_item_id,
              status,
              enqueued_due_at_ms,
              enqueued_at_ms
            )
          VALUES
            (?, 'session-1', 'item-1', ?, 2000, 3000)
        `);
        insertEntry.run("entry-1", "queued");
        expect(() => insertEntry.run("entry-2", "active")).toThrow();

        db.prepare(
          `
            UPDATE session_queue_entries
            SET status = 'completed', completed_at_ms = 4000
            WHERE id = 'entry-1'
          `,
        ).run();
        expect(() => insertEntry.run("entry-3", "queued")).not.toThrow();

        expect(() =>
          db
            .prepare(
              `
                INSERT INTO review_sessions
                  (id, section_id, status, started_at_ms)
                VALUES
                  ('session-2', 'section-2', 'paused', 5000)
              `,
            )
            .run(),
        ).toThrow();
      } finally {
        db.close();
      }
    });
  });
});
