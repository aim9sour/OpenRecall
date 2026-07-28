import type { ReviewSessionStatus as DomainReviewSessionStatus } from "@openrecall/domain";
import type { MemoryState } from "@openrecall/scheduler";

export const OFFICIAL_PARAMETER_PROFILE_ID = "official-fsrs6-v1" as const;
export const SCHEDULER_ALGORITHM_ID = "FSRS-6" as const;
export const SCHEDULER_ALGORITHM_VERSION = "6.0" as const;
export const SCHEDULER_ADAPTER_VERSION = 1 as const;

export interface SchedulerStateRow {
  readonly learningItemId: string;
  readonly sectionId: string;
  readonly dueAtMs: number;
  readonly memoryState: MemoryState;
  readonly stepIndex: number | null;
  readonly stability: number;
  readonly difficulty: number;
  readonly elapsedDaysAtLastReview: number;
  readonly scheduledDays: number;
  readonly lastReviewAtMs: number | null;
  readonly repetitions: number;
  readonly lapses: number;
  readonly revision: number;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly adapterVersion: number;
  readonly parameterProfileId: string;
}

export type ReviewSessionStatus = DomainReviewSessionStatus;

export type QueueEntryStatus =
  | "queued"
  | "active"
  | "completed"
  | "removed";
