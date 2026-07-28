import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./open-database.js";
import { RatingTransaction } from "./rating-transaction.js";

function insertActiveAppearance(
  db: ReturnType<typeof openDatabase>,
): void {
  db.exec(`
    INSERT INTO sections
      (id, name, created_at_ms, updated_at_ms)
    VALUES
      ('section-1', 'Biology', 0, 0);

    INSERT INTO learning_items
      (id, section_id, lifecycle, created_at_ms, updated_at_ms)
    VALUES
      ('item-1', 'section-1', 'active', 0, 0);

    INSERT INTO presentations
      (
        id, learning_item_id, kind, ordinal, front, back, notes,
        normalized_front, normalized_back
      )
    VALUES
      (
        'presentation-1', 'item-1', 'primary', 0,
        'Question', 'Answer', 'Helpful note', 'question', 'answer'
      );

    INSERT INTO presentation_exposures
      (presentation_id, show_count)
    VALUES
      ('presentation-1', 0);

    INSERT INTO scheduler_states
      (
        learning_item_id, section_id, due_at_ms, memory_state, step_index,
        stability, difficulty, elapsed_days_at_last_review, scheduled_days,
        last_review_at_ms, repetitions, lapses, revision, algorithm_id,
        algorithm_version, adapter_version, parameter_profile_id
      )
    VALUES
      (
        'item-1', 'section-1', 1000, 'new', NULL,
        0, 0, 0, 0, NULL, 0, 0, 0, 'FSRS-6',
        '6.0', 1, 'official-fsrs6-v1'
      );

    INSERT INTO review_sessions
      (id, section_id, status, started_at_ms)
    VALUES
      ('session-1', 'section-1', 'active', 900);

    INSERT INTO session_queue_entries
      (
        id, session_id, learning_item_id, status, enqueued_due_at_ms,
        enqueued_at_ms, activated_at_ms, presentation_id
      )
    VALUES
      (
        'entry-1', 'session-1', 'item-1', 'active', 1000,
        1000, 1000, 'presentation-1'
      );
  `);
}

describe("RatingTransaction shown and reveal", () => {
  it("records exposure only on the first idempotent shown call", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        insertActiveAppearance(db);
        const transaction = new RatingTransaction(db);

        transaction.markShown(
          "session-1",
          "entry-1",
          "presentation-1",
          1100,
        );
        transaction.markShown(
          "session-1",
          "entry-1",
          "presentation-1",
          1200,
        );

        expect(
          db
            .prepare(
              `
                SELECT first_shown_at_ms, last_shown_at_ms, show_count
                FROM presentation_exposures
                WHERE presentation_id = 'presentation-1'
              `,
            )
            .get(),
        ).toEqual({
          first_shown_at_ms: 1100,
          last_shown_at_ms: 1100,
          show_count: 1,
        });
        expect(
          db
            .prepare(
              "SELECT shown_at_ms FROM session_queue_entries WHERE id = 'entry-1'",
            )
            .pluck()
            .get(),
        ).toBe(1100);
        expect(
          db
            .prepare(
              "SELECT revision FROM scheduler_states WHERE learning_item_id = 'item-1'",
            )
            .pluck()
            .get(),
        ).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  it("requires shown and reveals answer/notes once with a stable timestamp", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        insertActiveAppearance(db);
        const transaction = new RatingTransaction(db);

        expect(() =>
          transaction.markRevealed("session-1", "entry-1", 1050),
        ).toThrow("REVIEW_CARD_NOT_SHOWN");
        transaction.markShown(
          "session-1",
          "entry-1",
          "presentation-1",
          1100,
        );
        const revealed = transaction.markRevealed(
          "session-1",
          "entry-1",
          1200,
        );
        const repeated = transaction.markRevealed(
          "session-1",
          "entry-1",
          1300,
        );

        expect(revealed).toEqual({
          sessionId: "session-1",
          entryId: "entry-1",
          learningItemId: "item-1",
          presentationId: "presentation-1",
          back: "Answer",
          notes: "Helpful note",
          shownAtMs: 1100,
          revealedAtMs: 1200,
        });
        expect(repeated).toEqual(revealed);
        expect(
          db
            .prepare(
              "SELECT revision FROM scheduler_states WHERE learning_item_id = 'item-1'",
            )
            .pluck()
            .get(),
        ).toBe(0);
      } finally {
        db.close();
      }
    });
  });
});

describe("RatingTransaction rate", () => {
  function reveal(transaction: RatingTransaction): void {
    transaction.markShown(
      "session-1",
      "entry-1",
      "presentation-1",
      1100,
    );
    transaction.markRevealed("session-1", "entry-1", 1200);
  }

  const rateInput = {
    sessionId: "session-1",
    entryId: "entry-1",
    learningItemId: "item-1",
    rating: 1 as const,
    expectedStateRevision: 0,
    idempotencyKey: "request-1",
    nowMs: 1300,
  };

  it.each([1, 2, 3, 4] as const)(
    "commits rating %i through the scheduler adapter",
    async (rating) => {
      await withTempDatabase((databasePath) => {
        const db = openDatabase(databasePath);

        try {
          insertActiveAppearance(db);
          const transaction = new RatingTransaction(db);
          reveal(transaction);

          const response = transaction.rate({
            ...rateInput,
            rating,
            idempotencyKey: `request-rating-${rating}`,
          });

          expect(response.rating).toBe(rating);
          expect(response.stateRevision).toBe(1);
          expect(response.dueAtMs).toBeGreaterThan(1300);
          expect(
            db
              .prepare("SELECT rating FROM review_logs")
              .pluck()
              .get(),
          ).toBe(rating);
        } finally {
          db.close();
        }
      });
    },
  );

  it("rejects rating before reveal and stale scheduler revisions", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        insertActiveAppearance(db);
        const transaction = new RatingTransaction(db);

        expect(() => transaction.rate(rateInput)).toThrow(
          "REVIEW_CARD_NOT_REVEALED",
        );
        reveal(transaction);
        expect(() =>
          transaction.rate({
            ...rateInput,
            expectedStateRevision: 1,
          }),
        ).toThrow("STALE_SCHEDULER_STATE");
      } finally {
        db.close();
      }
    });
  });

  it("commits one log/state/completion and replays an idempotent response", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        insertActiveAppearance(db);
        const transaction = new RatingTransaction(db);
        reveal(transaction);

        const response = transaction.rate(rateInput);
        const replayed = transaction.rate({
          ...rateInput,
          nowMs: 9999,
          rating: 4,
        });

        expect(JSON.stringify(replayed)).toBe(JSON.stringify(response));
        expect(response).toMatchObject({
          sessionId: "session-1",
          entryId: "entry-1",
          learningItemId: "item-1",
          rating: 1,
          stateRevision: 1,
        });
        expect(
          db.prepare("SELECT count(*) FROM review_logs").pluck().get(),
        ).toBe(1);
        expect(
          db
            .prepare(
              "SELECT revision FROM scheduler_states WHERE learning_item_id = 'item-1'",
            )
            .pluck()
            .get(),
        ).toBe(1);
        expect(
          db
            .prepare(
              "SELECT status FROM session_queue_entries WHERE id = 'entry-1'",
            )
            .pluck()
            .get(),
        ).toBe("completed");
        expect(
          db.prepare("SELECT count(*) FROM rating_requests").pluck().get(),
        ).toBe(1);
      } finally {
        db.close();
      }
    });
  });

  it("captures effective replay metadata and merges other newly due items", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        insertActiveAppearance(db);
        db.exec(`
          INSERT INTO parameter_profiles
            (
              id, scope_type, section_id, status, algorithm_id,
              algorithm_version, adapter_version, weights_json,
              eligible_example_count, created_at_ms
            )
          SELECT
            'section-1-fsrs6-v1', 'section', 'section-1', 'active',
            algorithm_id, algorithm_version, adapter_version, weights_json,
            1000, 100
          FROM parameter_profiles
          WHERE id = 'official-fsrs6-v1';

          INSERT INTO learning_items
            (id, section_id, lifecycle, created_at_ms, updated_at_ms)
          VALUES
            ('item-2', 'section-1', 'active', 0, 0);

          INSERT INTO presentations
            (
              id, learning_item_id, kind, ordinal, front, back, notes,
              normalized_front, normalized_back
            )
          VALUES
            (
              'presentation-2', 'item-2', 'primary', 0,
              'Question 2', 'Answer 2', NULL, 'question 2', 'answer 2'
            );

          INSERT INTO presentation_exposures
            (presentation_id, show_count)
          VALUES
            ('presentation-2', 0);

          INSERT INTO scheduler_states
            (
              learning_item_id, section_id, due_at_ms, memory_state, step_index,
              stability, difficulty, elapsed_days_at_last_review, scheduled_days,
              last_review_at_ms, repetitions, lapses, revision, algorithm_id,
              algorithm_version, adapter_version, parameter_profile_id
            )
          VALUES
            (
              'item-2', 'section-1', 1250, 'new', NULL,
              0, 0, 0, 0, NULL, 0, 0, 0, 'FSRS-6',
              '6.0', 1, 'official-fsrs6-v1'
            );
        `);
        const transaction = new RatingTransaction(db, {
          resolveSettings: () => ({
            studyDay: {
              timeZone: "Africa/Cairo",
              boundaryMinutes: 240,
            },
            settings: {
              requestedRetention: 0.92,
              maximumIntervalDays: 10_000,
              enableFuzz: false,
              enableShortTerm: true,
              learningStepsMinutes: [1, 10],
              relearningStepsMinutes: [10],
            },
          }),
        });
        reveal(transaction);

        const response = transaction.rate(rateInput);
        expect(response.newlyJoined).toBe(1);
        expect(
          db
            .prepare(
              `
                SELECT
                  time_zone,
                  boundary_minutes,
                  settings_json,
                  parameter_profile_id,
                  review_duration_ms,
                  study_day_delta,
                  rated_at_ms
                FROM review_logs
              `,
            )
            .get(),
        ).toEqual({
          time_zone: "Africa/Cairo",
          boundary_minutes: 240,
          settings_json: JSON.stringify({
            requestedRetention: 0.92,
            maximumIntervalDays: 10_000,
            enableFuzz: false,
            enableShortTerm: true,
            learningStepsMinutes: [1, 10],
            relearningStepsMinutes: [10],
          }),
          parameter_profile_id: "section-1-fsrs6-v1",
          review_duration_ms: 100,
          study_day_delta: 0,
          rated_at_ms: 1300,
        });
        expect(
          db
            .prepare(
              `
                SELECT parameter_profile_id
                FROM scheduler_states
                WHERE learning_item_id = 'item-1'
              `,
            )
            .pluck()
            .get(),
        ).toBe("section-1-fsrs6-v1");
      } finally {
        db.close();
      }
    });
  });

  it("rolls back every rating write when log insertion fails", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        insertActiveAppearance(db);
        const transaction = new RatingTransaction(db);
        reveal(transaction);
        db.exec(`
          CREATE TRIGGER fail_review_log
          BEFORE INSERT ON review_logs
          BEGIN
            SELECT raise(ABORT, 'forced review log failure');
          END;
        `);

        expect(() => transaction.rate(rateInput)).toThrow(
          "forced review log failure",
        );
        expect(
          db
            .prepare(
              "SELECT revision FROM scheduler_states WHERE learning_item_id = 'item-1'",
            )
            .pluck()
            .get(),
        ).toBe(0);
        expect(
          db
            .prepare(
              "SELECT status FROM session_queue_entries WHERE id = 'entry-1'",
            )
            .pluck()
            .get(),
        ).toBe("active");
        expect(
          db.prepare("SELECT count(*) FROM rating_requests").pluck().get(),
        ).toBe(0);
      } finally {
        db.close();
      }
    });
  });
});
