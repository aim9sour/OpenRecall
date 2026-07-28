import type { SchedulerSettings } from "@openrecall/contracts";
import type { StudyDayConfig } from "../time/types.js";

export type ReplayRating = 1 | 2 | 3 | 4;
export type ReplayMemoryState =
  | "new"
  | "learning"
  | "review"
  | "relearning";

export interface ReplaySchedulerState {
  readonly schemaVersion: 1;
  readonly dueAtMs: number;
  readonly memoryState: ReplayMemoryState;
  readonly stepIndex: number | null;
  readonly stability: number;
  readonly difficulty: number;
  readonly elapsedDaysAtLastReview: number;
  readonly scheduledDays: number;
  readonly lastReviewAtMs: number | null;
  readonly repetitions: number;
  readonly lapses: number;
  readonly revision: number;
}

export interface ReplayLog {
  readonly id: string;
  readonly rating: ReplayRating;
  readonly ratedAtMs: number;
  readonly timeZone: string;
  readonly boundaryMinutes: number;
  readonly settings: SchedulerSettings;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly adapterVersion: number;
}

export interface ReplayItemHistory {
  readonly learningItemId: string;
  readonly createdAtMs: number;
  readonly logs: readonly ReplayLog[];
}

export interface ReplayProfile {
  readonly id: string;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly adapterVersion: number;
  readonly weights: readonly number[];
}

export interface ReplayContext {
  readonly nowMs: number;
  readonly studyDay: StudyDayConfig;
  readonly settings: SchedulerSettings;
  readonly weights: readonly number[];
  readonly parameterProfileId: string;
}

export interface ReplayAdapter {
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly adapterVersion: number;
  createInitialState(createdAtMs: number): ReplaySchedulerState;
  applyRating(
    state: ReplaySchedulerState,
    rating: ReplayRating,
    context: ReplayContext,
  ): ReplaySchedulerState;
}

export class ReplayHistoryError extends Error {
  constructor(
    readonly code:
      | "REPLAY_PROFILE_INCOMPATIBLE"
      | "REPLAY_LOG_INCOMPATIBLE"
      | "REPLAY_HISTORY_CORRUPT",
  ) {
    super(code);
    this.name = "ReplayHistoryError";
  }
}

const utf8Encoder = new TextEncoder();

function isSafeEpoch(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function compareBinaryText(left: string, right: string): number {
  const leftBytes = utf8Encoder.encode(left);
  const rightBytes = utf8Encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function assertProfileCompatible(
  profile: ReplayProfile,
  adapter: ReplayAdapter,
): void {
  if (
    profile.id.length === 0 ||
    profile.algorithmId !== adapter.algorithmId ||
    profile.algorithmVersion !== adapter.algorithmVersion ||
    profile.adapterVersion !== adapter.adapterVersion ||
    profile.weights.length === 0 ||
    profile.weights.some((weight) => !Number.isFinite(weight))
  ) {
    throw new ReplayHistoryError("REPLAY_PROFILE_INCOMPATIBLE");
  }
}

function assertLogCompatible(log: ReplayLog, adapter: ReplayAdapter): void {
  if (
    log.algorithmId !== adapter.algorithmId ||
    log.algorithmVersion !== adapter.algorithmVersion ||
    log.adapterVersion !== adapter.adapterVersion
  ) {
    throw new ReplayHistoryError("REPLAY_LOG_INCOMPATIBLE");
  }

  if (
    log.id.length === 0 ||
    !([1, 2, 3, 4] as const).includes(log.rating) ||
    !isSafeEpoch(log.ratedAtMs) ||
    log.timeZone.length === 0 ||
    !Number.isInteger(log.boundaryMinutes) ||
    log.boundaryMinutes < 0 ||
    log.boundaryMinutes > 1_439 ||
    typeof log.settings !== "object" ||
    log.settings === null
  ) {
    throw new ReplayHistoryError("REPLAY_HISTORY_CORRUPT");
  }
}

function assertState(state: ReplaySchedulerState, revision: number): void {
  const finiteValues = [
    state.dueAtMs,
    state.stability,
    state.difficulty,
    state.elapsedDaysAtLastReview,
    state.scheduledDays,
    state.repetitions,
    state.lapses,
    state.revision,
  ];

  if (
    state.schemaVersion !== 1 ||
    !isSafeEpoch(state.dueAtMs) ||
    (state.lastReviewAtMs !== null &&
      !isSafeEpoch(state.lastReviewAtMs)) ||
    !["new", "learning", "review", "relearning"].includes(
      state.memoryState,
    ) ||
    (state.stepIndex !== null &&
      (!Number.isInteger(state.stepIndex) || state.stepIndex < 0)) ||
    finiteValues.some((value) => !Number.isFinite(value)) ||
    !Number.isInteger(state.repetitions) ||
    state.repetitions < 0 ||
    !Number.isInteger(state.lapses) ||
    state.lapses < 0 ||
    !Number.isInteger(state.revision) ||
    state.revision < 0 ||
    state.revision !== revision
  ) {
    throw new ReplayHistoryError("REPLAY_HISTORY_CORRUPT");
  }
}

export function replayHistory(
  history: ReplayItemHistory,
  profile: ReplayProfile,
  adapter: ReplayAdapter,
): ReplaySchedulerState {
  assertProfileCompatible(profile, adapter);
  if (
    history.learningItemId.length === 0 ||
    !isSafeEpoch(history.createdAtMs)
  ) {
    throw new ReplayHistoryError("REPLAY_HISTORY_CORRUPT");
  }

  const logs = [...history.logs].sort(
    (left, right) =>
      left.ratedAtMs - right.ratedAtMs ||
      compareBinaryText(left.id, right.id),
  );
  let state = adapter.createInitialState(history.createdAtMs);
  assertState(state, 0);

  for (const [index, log] of logs.entries()) {
    assertLogCompatible(log, adapter);
    state = adapter.applyRating(state, log.rating, {
      nowMs: log.ratedAtMs,
      studyDay: {
        timeZone: log.timeZone,
        boundaryMinutes: log.boundaryMinutes,
      },
      settings: structuredClone(log.settings),
      weights: [...profile.weights],
      parameterProfileId: profile.id,
    });
    assertState(state, index + 1);
  }

  return structuredClone(state);
}
