import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./open-database.js";
import { OptimizerDataRepository } from "./optimizer-data-repository.js";

function seed(db: ReturnType<typeof openDatabase>): void {
  db.exec(`
    INSERT INTO sections (id, name, created_at_ms, updated_at_ms)
    VALUES
      ('section-a', 'A', 0, 0),
      ('section-b', 'B', 0, 0);

    INSERT INTO learning_items
      (id, section_id, lifecycle, created_at_ms, updated_at_ms)
    VALUES
      ('item-a', 'section-a', 'active', 0, 0),
      ('item-b', 'section-b', 'active', 0, 0);

    INSERT INTO presentations
      (
        id, learning_item_id, kind, ordinal, front, back,
        normalized_front, normalized_back
      )
    VALUES
      ('presentation-a', 'item-a', 'primary', 0, 'A?', 'A', 'a?', 'a'),
      ('presentation-b', 'item-b', 'primary', 0, 'B?', 'B', 'b?', 'b');

    INSERT INTO review_sessions
      (id, section_id, status, started_at_ms, completed_at_ms)
    VALUES
      ('session-a', 'section-a', 'completed', 0, 1000),
      ('session-b', 'section-b', 'completed', 0, 1000);
  `);
}

function insertReview(
  db: ReturnType<typeof openDatabase>,
  input: {
    readonly id: string;
    readonly itemId: "item-a" | "item-b";
    readonly sectionId: "section-a" | "section-b";
    readonly rating: number;
    readonly deltaDays: number;
    readonly ratedAtMs: number;
    readonly reviewDurationMs?: number | null;
    readonly priorStateJson?: string;
  },
): void {
  const suffix = input.id;
  db.prepare(
    `
      INSERT INTO session_queue_entries
        (
          id, session_id, learning_item_id, status, enqueued_due_at_ms,
          enqueued_at_ms, completed_at_ms, presentation_id
        )
      VALUES (?, ?, ?, 'completed', 0, 0, ?, ?)
    `,
  ).run(
    `entry-${suffix}`,
    `session-${input.sectionId.slice(-1)}`,
    input.itemId,
    input.ratedAtMs,
    `presentation-${input.sectionId.slice(-1)}`,
  );
  db.prepare(
    `
      INSERT INTO review_logs
        (
          id, session_id, queue_entry_id, learning_item_id, section_id,
          presentation_id, front_snapshot, back_snapshot, rating,
          shown_at_ms, revealed_at_ms, rated_at_ms, review_duration_ms,
          study_day_delta, prior_state_json, result_state_json,
          algorithm_id, algorithm_version, adapter_version,
          parameter_profile_id, time_zone, boundary_minutes, settings_json,
          resulting_due_at_ms
        )
      VALUES
        (
          ?, ?, ?, ?, ?, ?, 'Q', 'A', ?,
          ?, ?, ?, ?, ?, ?, '{}',
          'FSRS-6', '6.0', 1, 'official-fsrs6-v1',
          'UTC', 0, '{}', ?
        )
    `,
  ).run(
    input.id,
    `session-${input.sectionId.slice(-1)}`,
    `entry-${suffix}`,
    input.itemId,
    input.sectionId,
    `presentation-${input.sectionId.slice(-1)}`,
    input.rating,
    input.ratedAtMs,
    input.ratedAtMs,
    input.ratedAtMs,
    input.reviewDurationMs === undefined ? 0 : input.reviewDurationMs,
    input.deltaDays,
    input.priorStateJson ?? JSON.stringify({ memoryState: "new" }),
    input.ratedAtMs + 1,
  );
}

describe("OptimizerDataRepository", () => {
  it("orders global histories deterministically without mixing item scopes", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seed(db);
        insertReview(db, {
          id: "log-b",
          itemId: "item-a",
          sectionId: "section-a",
          rating: 3,
          deltaDays: 1,
          ratedAtMs: 100,
        });
        insertReview(db, {
          id: "log-a",
          itemId: "item-a",
          sectionId: "section-a",
          rating: 2,
          deltaDays: 0,
          ratedAtMs: 100,
        });
        insertReview(db, {
          id: "log-c",
          itemId: "item-b",
          sectionId: "section-b",
          rating: 4,
          deltaDays: 2,
          ratedAtMs: 50,
        });

        const rows = new OptimizerDataRepository(db).listReviewHistory({
          scopeType: "global",
          sectionId: null,
        });
        expect(rows.map(({ reviewLogId }) => reviewLogId)).toEqual([
          "log-a",
          "log-b",
          "log-c",
        ]);
        expect(rows.map(({ learningItemId }) => learningItemId)).toEqual([
          "item-a",
          "item-a",
          "item-b",
        ]);
        expect(
          new OptimizerDataRepository(db).getEligibilityCounts({
            scopeType: "global",
            sectionId: null,
          }),
        ).toEqual({
          rawReviewCount: 3,
          eligibleExampleCount: 1,
          sourceReviewCutoffMs: 100,
        });
      } finally {
        db.close();
      }
    });
  });

  it("filters a section exactly and rejects invalid persisted rating/delta rows", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seed(db);
        insertReview(db, {
          id: "section-a-log",
          itemId: "item-a",
          sectionId: "section-a",
          rating: 3,
          deltaDays: 0,
          ratedAtMs: 10,
        });
        insertReview(db, {
          id: "section-b-log",
          itemId: "item-b",
          sectionId: "section-b",
          rating: 4,
          deltaDays: 1,
          ratedAtMs: 20,
        });
        const repository = new OptimizerDataRepository(db);
        expect(
          repository
            .listReviewHistory({
              scopeType: "section",
              sectionId: "section-a",
            })
            .map(({ reviewLogId }) => reviewLogId),
        ).toEqual(["section-a-log"]);

        db.pragma("ignore_check_constraints = ON");
        db.prepare(
          "UPDATE review_logs SET rating = 9 WHERE id = 'section-a-log'",
        ).run();
        expect(() =>
          repository.listReviewHistory({
            scopeType: "section",
            sectionId: "section-a",
          }),
        ).toThrow("OPTIMIZER_REVIEW_RATING_INVALID");
        db.prepare(
          "UPDATE review_logs SET rating = 3, study_day_delta = -1 WHERE id = 'section-a-log'",
        ).run();
        expect(() =>
          repository.listReviewHistory({
            scopeType: "section",
            sectionId: "section-a",
          }),
        ).toThrow("OPTIMIZER_REVIEW_DELTA_INVALID");
      } finally {
        db.close();
      }
    });
  });

  it("returns complete raw step history without parsing or discarding invalid rows", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seed(db);
        db.pragma("ignore_check_constraints = ON");
        insertReview(db, {
          id: "log-b",
          itemId: "item-a",
          sectionId: "section-a",
          rating: 9,
          deltaDays: 0,
          ratedAtMs: 100,
          reviewDurationMs: null,
          priorStateJson: "{",
        });
        insertReview(db, {
          id: "log-a",
          itemId: "item-a",
          sectionId: "section-a",
          rating: 3,
          deltaDays: 0,
          ratedAtMs: 100,
          reviewDurationMs: 321,
          priorStateJson: JSON.stringify({ memoryState: "learning" }),
        });

        const rows = new OptimizerDataRepository(db).listStepReviewHistory({
          scopeType: "section",
          sectionId: "section-a",
        });

        expect(rows).toEqual([
          {
            reviewLogId: "log-a",
            learningItemId: "item-a",
            sectionId: "section-a",
            rating: 3,
            ratedAtMs: 100,
            reviewDurationMs: 321,
            priorStateJson: JSON.stringify({ memoryState: "learning" }),
          },
          {
            reviewLogId: "log-b",
            learningItemId: "item-a",
            sectionId: "section-a",
            rating: 9,
            ratedAtMs: 100,
            reviewDurationMs: null,
            priorStateJson: "{",
          },
        ]);
      } finally {
        db.close();
      }
    });
  });
});
