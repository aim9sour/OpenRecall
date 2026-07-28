import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { calculateStatisticsSummary } from "./calculate-summary.js";
import { groupDailyActivity } from "./group-study-days.js";
import type { StatisticsEvent } from "./types.js";

const eventArbitrary: fc.Arbitrary<StatisticsEvent> = fc.record({
  learningItemId: fc.string({ minLength: 1, maxLength: 20 }),
  rating: fc.constantFrom(1 as const, 2 as const, 3 as const, 4 as const),
  retrievability: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), {
    nil: null,
  }),
  durationMs: fc.option(fc.integer({ min: 0, max: 1_000_000 }), {
    nil: null,
  }),
  ratedAtMs: fc.integer({
    min: Date.UTC(2020, 0, 1),
    max: Date.UTC(2030, 0, 1),
  }),
});

describe("statistics properties", () => {
  it("keeps totals, ratios, and non-negative durations invariant", () => {
    fc.assert(
      fc.property(fc.array(eventArbitrary, { maxLength: 200 }), (events) => {
        const summary = calculateStatisticsSummary(events);
        expect(
          Object.values(summary.ratingCounts).reduce(
            (total, value) => total + value,
            0,
          ),
        ).toBe(summary.reviewEvents);
        if (summary.actualRecall !== null) {
          expect(summary.actualRecall).toBeGreaterThanOrEqual(0);
          expect(summary.actualRecall).toBeLessThanOrEqual(1);
        }
        expect(summary.studyDurationMs).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 },
    );
  });

  it("never loses an event during study-day regrouping", () => {
    fc.assert(
      fc.property(fc.array(eventArbitrary, { maxLength: 200 }), (events) => {
        const grouped = groupDailyActivity(events, {
          timeZone: "Africa/Cairo",
          boundaryMinutes: 240,
        });
        expect(
          grouped.reduce((total, day) => total + day.reviewEvents, 0),
        ).toBe(events.length);
      }),
      { numRuns: 150 },
    );
  });
});
