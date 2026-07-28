import type { StudyDayConfig } from "../time/types.js";

export type StatisticsRating = 1 | 2 | 3 | 4;

export interface StatisticsEvent {
  readonly learningItemId: string;
  readonly rating: StatisticsRating;
  readonly retrievability: number | null;
  readonly durationMs: number | null;
  readonly ratedAtMs: number;
}

export interface StatisticsSummary {
  readonly reviewEvents: number;
  readonly uniqueItems: number;
  readonly ratingCounts: Record<StatisticsRating, number>;
  readonly actualRecall: number | null;
  readonly meanPredictedRetrievability: number | null;
  readonly retrievabilityExcluded: number;
  readonly studyDurationMs: number;
  readonly durationExcluded: number;
}

export interface DailyActivityPoint {
  readonly studyDay: string;
  readonly reviewEvents: number;
  readonly uniqueItems: number;
  readonly durationMs: number;
  readonly durationExcluded: number;
}

export interface CurrentDueState {
  readonly learningItemId: string;
  readonly dueAtMs: number;
}

export interface WorkloadForecastPoint {
  readonly studyDay: string;
  readonly count: number;
}

export interface StudyDayGroupingConfig extends StudyDayConfig {}
