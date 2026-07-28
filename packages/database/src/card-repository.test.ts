import type { AcceptedImportItem } from "@openrecall/domain";
import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { CardImportRepository } from "./card-import-repository.js";
import { CardRepository } from "./card-repository.js";
import { openDatabase } from "./open-database.js";
import { RatingTransaction } from "./rating-transaction.js";
import { ReviewQueueRepository } from "./review-queue-repository.js";
import { ReviewSessionRepository } from "./review-session-repository.js";
import { SectionRepository } from "./section-repository.js";

const cardFixture = (
  front: string,
  variants: AcceptedImportItem["variants"] = [],
): AcceptedImportItem => ({
  sourceIndex: 0,
  front,
  back: `${front} answer`,
  notes: null,
  variants,
});

function importCard(
  db: ReturnType<typeof openDatabase>,
  sectionId: string,
  item: AcceptedImportItem,
  nowMs: number,
): string {
  return new CardImportRepository(db).commitImport(
    sectionId,
    [item],
    nowMs,
  ).importedItemIds[0]!;
}

function rateOneAppearance(
  db: ReturnType<typeof openDatabase>,
  sectionId: string,
  itemId: string,
  nowMs: number,
): { sessionId: string; entryId: string } {
  db.prepare(
    "UPDATE scheduler_states SET due_at_ms = ? WHERE learning_item_id = ?",
  ).run(nowMs, itemId);
  const queue = new ReviewQueueRepository(db);
  const session = queue.startOrResumeSession(sectionId, nowMs);
  const card = new ReviewSessionRepository(db).claimNext(
    session.id,
    nowMs,
    () => 0,
  );
  if (card === null) {
    throw new Error("EXPECTED_REVIEW_CARD");
  }
  const ratings = new RatingTransaction(db);
  ratings.markShown(
    session.id,
    card.entryId,
    card.presentationId,
    nowMs + 10,
  );
  ratings.markRevealed(session.id, card.entryId, nowMs + 20);
  ratings.rate({
    sessionId: session.id,
    entryId: card.entryId,
    learningItemId: itemId,
    rating: 3,
    expectedStateRevision: card.stateRevision,
    idempotencyKey: `rating-${itemId}`,
    nowMs: nowMs + 30,
  });
  return { sessionId: session.id, entryId: card.entryId };
}

describe("CardRepository listing and editing", () => {
  it("uses stable bounded cursors and searches every active presentation", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        const section = new SectionRepository(db).createSection({
          name: "Biology",
          nowMs: 100,
        });
        importCard(db, section.id, cardFixture("Alpha"), 1_000);
        importCard(
          db,
          section.id,
          cardFixture("Beta", [
            { front: "Hidden mitochondria wording", back: "B", notes: null },
          ]),
          2_000,
        );
        importCard(db, section.id, cardFixture("Gamma"), 3_000);
        const repository = new CardRepository(db);

        const first = repository.listCards({
          sectionId: section.id,
          cursor: null,
          query: "",
          lifecycle: "active",
          limit: 2,
        });
        const second = repository.listCards({
          sectionId: section.id,
          cursor: first.nextCursor,
          query: "",
          lifecycle: "active",
          limit: 2,
        });
        const searched = repository.listCards({
          sectionId: section.id,
          cursor: null,
          query: "mitochondria",
          lifecycle: "active",
          limit: 100,
        });

        expect(first.items.map((card) => card.presentations[0]?.front)).toEqual([
          "Gamma",
          "Beta",
        ]);
        expect(second.items.map((card) => card.presentations[0]?.front)).toEqual([
          "Alpha",
        ]);
        expect(searched.items).toHaveLength(1);
        expect(searched.items[0]?.presentations).toHaveLength(2);
        expect(() =>
          repository.listCards({
            sectionId: section.id,
            cursor: "not-a-cursor",
            query: "",
            lifecycle: "active",
            limit: 101,
          }),
        ).toThrow("CARD_PAGE_LIMIT_INVALID");
      } finally {
        db.close();
      }
    });
  });

  it("atomically edits presentations while preserving item, primary, state, and history identity", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        const section = new SectionRepository(db).createSection({
          name: "Biology",
          nowMs: 100,
        });
        const itemId = importCard(
          db,
          section.id,
          cardFixture("Original", [
            { front: "Variant A", back: "A", notes: null },
            { front: "Variant B", back: "B", notes: null },
          ]),
          1_000,
        );
        const repository = new CardRepository(db);
        const before = repository.getCard(itemId);
        if (before === null) {
          throw new Error("EXPECTED_CARD");
        }
        const schedulerBefore = db
          .prepare("SELECT * FROM scheduler_states WHERE learning_item_id = ?")
          .get(itemId);

        const updated = repository.updateLearningItem({
          itemId,
          expectedUpdatedAtMs: before.updatedAtMs,
          presentations: [
            {
              id: before.presentations[0]!.id,
              front: "Edited primary",
              back: "Edited answer",
              notes: null,
            },
            {
              id: before.presentations[2]!.id,
              front: "Variant B moved",
              back: "B2",
              notes: "Hint",
            },
            { front: "New variant", back: "New answer", notes: null },
          ],
          nowMs: 2_000,
        });

        expect(updated.id).toBe(itemId);
        expect(updated.presentations[0]?.id).toBe(
          before.presentations[0]?.id,
        );
        expect(updated.presentations.map(({ front }) => front)).toEqual([
          "Edited primary",
          "Variant B moved",
          "New variant",
        ]);
        expect(
          db
            .prepare(
              "SELECT * FROM scheduler_states WHERE learning_item_id = ?",
            )
            .get(itemId),
        ).toEqual(schedulerBefore);
        expect(() =>
          repository.updateLearningItem({
            itemId,
            expectedUpdatedAtMs: before.updatedAtMs,
            presentations: updated.presentations,
            nowMs: 3_000,
          }),
        ).toThrow("CARD_EDIT_CONFLICT");
      } finally {
        db.close();
      }
    });
  });
});

describe("CardRepository lifecycle", () => {
  it("trashes pending appearances without logs and restores only lifecycle", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        const section = new SectionRepository(db).createSection({
          name: "Biology",
          nowMs: 100,
        });
        const itemId = importCard(db, section.id, cardFixture("Reviewed"), 1_000);
        const appearance = rateOneAppearance(db, section.id, itemId, 2_000);
        db.prepare(
          "UPDATE scheduler_states SET due_at_ms = ? WHERE learning_item_id = ?",
        ).run(3_000, itemId);
        new ReviewQueueRepository(db).mergeDueItems(
          appearance.sessionId,
          3_000,
        );
        const repository = new CardRepository(db);
        const before = repository.getCard(itemId)!;

        const trashed = repository.trashItem({
          itemId,
          expectedUpdatedAtMs: before.updatedAtMs,
          nowMs: 4_000,
        });
        expect(trashed.lifecycle).toBe("trashed");
        expect(
          db
            .prepare(
              `
                SELECT status
                FROM session_queue_entries
                WHERE session_id = ? AND learning_item_id = ?
                ORDER BY enqueued_at_ms DESC
                LIMIT 1
              `,
            )
            .pluck()
            .get(appearance.sessionId, itemId),
        ).toBe("removed");
        expect(
          db
            .prepare("SELECT count(*) FROM review_logs WHERE learning_item_id = ?")
            .pluck()
            .get(itemId),
        ).toBe(1);

        const restored = repository.restoreItem({
          itemId,
          expectedUpdatedAtMs: trashed.updatedAtMs,
          nowMs: 5_000,
        });
        expect(restored.lifecycle).toBe("active");
        expect(
          db
            .prepare(
              `
                SELECT count(*)
                FROM session_queue_entries
                WHERE learning_item_id = ?
                  AND status IN ('queued', 'active')
              `,
            )
            .pluck()
            .get(itemId),
        ).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  it("requires explicit permanent confirmation and deletes only one complete history", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        const section = new SectionRepository(db).createSection({
          name: "Biology",
          nowMs: 100,
        });
        const doomedId = importCard(db, section.id, cardFixture("Doomed"), 1_000);
        rateOneAppearance(db, section.id, doomedId, 2_000);
        const siblingId = importCard(
          db,
          section.id,
          cardFixture("Sibling"),
          3_000,
        );
        const repository = new CardRepository(db);
        const doomed = repository.getCard(doomedId)!;

        expect(() =>
          repository.permanentlyDeleteItem({
            itemId: doomedId,
            confirmationItemId: siblingId,
            expectedUpdatedAtMs: doomed.updatedAtMs,
          }),
        ).toThrow("PERMANENT_DELETE_CONFIRMATION_MISMATCH");

        repository.permanentlyDeleteItem({
          itemId: doomedId,
          confirmationItemId: doomedId,
          expectedUpdatedAtMs: doomed.updatedAtMs,
        });

        expect(repository.getCard(doomedId)).toBeNull();
        expect(repository.getCard(siblingId)?.id).toBe(siblingId);
        expect(
          db
            .prepare(
              `
                SELECT
                  (SELECT count(*) FROM review_logs WHERE learning_item_id = ?) AS logs,
                  (SELECT count(*) FROM scheduler_states WHERE learning_item_id = ?) AS states,
                  (SELECT count(*) FROM session_queue_entries WHERE learning_item_id = ?) AS queue
              `,
            )
            .get(doomedId, doomedId, doomedId),
        ).toEqual({ logs: 0, states: 0, queue: 0 });
      } finally {
        db.close();
      }
    });
  });
});
