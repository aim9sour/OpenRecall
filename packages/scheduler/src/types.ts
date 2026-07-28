import type { StudyDayConfig } from "@openrecall/domain";
import type { SchedulerSettings } from "@openrecall/contracts";

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

export type SchedulerSettingsV1 = SchedulerSettings;

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
