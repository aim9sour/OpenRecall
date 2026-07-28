import type { Rating } from "@openrecall/scheduler";

export interface OptimizerReview {
  readonly rating: Rating;
  readonly deltaDays: number;
}

export interface OptimizerExample {
  readonly learningItemId: string;
  readonly targetReviewLogId: string;
  readonly reviews: readonly OptimizerReview[];
}

export interface TrainingSetSummary {
  readonly rawReviewCount: number;
  readonly eligibleExampleCount: number;
  readonly sourceReviewCutoffMs: number | null;
  readonly examples: readonly OptimizerExample[];
}

export interface StoredOptimizerReview {
  readonly reviewLogId: string;
  readonly learningItemId: string;
  readonly sectionId: string;
  readonly rating: Rating;
  readonly deltaDays: number;
  readonly ratedAtMs: number;
}

export type OptimizerScope =
  | {
      readonly scopeType: "global";
      readonly sectionId: null;
    }
  | {
      readonly scopeType: "section";
      readonly sectionId: string;
    };
