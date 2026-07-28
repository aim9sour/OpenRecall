import { Type, type Static } from "typebox";
import {
  CardLifecycleSchema,
} from "./cards.js";
import {
  EpochMillisecondsSchema,
  UuidSchema,
} from "./sections.js";

export const StudyDaySchema = Type.String({
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
});
export const ProbabilitySchema = Type.Union([
  Type.Number({ minimum: 0, maximum: 1 }),
  Type.Null(),
]);
export const StatisticsRatingSchema = Type.Union([
  Type.Literal(1),
  Type.Literal(2),
  Type.Literal(3),
  Type.Literal(4),
]);
export const RatingCountsSchema = Type.Object(
  {
    1: Type.Integer({ minimum: 0 }),
    2: Type.Integer({ minimum: 0 }),
    3: Type.Integer({ minimum: 0 }),
    4: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export const StatisticsSummarySchema = Type.Object(
  {
    reviewEvents: Type.Integer({ minimum: 0 }),
    uniqueItems: Type.Integer({ minimum: 0 }),
    ratingCounts: RatingCountsSchema,
    actualRecall: ProbabilitySchema,
    meanPredictedRetrievability: ProbabilitySchema,
    retrievabilityExcluded: Type.Integer({ minimum: 0 }),
    studyDurationMs: Type.Integer({ minimum: 0 }),
    durationExcluded: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export const MetricEntrySchema = Type.Object(
  {
    labelKey: Type.String({ minLength: 1, maxLength: 200 }),
    value: Type.Union([Type.Number(), Type.Null()]),
  },
  { additionalProperties: false },
);
export const DailyActivityPointSchema = Type.Object(
  {
    studyDay: StudyDaySchema,
    reviewEvents: Type.Integer({ minimum: 0 }),
    uniqueItems: Type.Integer({ minimum: 0 }),
    durationMs: Type.Integer({ minimum: 0 }),
    durationExcluded: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export const WorkloadForecastPointSchema = Type.Object(
  {
    studyDay: StudyDaySchema,
    count: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export const StatisticsStateCountsSchema = Type.Object(
  {
    total: Type.Integer({ minimum: 0 }),
    dueNow: Type.Integer({ minimum: 0 }),
    new: Type.Integer({ minimum: 0 }),
    learning: Type.Integer({ minimum: 0 }),
    review: Type.Integer({ minimum: 0 }),
    relearning: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export const SectionProgressStatisticsSchema = Type.Object(
  {
    sectionId: UuidSchema,
    name: Type.String({ minLength: 1, maxLength: 200 }),
    total: Type.Integer({ minimum: 0 }),
    dueNow: Type.Integer({ minimum: 0 }),
    new: Type.Integer({ minimum: 0 }),
    learning: Type.Integer({ minimum: 0 }),
    review: Type.Integer({ minimum: 0 }),
    relearning: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export const StudyStatisticsSchema = Type.Object(
  {
    summary: StatisticsSummarySchema,
    metrics: Type.Array(MetricEntrySchema),
    dailyActivity: Type.Array(DailyActivityPointSchema),
    workloadForecast: Type.Array(WorkloadForecastPointSchema, {
      maxItems: 30,
    }),
    stateCounts: StatisticsStateCountsSchema,
    sections: Type.Array(SectionProgressStatisticsSchema),
  },
  { additionalProperties: false },
);
export const StatisticsQuerySchema = Type.Object(
  {
    fromStudyDay: Type.Optional(StudyDaySchema),
    toStudyDay: Type.Optional(StudyDaySchema),
  },
  { additionalProperties: false },
);

export const CardStatisticsQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);
export const CardHistoryItemSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 200 }),
    presentationId: Type.String({ minLength: 1, maxLength: 200 }),
    frontSnapshot: Type.String({ maxLength: 20_000 }),
    backSnapshot: Type.String({ maxLength: 20_000 }),
    notesSnapshot: Type.Union([
      Type.String({ maxLength: 20_000 }),
      Type.Null(),
    ]),
    rating: StatisticsRatingSchema,
    shownAtMs: EpochMillisecondsSchema,
    revealedAtMs: EpochMillisecondsSchema,
    ratedAtMs: EpochMillisecondsSchema,
    durationMs: Type.Union([
      Type.Integer({ minimum: 0 }),
      Type.Null(),
    ]),
    retrievabilityBefore: ProbabilitySchema,
    resultingDueAtMs: EpochMillisecondsSchema,
  },
  { additionalProperties: false },
);
export const CardStatisticsSchema = Type.Object(
  {
    itemId: UuidSchema,
    sectionId: UuidSchema,
    lifecycle: CardLifecycleSchema,
    currentState: Type.Union([
      Type.Object(
        {
          dueAtMs: EpochMillisecondsSchema,
          memoryState: Type.Union([
            Type.Literal("new"),
            Type.Literal("learning"),
            Type.Literal("review"),
            Type.Literal("relearning"),
          ]),
          stepIndex: Type.Union([
            Type.Integer({ minimum: 0 }),
            Type.Null(),
          ]),
          stability: Type.Number({ minimum: 0 }),
          difficulty: Type.Number({ minimum: 0 }),
          repetitions: Type.Integer({ minimum: 0 }),
          lapses: Type.Integer({ minimum: 0 }),
          revision: Type.Integer({ minimum: 0 }),
          retrievability: ProbabilitySchema,
          algorithmId: Type.String({ minLength: 1 }),
          algorithmVersion: Type.String({ minLength: 1 }),
          adapterVersion: Type.Integer({ minimum: 1 }),
          parameterProfileId: Type.String({ minLength: 1 }),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    lastReview: Type.Union([
      Type.Object(
        {
          rating: StatisticsRatingSchema,
          ratedAtMs: EpochMillisecondsSchema,
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    presentations: Type.Array(
      Type.Object(
        {
          presentationId: Type.String({ minLength: 1, maxLength: 200 }),
          lifecycle: Type.Union([
            Type.Literal("active"),
            Type.Literal("retired"),
          ]),
          showCount: Type.Integer({ minimum: 0 }),
          firstShownAtMs: Type.Union([
            EpochMillisecondsSchema,
            Type.Null(),
          ]),
          lastShownAtMs: Type.Union([
            EpochMillisecondsSchema,
            Type.Null(),
          ]),
        },
        { additionalProperties: false },
      ),
    ),
    history: Type.Object(
      {
        items: Type.Array(CardHistoryItemSchema, { maxItems: 100 }),
        nextCursor: Type.Union([
          Type.String({ minLength: 1, maxLength: 500 }),
          Type.Null(),
        ]),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type StudyDay = Static<typeof StudyDaySchema>;
export type StatisticsSummary = Static<typeof StatisticsSummarySchema>;
export type MetricEntry = Static<typeof MetricEntrySchema>;
export type StudyStatistics = Static<typeof StudyStatisticsSchema>;
export type StatisticsQuery = Static<typeof StatisticsQuerySchema>;
export type CardStatisticsQuery = Static<typeof CardStatisticsQuerySchema>;
export type CardStatistics = Static<typeof CardStatisticsSchema>;
