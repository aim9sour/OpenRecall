import type { SchedulerSettings } from "@openrecall/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  replayHistory,
  type ReplayAdapter,
  type ReplayItemHistory,
  type ReplayProfile,
  type ReplaySchedulerState,
} from "./replay-history.js";

const settings: SchedulerSettings = {
  requestedRetention: 0.9,
  maximumIntervalDays: 100,
  enableFuzz: false,
  enableShortTerm: true,
  learningStepsMinutes: [1, 10],
  relearningStepsMinutes: [10],
};
const profile: ReplayProfile = {
  id: "profile-1",
  algorithmId: "FSRS-6",
  algorithmVersion: "6.0",
  adapterVersion: 1,
  weights: [1, 2, 3],
};

function initial(createdAtMs: number): ReplaySchedulerState {
  return {
    schemaVersion: 1,
    dueAtMs: createdAtMs,
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
  };
}

function adapter(
  apply = vi.fn(
    (
      state: ReplaySchedulerState,
      rating: 1 | 2 | 3 | 4,
      context: Parameters<ReplayAdapter["applyRating"]>[2],
    ): ReplaySchedulerState => ({
      ...state,
      dueAtMs:
        context.nowMs +
        context.settings.maximumIntervalDays +
        context.studyDay.boundaryMinutes,
      memoryState: "review",
      stability: context.weights[0] ?? 0,
      difficulty: rating,
      lastReviewAtMs: context.nowMs,
      repetitions: state.repetitions + 1,
      revision: state.revision + 1,
    }),
  ),
): ReplayAdapter {
  return {
    algorithmId: "FSRS-6",
    algorithmVersion: "6.0",
    adapterVersion: 1,
    createInitialState: initial,
    applyRating: (state, rating, context) => apply(state, rating, context),
  };
}

function history(): ReplayItemHistory {
  return {
    learningItemId: "item-1",
    createdAtMs: 100,
    logs: [
      {
        id: "log-b",
        rating: 4,
        ratedAtMs: 200,
        timeZone: "UTC",
        boundaryMinutes: 10,
        settings: { ...settings, maximumIntervalDays: 200 },
        algorithmId: "FSRS-6",
        algorithmVersion: "6.0",
        adapterVersion: 1,
      },
      {
        id: "log-a",
        rating: 2,
        ratedAtMs: 200,
        timeZone: "Africa/Cairo",
        boundaryMinutes: 20,
        settings: { ...settings, maximumIntervalDays: 300 },
        algorithmId: "FSRS-6",
        algorithmVersion: "6.0",
        adapterVersion: 1,
      },
    ],
  };
}

describe("replayHistory", () => {
  it("matches deterministic original-profile replay in timestamp and log-ID order", () => {
    const replayAdapter = adapter();
    const result = replayHistory(history(), profile, replayAdapter);

    expect(result).toEqual({
      ...initial(100),
      dueAtMs: 200 + 200 + 10,
      memoryState: "review",
      stability: 1,
      difficulty: 4,
      lastReviewAtMs: 200,
      repetitions: 2,
      revision: 2,
    });
  });

  it("uses every log's captured settings and study-day configuration", () => {
    const apply = vi.fn(
      (
        state: ReplaySchedulerState,
        _rating: 1 | 2 | 3 | 4,
        context: Parameters<ReplayAdapter["applyRating"]>[2],
      ) => ({
        ...state,
        revision: state.revision + 1,
      }),
    );
    replayHistory(history(), profile, adapter(apply));

    expect(
      apply.mock.calls.map(([, , context]) => ({
        nowMs: context.nowMs,
        timeZone: context.studyDay.timeZone,
        boundaryMinutes: context.studyDay.boundaryMinutes,
        maximumIntervalDays: context.settings.maximumIntervalDays,
      })),
    ).toEqual([
      {
        nowMs: 200,
        timeZone: "Africa/Cairo",
        boundaryMinutes: 20,
        maximumIntervalDays: 300,
      },
      {
        nowMs: 200,
        timeZone: "UTC",
        boundaryMinutes: 10,
        maximumIntervalDays: 200,
      },
    ]);
  });

  it("initializes a new card with the target profile without fabricating reviews", () => {
    const replayAdapter = adapter();
    const result = replayHistory(
      { learningItemId: "new-item", createdAtMs: 500, logs: [] },
      profile,
      replayAdapter,
    );

    expect(result).toEqual(initial(500));
  });

  it("rejects corrupt, missing, and incompatible adapter versions safely", () => {
    for (const broken of [
      { ...profile, adapterVersion: 2 },
      {
        ...profile,
        algorithmVersion: "7.0",
      },
    ]) {
      expect(() => replayHistory(history(), broken, adapter())).toThrow(
        "REPLAY_PROFILE_INCOMPATIBLE",
      );
    }
    const original = history();
    const missingVersion: ReplayItemHistory = {
      ...original,
      logs: [
        {
          ...original.logs[0]!,
          adapterVersion: undefined as never,
        },
        ...original.logs.slice(1),
      ],
    };
    expect(() =>
      replayHistory(missingVersion, profile, adapter()),
    ).toThrow("REPLAY_LOG_INCOMPATIBLE");
  });
});
