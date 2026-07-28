import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./open-database.js";
import {
  OpenReviewSessionError,
  ReviewQueueRepository,
} from "./review-queue-repository.js";

type TestDatabase = ReturnType<typeof openDatabase>;

function insertSection(
  db: TestDatabase,
  id: string,
  name = id,
): void {
  db.prepare(
    `
      INSERT INTO sections (id, name, created_at_ms, updated_at_ms)
      VALUES (?, ?, 0, 0)
    `,
  ).run(id, name);
}

function insertItem(
  db: TestDatabase,
  input: {
    id: string;
    sectionId: string;
    dueAtMs: number;
    memoryState?: "new" | "review";
    lifecycle?: "active" | "trashed";
  },
): void {
  db.prepare(
    `
      INSERT INTO learning_items
        (id, section_id, lifecycle, created_at_ms, updated_at_ms)
      VALUES
        (@id, @sectionId, @lifecycle, 0, 0)
    `,
  ).run({
    id: input.id,
    sectionId: input.sectionId,
    lifecycle: input.lifecycle ?? "active",
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
      VALUES
        (
          @id,
          @sectionId,
          @dueAtMs,
          @memoryState,
          NULL,
          0,
          0,
          0,
          0,
          NULL,
          0,
          0,
          0,
          'FSRS-6',
          '6.0',
          1,
          'official-fsrs6-v1'
        )
    `,
  ).run({
    id: input.id,
    sectionId: input.sectionId,
    dueAtMs: input.dueAtMs,
    memoryState: input.memoryState ?? "new",
  });
}

describe("ReviewQueueRepository", () => {
  it("starts with every active new/due item and excludes future or trashed items", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        insertSection(db, "section-1");
        insertItem(db, { id: "new-old", sectionId: "section-1", dueAtMs: 0 });
        insertItem(db, {
          id: "review-due",
          sectionId: "section-1",
          dueAtMs: 999,
          memoryState: "review",
        });
        insertItem(db, {
          id: "due-exactly",
          sectionId: "section-1",
          dueAtMs: 1000,
        });
        insertItem(db, {
          id: "future",
          sectionId: "section-1",
          dueAtMs: 1001,
        });
        insertItem(db, {
          id: "trashed",
          sectionId: "section-1",
          dueAtMs: 0,
          lifecycle: "trashed",
        });

        const snapshot = new ReviewQueueRepository(db).startOrResumeSession(
          "section-1",
          1000,
        );

        expect(snapshot).toMatchObject({
          sectionId: "section-1",
          status: "active",
          completedAppearances: 0,
          currentlyRemaining: 3,
          newRemaining: 2,
          repeatedWithinSession: 0,
          elapsedActiveMs: 0,
          newlyJoined: 3,
          nextDueAtMs: 1001,
          remainingSnapshotAtMs: 1000,
        });
        expect(
          db
            .prepare(
              `
                SELECT learning_item_id
                FROM session_queue_entries
                WHERE session_id = ?
                ORDER BY enqueued_due_at_ms, learning_item_id
              `,
            )
            .pluck()
            .all(snapshot.id),
        ).toEqual(["new-old", "review-due", "due-exactly"]);
      } finally {
        db.close();
      }
    });
  });

  it("merges newly due items idempotently and allows re-entry after completion", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        insertSection(db, "section-1");
        insertItem(db, {
          id: "item-1",
          sectionId: "section-1",
          dueAtMs: 1000,
        });
        insertItem(db, {
          id: "item-2",
          sectionId: "section-1",
          dueAtMs: 2000,
        });
        const repository = new ReviewQueueRepository(db);
        const started = repository.startOrResumeSession("section-1", 1000);

        expect(repository.mergeDueItems(started.id, 1000)).toEqual({
          added: 0,
          revision: started.revision,
        });
        db.prepare(
          "UPDATE scheduler_states SET due_at_ms = 1000 WHERE learning_item_id = 'item-2'",
        ).run();
        const merged = repository.mergeDueItems(started.id, 1000);
        expect(merged).toEqual({
          added: 1,
          revision: started.revision + 1,
        });
        expect(repository.mergeDueItems(started.id, 1000)).toEqual({
          added: 0,
          revision: merged.revision,
        });

        db.prepare(
          `
            UPDATE session_queue_entries
            SET status = 'completed', completed_at_ms = 1100
            WHERE session_id = ? AND learning_item_id = 'item-1'
          `,
        ).run(started.id);
        db.prepare(
          "UPDATE scheduler_states SET due_at_ms = 1200 WHERE learning_item_id = 'item-1'",
        ).run();
        const reentered = repository.mergeDueItems(started.id, 1200);
        expect(reentered.added).toBe(1);
        expect(
          db
            .prepare(
              `
                SELECT count(*)
                FROM session_queue_entries
                WHERE session_id = ? AND learning_item_id = 'item-1'
              `,
            )
            .pluck()
            .get(started.id),
        ).toBe(2);
        expect(
          repository.startOrResumeSession("section-1", 1200),
        ).toMatchObject({
          completedAppearances: 1,
          currentlyRemaining: 2,
          repeatedWithinSession: 1,
          newlyJoined: 0,
          revision: reentered.revision,
        });
      } finally {
        db.close();
      }
    });
  });

  it("resumes a paused session and merges cards that became due", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        insertSection(db, "section-1");
        insertItem(db, {
          id: "future",
          sectionId: "section-1",
          dueAtMs: 2000,
        });
        const repository = new ReviewQueueRepository(db);
        const waiting = repository.startOrResumeSession("section-1", 1000);
        db.prepare(
          `
            UPDATE review_sessions
            SET status = 'paused', paused_at_ms = 1100
            WHERE id = ?
          `,
        ).run(waiting.id);

        const resumed = repository.startOrResumeSession("section-1", 2000);

        expect(resumed).toMatchObject({
          id: waiting.id,
          status: "active",
          currentlyRemaining: 1,
          newlyJoined: 1,
        });
        expect(resumed.revision).toBeGreaterThan(waiting.revision);
      } finally {
        db.close();
      }
    });
  });

  it("rejects a second section while reporting exact nearest due for an empty queue", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        insertSection(db, "section-1");
        insertSection(db, "section-2");
        insertItem(db, {
          id: "future",
          sectionId: "section-1",
          dueAtMs: 5000,
        });
        const repository = new ReviewQueueRepository(db);
        const waiting = repository.startOrResumeSession("section-1", 1000);

        expect(waiting).toMatchObject({
          status: "waiting",
          currentlyRemaining: 0,
          nextDueAtMs: 5000,
        });
        expect(repository.getNearestFutureDue("section-1", 1000)).toBe(5000);
        expect(() =>
          repository.startOrResumeSession("section-2", 1000),
        ).toThrow(OpenReviewSessionError);
      } finally {
        db.close();
      }
    });
  });
});
