import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./open-database.js";
import {
  SECTION_ONE,
  seedStatisticsFixture,
} from "./statistics-test-fixture.js";
import { StatisticsRepository } from "./statistics-repository.js";

const studyDay = { timeZone: "Africa/Cairo", boundaryMinutes: 240 };
const nowMs = Date.parse("2025-01-17T12:00:00Z");

describe("StatisticsRepository", () => {
  it("returns hand-calculated global and section metrics with exclusions", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seedStatisticsFixture(db);
        const repository = new StatisticsRepository(db);
        const global = repository.getGlobalStatistics(
          { fromStudyDay: null, toStudyDay: null },
          nowMs,
          studyDay,
        );
        const section = repository.getSectionStatistics(
          SECTION_ONE,
          { fromStudyDay: null, toStudyDay: null },
          nowMs,
          studyDay,
        );

        expect(global.summary).toEqual({
          reviewEvents: 4,
          uniqueItems: 3,
          ratingCounts: { 1: 1, 2: 1, 3: 1, 4: 1 },
          actualRecall: 0.75,
          meanPredictedRetrievability: (0.2 + 0.8 + 0.6) / 3,
          retrievabilityExcluded: 1,
          studyDurationMs: 600,
          durationExcluded: 1,
        });
        expect(section?.summary).toEqual({
          reviewEvents: 3,
          uniqueItems: 2,
          ratingCounts: { 1: 1, 2: 0, 3: 1, 4: 1 },
          actualRecall: 2 / 3,
          meanPredictedRetrievability: 0.5,
          retrievabilityExcluded: 1,
          studyDurationMs: 400,
          durationExcluded: 1,
        });
        expect(global.stateCounts).toEqual({
          total: 3,
          dueNow: 1,
          new: 1,
          learning: 1,
          review: 1,
          relearning: 0,
        });
        expect(global.sections).toEqual([
          expect.objectContaining({
            sectionId: SECTION_ONE,
            total: 2,
            dueNow: 1,
          }),
          expect.objectContaining({
            sectionId: "section-2",
            total: 1,
            dueNow: 0,
          }),
        ]);
        expect(
          global.dailyActivity.reduce(
            (total, point) => total + point.reviewEvents,
            0,
          ),
        ).toBe(4);
        expect(global.workloadForecast).toHaveLength(30);
      } finally {
        db.close();
      }
    });
  });

  it("applies inclusive-from and exclusive-to study-day filters", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seedStatisticsFixture(db);
        const result = new StatisticsRepository(db).getGlobalStatistics(
          {
            fromStudyDay: "2025-01-15",
            toStudyDay: "2025-01-17",
          },
          nowMs,
          studyDay,
        );
        expect(result.summary.reviewEvents).toBe(2);
        expect(result.summary.ratingCounts).toEqual({
          1: 0,
          2: 0,
          3: 1,
          4: 1,
        });
      } finally {
        db.close();
      }
    });
  });

  it("uses the named time and due indexes for bounded aggregate queries", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seedStatisticsFixture(db);
        const globalPlan = db
          .prepare(
            "EXPLAIN QUERY PLAN SELECT id FROM review_logs WHERE rated_at_ms >= ? AND rated_at_ms < ? ORDER BY rated_at_ms, id",
          )
          .all(0, nowMs) as Array<{ detail: string }>;
        const sectionPlan = db
          .prepare(
            "EXPLAIN QUERY PLAN SELECT id FROM review_logs WHERE section_id = ? AND rated_at_ms >= ? AND rated_at_ms < ? ORDER BY rated_at_ms, id",
          )
          .all(SECTION_ONE, 0, nowMs) as Array<{ detail: string }>;
        const duePlan = db
          .prepare(
            "EXPLAIN QUERY PLAN SELECT learning_item_id FROM scheduler_states WHERE due_at_ms >= ? AND due_at_ms < ? ORDER BY due_at_ms, learning_item_id",
          )
          .all(0, nowMs) as Array<{ detail: string }>;
        expect(globalPlan.some(({ detail }) => detail.includes("idx_review_logs_time"))).toBe(true);
        expect(sectionPlan.some(({ detail }) => detail.includes("idx_review_logs_section_time"))).toBe(true);
        expect(duePlan.some(({ detail }) => detail.includes("idx_scheduler_due"))).toBe(true);
      } finally {
        db.close();
      }
    });
  });
});
