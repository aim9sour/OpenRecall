import type {
  StepRatingStatistics,
  StepRecommendationValues,
} from "@openrecall/contracts";
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
  readonly preFilterEligibleExampleCount: number;
  readonly eligibleExampleCount: number;
  readonly maxSequenceExcludedCount: number;
  readonly sourceReviewCutoffMs: number | null;
  readonly sourceReviewFingerprint: string;
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

export interface StoredStepReview {
  readonly reviewLogId: string;
  readonly learningItemId: string;
  readonly sectionId: string;
  readonly rating: number;
  readonly ratedAtMs: number;
  readonly reviewDurationMs: number | null;
  readonly priorStateJson: string;
}

export interface ValidatedStepReview {
  readonly reviewLogId: string;
  readonly cardId: string;
  readonly reviewTimeMs: number;
  readonly rating: Rating;
  readonly state: 0 | 1 | 2 | 3;
  readonly reviewDurationMs: number;
}

export interface PreparedStepRecommendationInput {
  readonly sourceFingerprint: string;
  readonly sourceReviewCutoffMs: number | null;
  readonly rawReviewCount: number;
  readonly validReviewCount: number;
  readonly validSequenceCount: number;
  readonly excludedSequenceCount: number;
  readonly exclusions: {
    readonly invalidCardId: number;
    readonly invalidTimestamp: number;
    readonly invalidRating: number;
    readonly invalidState: number;
    readonly missingDuration: number;
    readonly nonIncreasingOrder: number;
  };
  readonly validRows: readonly ValidatedStepReview[];
}

export interface ComputedStepRecommendation {
  readonly learning: StepRecommendationValues;
  readonly relearning: StepRecommendationValues;
  readonly statistics: {
    readonly again: StepRatingStatistics | null;
    readonly hard: StepRatingStatistics | null;
    readonly good: StepRatingStatistics | null;
    readonly againThenGood: StepRatingStatistics | null;
    readonly goodThenAgain: StepRatingStatistics | null;
    readonly relearning: StepRatingStatistics | null;
  };
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
