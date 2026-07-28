import { describe, expect, it } from "vitest";
import {
  applyRating,
  createInitialState,
  getRetrievability,
  previewRatings,
  upstreamDefaultWeightsForCompatibilityTest,
} from "./fsrs6-adapter.js";
import {
  DEFAULT_SCHEDULER_SETTINGS,
  FSRS6_MANIFEST,
} from "./manifest.js";
import {
  toUpstreamStepStrings,
  validateSchedulerSettings,
} from "./validate-settings.js";
import type {
  ScheduleContext,
  SchedulerSettingsV1,
} from "./types.js";

const nowMs = Date.parse("2026-07-28T10:00:00.000Z");

function defaultContext(
  overrides: Partial<ScheduleContext> = {},
): ScheduleContext {
  return {
    nowMs,
    studyDay: {
      timeZone: "UTC",
      boundaryMinutes: 0,
    },
    settings: DEFAULT_SCHEDULER_SETTINGS,
    weights: FSRS6_MANIFEST.defaultWeights,
    parameterProfileId: "official-defaults",
    ...overrides,
  };
}

describe("FSRS-6 manifest", () => {
  it("pins the algorithm, upstream package, schema, and official defaults", () => {
    expect(FSRS6_MANIFEST).toMatchObject({
      algorithm: "FSRS-6",
      upstreamPackage: "ts-fsrs@5.4.1",
      adapterSchemaVersion: 1,
    });
    expect(FSRS6_MANIFEST.defaultWeights).toHaveLength(21);
    expect(FSRS6_MANIFEST.defaultWeights).toEqual(
      upstreamDefaultWeightsForCompatibilityTest,
    );
    expect(DEFAULT_SCHEDULER_SETTINGS).toEqual({
      requestedRetention: 0.9,
      maximumIntervalDays: 36500,
      enableFuzz: false,
      enableShortTerm: true,
      learningStepsMinutes: [1, 10],
      relearningStepsMinutes: [10],
    });
  });
});

describe("scheduler settings validation", () => {
  const validSettings: SchedulerSettingsV1 = {
    requestedRetention: 0.9,
    maximumIntervalDays: 36500,
    enableFuzz: false,
    enableShortTerm: true,
    learningStepsMinutes: [1, 10],
    relearningStepsMinutes: [10],
  };

  it.each([Number.NaN, 0, 1.01])(
    "rejects requested retention %s",
    (requestedRetention) => {
      expect(() =>
        validateSchedulerSettings({
          ...validSettings,
          requestedRetention,
        }),
      ).toThrow(RangeError);
    },
  );

  it.each([0, 1.5, Number.NaN])(
    "rejects maximum interval %s",
    (maximumIntervalDays) => {
      expect(() =>
        validateSchedulerSettings({
          ...validSettings,
          maximumIntervalDays,
        }),
      ).toThrow(RangeError);
    },
  );

  it.each([
    { learningStepsMinutes: [0] },
    { learningStepsMinutes: [1, 1] },
    { learningStepsMinutes: [10, 1] },
    { learningStepsMinutes: [1440] },
    { learningStepsMinutes: [1.5] },
  ])("rejects invalid learning steps $learningStepsMinutes", ({
    learningStepsMinutes,
  }) => {
    expect(() =>
      validateSchedulerSettings({
        ...validSettings,
        learningStepsMinutes,
      }),
    ).toThrow(RangeError);
  });

  it("validates relearning steps with the same rules", () => {
    expect(() =>
      validateSchedulerSettings({
        ...validSettings,
        relearningStepsMinutes: [10, 10],
      }),
    ).toThrow(RangeError);
  });

  it("accepts an empty step list for pure FSRS scheduling", () => {
    expect(
      validateSchedulerSettings({
        ...validSettings,
        learningStepsMinutes: [],
        relearningStepsMinutes: [],
      }),
    ).toMatchObject({
      learningStepsMinutes: [],
      relearningStepsMinutes: [],
    });
  });

  it("converts only validated minute values to upstream units", () => {
    expect(toUpstreamStepStrings([1, 90, 120])).toEqual([
      "1m",
      "90m",
      "2h",
    ]);
    expect(() => toUpstreamStepStrings([0])).toThrow(RangeError);
  });
});

describe("FSRS-6 adapter", () => {
  it("creates a stable application-owned initial state", () => {
    expect(createInitialState(nowMs)).toEqual({
      schemaVersion: 1,
      dueAtMs: nowMs,
      memoryState: "new",
      stepIndex: null,
      stability: 0,
      difficulty: 0,
      elapsedDaysAtLastReview: 0,
      scheduledDays: 0,
      lastReviewAtMs: null,
      repetitions: 0,
      lapses: 0,
      revision: 0,
    });
  });

  it("matches the official initial-rating golden due offsets", () => {
    const initialState = createInitialState(nowMs);
    const outcomes = previewRatings(initialState, defaultContext());

    expect([
      outcomes[1].dueAtMs - nowMs,
      outcomes[2].dueAtMs - nowMs,
      outcomes[3].dueAtMs - nowMs,
      outcomes[4].dueAtMs - nowMs,
    ]).toEqual([
      60_000,
      6 * 60_000,
      10 * 60_000,
      8 * 86_400_000,
    ]);
    expect([
      outcomes[1].state.memoryState,
      outcomes[2].state.memoryState,
      outcomes[3].state.memoryState,
      outcomes[4].state.memoryState,
    ]).toEqual(["learning", "learning", "learning", "review"]);
    expect(Object.values(outcomes).every((outcome) => outcome.rating >= 1)).toBe(
      true,
    );
    expect(
      Object.values(outcomes).every(
        (outcome) => outcome.retrievabilityBefore === null,
      ),
    ).toBe(true);
    expect(initialState.revision).toBe(0);
    expect(Object.values(outcomes).map((outcome) => outcome.state.revision)).toEqual(
      [1, 1, 1, 1],
    );
    expect(
      applyRating(initialState, 3, defaultContext()).state.revision,
    ).toBe(1);
  });

  it("uses study-day boundaries when calculating retrievability", () => {
    const cairoStartMs = Date.parse("2026-07-27T22:30:00.000Z");
    const studyDay = {
      timeZone: "Africa/Cairo",
      boundaryMinutes: 240,
    };
    const firstReview = applyRating(
      createInitialState(cairoStartMs),
      4,
      defaultContext({ nowMs: cairoStartMs, studyDay }),
    );
    const boundaryMs = Date.parse("2026-07-28T01:00:00.000Z");

    expect(
      getRetrievability(
        firstReview.state,
        boundaryMs,
        defaultContext({ nowMs: boundaryMs, studyDay }),
      ),
    ).toBe(0.98292344);
  });

  it("matches the learning and graduation golden fixtures", () => {
    const learning = applyRating(
      createInitialState(nowMs),
      3,
      defaultContext(),
    );
    expect(learning).toEqual({
      rating: 3,
      dueAtMs: 1_785_233_400_000,
      retrievabilityBefore: null,
      state: {
        schemaVersion: 1,
        dueAtMs: 1_785_233_400_000,
        memoryState: "learning",
        stepIndex: 1,
        stability: 2.3065,
        difficulty: 2.11810397,
        elapsedDaysAtLastReview: 0,
        scheduledDays: 0,
        lastReviewAtMs: 1_785_232_800_000,
        repetitions: 1,
        lapses: 0,
        revision: 1,
      },
    });

    expect(
      applyRating(
        learning.state,
        3,
        defaultContext({ nowMs: learning.dueAtMs }),
      ),
    ).toEqual({
      rating: 3,
      dueAtMs: 1_785_406_200_000,
      retrievabilityBefore: 1,
      state: {
        schemaVersion: 1,
        dueAtMs: 1_785_406_200_000,
        memoryState: "review",
        stepIndex: null,
        stability: 2.3065,
        difficulty: 2.11121424,
        elapsedDaysAtLastReview: 0,
        scheduledDays: 2,
        lastReviewAtMs: 1_785_233_400_000,
        repetitions: 2,
        lapses: 0,
        revision: 2,
      },
    });
  });

  it("matches review and relearning golden fixtures", () => {
    const review = applyRating(
      createInitialState(nowMs),
      4,
      defaultContext(),
    );
    const atDue = defaultContext({ nowMs: review.dueAtMs });

    expect(applyRating(review.state, 3, atDue)).toEqual({
      rating: 3,
      dueAtMs: 1_789_293_600_000,
      retrievabilityBefore: 0.9024733,
      state: {
        schemaVersion: 1,
        dueAtMs: 1_789_293_600_000,
        memoryState: "review",
        stepIndex: null,
        stability: 38.90515015,
        difficulty: 1,
        elapsedDaysAtLastReview: 8,
        scheduledDays: 39,
        lastReviewAtMs: 1_785_924_000_000,
        repetitions: 2,
        lapses: 0,
        revision: 2,
      },
    });

    expect(applyRating(review.state, 1, atDue)).toEqual({
      rating: 1,
      dueAtMs: 1_785_924_600_000,
      retrievabilityBefore: 0.9024733,
      state: {
        schemaVersion: 1,
        dueAtMs: 1_785_924_600_000,
        memoryState: "relearning",
        stepIndex: 0,
        stability: 1.38863246,
        difficulty: 7.02698957,
        elapsedDaysAtLastReview: 8,
        scheduledDays: 0,
        lastReviewAtMs: 1_785_924_000_000,
        repetitions: 2,
        lapses: 1,
        revision: 2,
      },
    });
  });

  it("locks same-study-day and Cairo-boundary scheduling", () => {
    const review = applyRating(
      createInitialState(nowMs),
      4,
      defaultContext(),
    );
    expect(
      applyRating(
        review.state,
        3,
        defaultContext({ nowMs: nowMs + 2 * 60 * 60 * 1000 }),
      ),
    ).toMatchObject({
      dueAtMs: 1_786_017_600_000,
      retrievabilityBefore: 1,
      state: {
        stability: 8.2956,
        difficulty: 1,
        elapsedDaysAtLastReview: 0,
        scheduledDays: 9,
        revision: 2,
      },
    });

    const cairoStartMs = Date.parse("2026-07-27T22:30:00.000Z");
    const studyDay = {
      timeZone: "Africa/Cairo",
      boundaryMinutes: 240,
    };
    const cairoReview = applyRating(
      createInitialState(cairoStartMs),
      4,
      defaultContext({ nowMs: cairoStartMs, studyDay }),
    );
    expect(
      applyRating(
        cairoReview.state,
        3,
        defaultContext({
          nowMs: Date.parse("2026-07-28T01:00:00.000Z"),
          studyDay,
        }),
      ),
    ).toMatchObject({
      dueAtMs: 1_786_323_600_000,
      retrievabilityBefore: 0.98292344,
      state: {
        stability: 13.48506225,
        difficulty: 1,
        elapsedDaysAtLastReview: 1,
        scheduledDays: 13,
        lastReviewAtMs: 1_785_200_400_000,
        revision: 2,
      },
    });
  });

  it("matches the long-interval golden fixture", () => {
    expect(
      applyRating(
        {
          schemaVersion: 1,
          dueAtMs: nowMs,
          memoryState: "review",
          stepIndex: null,
          stability: 1000,
          difficulty: 5,
          elapsedDaysAtLastReview: 1000,
          scheduledDays: 1000,
          lastReviewAtMs: nowMs - 1000 * 86_400_000,
          repetitions: 20,
          lapses: 2,
          revision: 9,
        },
        3,
        defaultContext(),
      ),
    ).toEqual({
      rating: 3,
      dueAtMs: 1_960_020_000_000,
      retrievabilityBefore: 0.9,
      state: {
        schemaVersion: 1,
        dueAtMs: 1_960_020_000_000,
        memoryState: "review",
        stepIndex: null,
        stability: 2022.70414963,
        difficulty: 4.99022837,
        elapsedDaysAtLastReview: 1000,
        scheduledDays: 2023,
        lastReviewAtMs: nowMs,
        repetitions: 21,
        lapses: 2,
        revision: 10,
      },
    });
  });
});
