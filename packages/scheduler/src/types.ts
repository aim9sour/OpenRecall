import type { StudyDayConfig } from "@openrecall/domain";

export type Rating = 1 | 2 | 3 | 4;

export type MemoryState = "new" | "learning" | "review" | "relearning";

export interface SchedulerStateV1 {
  schemaVersion: 1;
  dueAtMs: number;
  memoryState: MemoryState;
  stepIndex: number | null;
  stability: number;
  difficulty: number;
  elapsedDaysAtLastReview: number;
  scheduledDays: number;
  lastReviewAtMs: number | null;
  repetitions: number;
  lapses: number;
  revision: number;
}

export interface SchedulerSettingsV1 {
  requestedRetention: number;
  maximumIntervalDays: number;
  enableFuzz: boolean;
  enableShortTerm: boolean;
  learningStepsMinutes: number[];
  relearningStepsMinutes: number[];
}

export interface ScheduleContext {
  nowMs: number;
  studyDay: StudyDayConfig;
  settings: SchedulerSettingsV1;
  weights: readonly number[];
  parameterProfileId: string;
}

export interface RatingOutcome {
  rating: Rating;
  state: SchedulerStateV1;
  dueAtMs: number;
  retrievabilityBefore: number | null;
}
