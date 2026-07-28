import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { CardStatisticsRepository } from "./card-statistics-repository.js";
import { openDatabase } from "./open-database.js";
import {
  ITEM_ONE,
  seedStatisticsFixture,
} from "./statistics-test-fixture.js";

describe("CardStatisticsRepository", () => {
  it("returns state, source, exposures, and stable paginated history snapshots", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seedStatisticsFixture(db);
        const repository = new CardStatisticsRepository(db);
        const first = repository.getCardStatistics(
          ITEM_ONE,
          Date.parse("2025-01-17T12:00:00Z"),
          null,
          1,
        );
        if (first === null) throw new Error("EXPECTED_CARD_STATISTICS");

        expect(first).toMatchObject({
          itemId: ITEM_ONE,
          lifecycle: "active",
          currentState: {
            memoryState: "review",
            repetitions: 2,
            lapses: 1,
            stability: 10,
            difficulty: 5,
            algorithmId: "FSRS-6",
            parameterProfileId: "official-fsrs6-v1",
          },
          lastReview: { rating: 3 },
          presentations: [
            { presentationId: "p1", showCount: 2 },
            { presentationId: "p1v", showCount: 1 },
          ],
        });
        expect(first.currentState?.retrievability).toBeGreaterThanOrEqual(0);
        expect(first.currentState?.retrievability).toBeLessThanOrEqual(1);
        expect(first.history.items).toEqual([
          expect.objectContaining({
            id: "l2",
            presentationId: "p1v",
            frontSnapshot: "Q1 alt",
            rating: 3,
          }),
        ]);
        expect(first.history.nextCursor).not.toBeNull();

        const second = repository.getCardStatistics(
          ITEM_ONE,
          Date.parse("2025-01-17T12:00:00Z"),
          first.history.nextCursor,
          1,
        )!;
        expect(second.history.items[0]).toMatchObject({
          id: "l1",
          frontSnapshot: "Q1 old",
          rating: 1,
        });
      } finally {
        db.close();
      }
    });
  });

  it("uses the per-item history index and rejects unbounded pages", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seedStatisticsFixture(db);
        const plan = db
          .prepare(
            "EXPLAIN QUERY PLAN SELECT id FROM review_logs WHERE learning_item_id = ? ORDER BY rated_at_ms DESC, id DESC LIMIT 100",
          )
          .all(ITEM_ONE) as Array<{ detail: string }>;
        expect(plan.some(({ detail }) => detail.includes("idx_review_logs_item_time"))).toBe(true);
        expect(() =>
          new CardStatisticsRepository(db).getCardStatistics(
            ITEM_ONE,
            Date.now(),
            null,
            101,
          ),
        ).toThrow("CARD_HISTORY_LIMIT_INVALID");
      } finally {
        db.close();
      }
    });
  });
});
