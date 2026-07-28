import { describe, expect, it } from "vitest";
import { calculateStatisticsSummary } from "./calculate-summary.js";
import {
  groupCurrentDueForecast,
  groupDailyActivity,
  studyDayKey,
} from "./group-study-days.js";

describe("calculateStatisticsSummary", () => {
  it("defines recall, unique items, nullable means, duration, and exclusions", () => {
    const summary = calculateStatisticsSummary([
      {
        learningItemId: "one",
        rating: 1,
        retrievability: 0.2,
        durationMs: 1_000,
        ratedAtMs: 1_000,
      },
      {
        learningItemId: "one",
        rating: 2,
        retrievability: null,
        durationMs: null,
        ratedAtMs: 2_000,
      },
      {
        learningItemId: "two",
        rating: 3,
        retrievability: 0.8,
        durationMs: 3_000,
        ratedAtMs: 3_000,
      },
      {
        learningItemId: "three",
        rating: 4,
        retrievability: null,
        durationMs: 2_000,
        ratedAtMs: 4_000,
      },
    ]);

    expect(summary).toEqual({
      reviewEvents: 4,
      uniqueItems: 3,
      ratingCounts: { 1: 1, 2: 1, 3: 1, 4: 1 },
      actualRecall: 0.75,
      meanPredictedRetrievability: 0.5,
      retrievabilityExcluded: 2,
      studyDurationMs: 6_000,
      durationExcluded: 1,
    });
  });

  it("uses null rather than a false zero for an empty scope", () => {
    expect(calculateStatisticsSummary([])).toEqual({
      reviewEvents: 0,
      uniqueItems: 0,
      ratingCounts: { 1: 0, 2: 0, 3: 0, 4: 0 },
      actualRecall: null,
      meanPredictedRetrievability: null,
      retrievabilityExcluded: 0,
      studyDurationMs: 0,
      durationExcluded: 0,
    });
  });

  it("rejects corrupt non-null probabilities and durations", () => {
    expect(() =>
      calculateStatisticsSummary([
        {
          learningItemId: "one",
          rating: 3,
          retrievability: 1.2,
          durationMs: 1_000,
          ratedAtMs: 1_000,
        },
      ]),
    ).toThrow("STATISTICS_RETRIEVABILITY_INVALID");
    expect(() =>
      calculateStatisticsSummary([
        {
          learningItemId: "one",
          rating: 3,
          retrievability: 0.5,
          durationMs: -1,
          ratedAtMs: 1_000,
        },
      ]),
    ).toThrow("STATISTICS_DURATION_INVALID");
  });
});

describe("study-day grouping", () => {
  const cairo = { timeZone: "Africa/Cairo", boundaryMinutes: 240 };

  it("assigns Cairo 03:59 to the prior day and 04:00 to the current day", () => {
    expect(studyDayKey(Date.parse("2025-01-15T01:59:00Z"), cairo)).toBe(
      "2025-01-14",
    );
    expect(studyDayKey(Date.parse("2025-01-15T02:00:00Z"), cairo)).toBe(
      "2025-01-15",
    );
  });

  it("uses locale-independent ISO keys across a DST transition", () => {
    const newYork = {
      timeZone: "America/New_York",
      boundaryMinutes: 240,
    };
    expect(
      studyDayKey(Date.parse("2025-03-09T07:59:00Z"), newYork),
    ).toBe("2025-03-08");
    expect(
      studyDayKey(Date.parse("2025-03-09T08:00:00Z"), newYork),
    ).toBe("2025-03-09");
  });

  it("groups without losing events and keeps unique items per day", () => {
    const activity = groupDailyActivity(
      [
        {
          learningItemId: "one",
          rating: 1,
          retrievability: null,
          durationMs: 100,
          ratedAtMs: Date.parse("2025-01-15T01:59:00Z"),
        },
        {
          learningItemId: "one",
          rating: 3,
          retrievability: null,
          durationMs: 200,
          ratedAtMs: Date.parse("2025-01-15T02:00:00Z"),
        },
      ],
      cairo,
    );
    expect(activity).toEqual([
      {
        studyDay: "2025-01-14",
        reviewEvents: 1,
        uniqueItems: 1,
        durationMs: 100,
        durationExcluded: 0,
      },
      {
        studyDay: "2025-01-15",
        reviewEvents: 1,
        uniqueItems: 1,
        durationMs: 200,
        durationExcluded: 0,
      },
    ]);
  });

  it("builds a dense current-schedule forecast and counts overdue work today", () => {
    expect(
      groupCurrentDueForecast(
        [
          { learningItemId: "overdue", dueAtMs: Date.parse("2025-01-14T00:00Z") },
          { learningItemId: "tomorrow", dueAtMs: Date.parse("2025-01-16T05:00Z") },
          { learningItemId: "outside", dueAtMs: Date.parse("2025-02-20T00:00Z") },
        ],
        Date.parse("2025-01-15T10:00Z"),
        { timeZone: "UTC", boundaryMinutes: 0 },
        3,
      ),
    ).toEqual([
      { studyDay: "2025-01-15", count: 1 },
      { studyDay: "2025-01-16", count: 1 },
      { studyDay: "2025-01-17", count: 0 },
    ]);
  });
});
