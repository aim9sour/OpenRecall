import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./open-database.js";
import {
  ProfileApplicationRepository,
  type RebuiltSchedulerState,
} from "./profile-application-repository.js";

const settingsJson = JSON.stringify({
  requestedRetention: 0.9,
  maximumIntervalDays: 36_500,
  enableFuzz: false,
  enableShortTerm: true,
  learningStepsMinutes: [1, 10],
  relearningStepsMinutes: [10],
});
const weightsJson = JSON.stringify(
  Array.from({ length: 21 }, (_, index) => index + 0.25),
);

function seed(db: ReturnType<typeof openDatabase>): void {
  db.exec(`
    INSERT INTO sections (id, name, created_at_ms, updated_at_ms)
    VALUES
      ('section-a', 'A', 0, 0),
      ('section-b', 'B', 0, 0);

    INSERT INTO learning_items
      (id, section_id, lifecycle, created_at_ms, updated_at_ms)
    VALUES
      ('item-a', 'section-a', 'active', 10, 10),
      ('item-b', 'section-b', 'active', 20, 20);

    INSERT INTO presentations
      (
        id, learning_item_id, kind, ordinal, front, back,
        normalized_front, normalized_back
      )
    VALUES
      ('presentation-a', 'item-a', 'primary', 0, 'A?', 'A', 'a?', 'a'),
      ('presentation-b', 'item-b', 'primary', 0, 'B?', 'B', 'b?', 'b');

    INSERT INTO scheduler_states
      (
        learning_item_id, section_id, due_at_ms, memory_state, step_index,
        stability, difficulty, elapsed_days_at_last_review, scheduled_days,
        last_review_at_ms, repetitions, lapses, revision, algorithm_id,
        algorithm_version, adapter_version, parameter_profile_id
      )
    VALUES
      ('item-a', 'section-a', 500, 'review', NULL, 4, 5, 1, 3, 100,
       2, 0, 1, 'FSRS-6', '6.0', 1, 'official-fsrs6-v1'),
      ('item-b', 'section-b', 600, 'new', NULL, 0, 0, 0, 0, NULL,
       0, 0, 0, 'FSRS-6', '6.0', 1, 'official-fsrs6-v1');

    INSERT INTO parameter_profiles
      (
        id, scope_type, section_id, algorithm_id, algorithm_version,
        adapter_version, weights_json, eligible_example_count,
        review_cutoff_ms, status, created_at_ms
      )
    VALUES
      (
        'candidate-global', 'global', NULL, 'FSRS-6', '6.0',
        1, '${weightsJson}', 400, 100, 'candidate', 200
      ),
      (
        'active-section-b', 'section', 'section-b', 'FSRS-6', '6.0',
        1, '${weightsJson}', 400, NULL, 'active', 150
      );

    INSERT INTO review_sessions
      (id, section_id, status, started_at_ms, completed_at_ms)
    VALUES ('session-a', 'section-a', 'completed', 0, 100);

    INSERT INTO session_queue_entries
      (
        id, session_id, learning_item_id, status, enqueued_due_at_ms,
        enqueued_at_ms, presentation_id, completed_at_ms
      )
    VALUES
      (
        'entry-a', 'session-a', 'item-a', 'completed', 0, 0,
        'presentation-a', 100
      );

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
        'log-a', 'session-a', 'entry-a', 'item-a', 'section-a',
        'presentation-a', 'A?', 'A', 3, 90, 95, 100, 5, 1, '{}', '{}',
        'FSRS-6', '6.0', 1, 'official-fsrs6-v1',
        'Africa/Cairo', 240, '${settingsJson}', 500
      );
  `);
}

function rebuilt(
  learningItemId: string,
  revision: number,
  dueAtMs: number,
): RebuiltSchedulerState {
  return {
    learningItemId,
    state: {
      schemaVersion: 1,
      dueAtMs,
      memoryState: "review",
      stepIndex: null,
      stability: 9,
      difficulty: 4,
      elapsedDaysAtLastReview: 1,
      scheduledDays: 7,
      lastReviewAtMs: 100,
      repetitions: revision,
      lapses: 0,
      revision,
    },
  };
}

describe("ProfileApplicationRepository", () => {
  it("captures immutable histories and excludes sections with active section profiles from global application", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seed(db);
        const capture = new ProfileApplicationRepository(db).capture(
          "candidate-global",
        );

        expect(capture.target).toMatchObject({
          id: "candidate-global",
          scopeType: "global",
          status: "candidate",
          reviewCutoffMs: 100,
        });
        expect(capture.previous.id).toBe("official-fsrs6-v1");
        expect(capture.items.map(({ learningItemId }) => learningItemId)).toEqual([
          "item-a",
        ]);
        expect(capture.items[0]).toMatchObject({
          createdAtMs: 10,
          expectedRevision: 1,
          oldState: { dueAtMs: 500 },
          history: {
            logs: [
              {
                id: "log-a",
                rating: 3,
                timeZone: "Africa/Cairo",
                boundaryMinutes: 240,
              },
            ],
          },
        });
        expect(capture.currentReviewCutoffMs).toBe(100);
      } finally {
        db.close();
      }
    });
  });

  it("atomically replaces states, activates the target, and writes an immutable audit", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seed(db);
        const repository = new ProfileApplicationRepository(db);
        const capture = repository.capture("candidate-global");
        const application = repository.apply({
          capture,
          rebuiltStates: [rebuilt("item-a", 1, 900)],
          backupFilename: "openrecall-automatic-300-test.sqlite3",
          applicationId: "application-1",
          appliedAtMs: 300,
        });

        expect(application).toMatchObject({
          id: "application-1",
          profileId: "candidate-global",
          previousProfileId: "official-fsrs6-v1",
          affectedItemCount: 1,
        });
        expect(
          db.prepare(
            `
              SELECT due_at_ms, revision, parameter_profile_id
              FROM scheduler_states WHERE learning_item_id = 'item-a'
            `,
          ).get(),
        ).toEqual({
          due_at_ms: 900,
          revision: 1,
          parameter_profile_id: "candidate-global",
        });
        expect(
          db.prepare(
            "SELECT status FROM parameter_profiles WHERE id = 'candidate-global'",
          ).pluck().get(),
        ).toBe("active");
        expect(
          db.prepare(
            "SELECT status FROM parameter_profiles WHERE id = 'official-fsrs6-v1'",
          ).pluck().get(),
        ).toBe("active");
        expect(
          db.prepare(
            "SELECT backup_filename FROM profile_applications WHERE id = 'application-1'",
          ).pluck().get(),
        ).toBe("openrecall-automatic-300-test.sqlite3");
        expect(() =>
          db.prepare(
            "DELETE FROM profile_applications WHERE id = 'application-1'",
          ).run(),
        ).toThrow("PROFILE_APPLICATION_AUDIT_IMMUTABLE");
      } finally {
        db.close();
      }
    });
  });

  it("rolls back every write when cutoff or state revisions changed after capture", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seed(db);
        const repository = new ProfileApplicationRepository(db);
        const capture = repository.capture("candidate-global");
        db.prepare(
          "UPDATE scheduler_states SET revision = 2 WHERE learning_item_id = 'item-a'",
        ).run();

        expect(() =>
          repository.apply({
            capture,
            rebuiltStates: [rebuilt("item-a", 1, 900)],
            backupFilename: "backup.sqlite3",
            applicationId: "application-stale",
            appliedAtMs: 300,
          }),
        ).toThrow("PROFILE_APPLICATION_STALE");
        expect(
          db.prepare(
            "SELECT due_at_ms FROM scheduler_states WHERE learning_item_id = 'item-a'",
          ).pluck().get(),
        ).toBe(500);
        expect(
          db.prepare(
            "SELECT status FROM parameter_profiles WHERE id = 'candidate-global'",
          ).pluck().get(),
        ).toBe("candidate");
        expect(
          db.prepare("SELECT count(*) FROM profile_applications").pluck().get(),
        ).toBe(0);

        db.prepare(
          "UPDATE scheduler_states SET revision = 1 WHERE learning_item_id = 'item-a'",
        ).run();
        db.prepare(
          "UPDATE review_logs SET rated_at_ms = 101 WHERE id = 'log-a'",
        ).run();
        expect(() =>
          repository.apply({
            capture,
            rebuiltStates: [rebuilt("item-a", 1, 900)],
            backupFilename: "backup.sqlite3",
            applicationId: "application-cutoff-stale",
            appliedAtMs: 301,
          }),
        ).toThrow("PROFILE_APPLICATION_STALE");
        expect(
          db.prepare(
            "SELECT status FROM parameter_profiles WHERE id = 'candidate-global'",
          ).pluck().get(),
        ).toBe("candidate");
      } finally {
        db.close();
      }
    });
  });

  it("leaves the old profile and rows active when a staged replacement write fails", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seed(db);
        const repository = new ProfileApplicationRepository(db);
        const capture = repository.capture("candidate-global");
        const invalid = rebuilt("item-a", 1, 900);

        expect(() =>
          repository.apply({
            capture,
            rebuiltStates: [
              {
                ...invalid,
                state: {
                  ...invalid.state,
                  memoryState: "corrupt" as never,
                },
              },
            ],
            backupFilename: "backup.sqlite3",
            applicationId: "application-write-failure",
            appliedAtMs: 300,
          }),
        ).toThrow();
        expect(
          db.prepare(
            `
              SELECT due_at_ms, parameter_profile_id
              FROM scheduler_states WHERE learning_item_id = 'item-a'
            `,
          ).get(),
        ).toEqual({
          due_at_ms: 500,
          parameter_profile_id: "official-fsrs6-v1",
        });
        expect(
          db.prepare(
            "SELECT status FROM parameter_profiles WHERE id = 'candidate-global'",
          ).pluck().get(),
        ).toBe("candidate");
        expect(
          db.prepare("SELECT count(*) FROM profile_applications").pluck().get(),
        ).toBe(0);
      } finally {
        db.close();
      }
    });
  });
});
