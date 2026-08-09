import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "./open-database.js";
import {
  REVIEW_SESSION_SELECT_REPEATED_QUEUED_SQL,
  ReviewSessionRepository,
} from "./review-session-repository.js";

function insertFixture(db: ReturnType<typeof openDatabase>): void {
  db.exec(`
    INSERT INTO sections
      (id, name, created_at_ms, updated_at_ms)
    VALUES
      ('section-1', 'Biology', 1000, 1000);

    INSERT INTO learning_items
      (id, section_id, lifecycle, created_at_ms, updated_at_ms)
    VALUES
      ('item-1', 'section-1', 'active', 1000, 1000),
      ('item-2', 'section-1', 'active', 1000, 1000),
      ('item-invalid', 'section-1', 'active', 1000, 1000),
      ('item-trashed', 'section-1', 'trashed', 1000, 1000);

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
      ('presentation-1a', 'item-1', 'primary', 0, 'Question 1A', 'Answer 1A', 'Notes 1A', 'q1a', 'a1a'),
      ('presentation-1b', 'item-1', 'variant', 1, 'Question 1B', 'Answer 1B', 'Notes 1B', 'q1b', 'a1b'),
      ('presentation-2', 'item-2', 'primary', 0, 'Question 2', 'Answer 2', NULL, 'q2', 'a2'),
      ('presentation-trashed', 'item-trashed', 'primary', 0, 'Old question', 'Old answer', NULL, 'old q', 'old a');

    INSERT INTO presentation_exposures
      (presentation_id, last_shown_at_ms, show_count)
    VALUES
      ('presentation-1a', 2000, 1),
      ('presentation-1b', NULL, 0),
      ('presentation-2', NULL, 0),
      ('presentation-trashed', NULL, 0);

    INSERT INTO review_sessions
      (id, section_id, status, started_at_ms)
    VALUES
      ('session-1', 'section-1', 'active', 3000);
  `);
}

function insertQueueEntry(
  db: ReturnType<typeof openDatabase>,
  input: {
    id: string;
    learningItemId: string;
    dueAtMs: number;
    status?: "queued" | "active" | "completed";
    presentationId?: string;
  },
): void {
  const status = input.status ?? "queued";
  db.prepare(
    `
      INSERT INTO session_queue_entries
        (
          id,
          session_id,
          learning_item_id,
          status,
          enqueued_due_at_ms,
          enqueued_at_ms,
          activated_at_ms,
          presentation_id,
          completed_at_ms
        )
      VALUES
        (
          @id,
          'session-1',
          @learningItemId,
          @status,
          @dueAtMs,
          3000,
          @activatedAtMs,
          @presentationId,
          @completedAtMs
        )
    `,
  ).run({
    id: input.id,
    learningItemId: input.learningItemId,
    status,
    dueAtMs: input.dueAtMs,
    activatedAtMs:
      status === "active" || status === "completed" ? 3500 : null,
    presentationId:
      status === "active" || status === "completed"
        ? (input.presentationId ?? null)
        : null,
    completedAtMs: status === "completed" ? 3600 : null,
  });
}

describe("ReviewSessionRepository.claimNext", () => {
  it("claims by due time then ID and returns the same active appearance", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        insertFixture(db);
        insertQueueEntry(db, {
          id: "entry-z",
          learningItemId: "item-1",
          dueAtMs: 1000,
        });
        insertQueueEntry(db, {
          id: "entry-a",
          learningItemId: "item-2",
          dueAtMs: 1000,
        });
        const randomIndex = vi.fn(() => 0);
        const repository = new ReviewSessionRepository(db);

        const first = repository.claimNext(
          "session-1",
          4000,
          randomIndex,
        );
        const repeated = repository.claimNext(
          "session-1",
          5000,
          randomIndex,
        );

        expect(first).toEqual({
          sessionId: "session-1",
          entryId: "entry-a",
          learningItemId: "item-2",
          presentationId: "presentation-2",
          front: "Question 2",
          stateRevision: 0,
        });
        expect(repeated).toEqual(first);
        expect(randomIndex).not.toHaveBeenCalled();
        expect(
          db
            .prepare(
              `
                SELECT count(*)
                FROM session_queue_entries
                WHERE session_id = 'session-1' AND status = 'active'
              `,
            )
            .pluck()
            .get(),
        ).toBe(1);
        expect(
          db
            .prepare(
              "SELECT sum(show_count) FROM presentation_exposures",
            )
            .pluck()
            .get(),
        ).toBe(1);
      } finally {
        db.close();
      }
    });
  });

  it("claims a due session repetition before the ordinary backlog", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        insertFixture(db);
        insertQueueEntry(db, {
          id: "entry-completed",
          learningItemId: "item-1",
          dueAtMs: 1000,
          status: "completed",
          presentationId: "presentation-1a",
        });
        insertQueueEntry(db, {
          id: "entry-normal",
          learningItemId: "item-2",
          dueAtMs: 1000,
        });
        insertQueueEntry(db, {
          id: "entry-repeat",
          learningItemId: "item-1",
          dueAtMs: 4000,
        });

        const claimed = new ReviewSessionRepository(db).claimNext(
          "session-1",
          4000,
          () => 0,
        );

        expect(claimed?.entryId).toBe("entry-repeat");
      } finally {
        db.close();
      }
    });
  });

  it("materializes completed items instead of correlating a scan for every queued row", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        insertFixture(db);
        const plan = db
          .prepare(`EXPLAIN QUERY PLAN ${REVIEW_SESSION_SELECT_REPEATED_QUEUED_SQL}`)
          .all("session-1", "session-1") as Array<{ detail: string }>;
        const details = plan.map(({ detail }) => detail).join("\n");

        expect(details).toContain("MATERIALIZE completed_items");
        expect(details).not.toContain("CORRELATED");
        expect(details).toMatch(
          /idx_queue_session_status|ux_session_pending_item/,
        );
      } finally {
        db.close();
      }
    });
  });

  it("selects a non-recent variant and returns front-only data", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        insertFixture(db);
        insertQueueEntry(db, {
          id: "entry-1",
          learningItemId: "item-1",
          dueAtMs: 1000,
        });

        const view = new ReviewSessionRepository(db).claimNext(
          "session-1",
          4000,
          () => 0,
        );

        expect(view).toEqual({
          sessionId: "session-1",
          entryId: "entry-1",
          learningItemId: "item-1",
          presentationId: "presentation-1b",
          front: "Question 1B",
          stateRevision: 0,
        });
        expect(view).not.toHaveProperty("back");
        expect(view).not.toHaveProperty("notes");
        expect(
          db
            .prepare(
              `
                SELECT first_shown_at_ms, last_shown_at_ms, show_count
                FROM presentation_exposures
                WHERE presentation_id = 'presentation-1b'
              `,
            )
            .get(),
        ).toEqual({
          first_shown_at_ms: null,
          last_shown_at_ms: null,
          show_count: 0,
        });
      } finally {
        db.close();
      }
    });
  });

  it("removes trashed queued items before claiming a valid one", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        insertFixture(db);
        insertQueueEntry(db, {
          id: "entry-invalid",
          learningItemId: "item-invalid",
          dueAtMs: 400,
        });
        insertQueueEntry(db, {
          id: "entry-trashed",
          learningItemId: "item-trashed",
          dueAtMs: 500,
        });
        insertQueueEntry(db, {
          id: "entry-valid",
          learningItemId: "item-2",
          dueAtMs: 1000,
        });
        const repository = new ReviewSessionRepository(db);

        expect(repository.claimNext("session-1", 4000, () => 0)?.entryId).toBe(
          "entry-valid",
        );
        expect(
          db
            .prepare(
              "SELECT status FROM session_queue_entries WHERE id = 'entry-trashed'",
            )
            .pluck()
            .get(),
        ).toBe("removed");
        expect(
          db
            .prepare(
              "SELECT status FROM session_queue_entries WHERE id = 'entry-invalid'",
            )
            .pluck()
            .get(),
        ).toBe("removed");
      } finally {
        db.close();
      }
    });
  });

  it("returns null when the session has no claimable appearance", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        insertFixture(db);
        expect(
          new ReviewSessionRepository(db).claimNext(
            "session-1",
            4000,
            () => 0,
          ),
        ).toBeNull();
      } finally {
        db.close();
      }
    });
  });
});
