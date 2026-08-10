import { Type, type Static } from "typebox";
import { OptimizerScopeSchema } from "./optimizer.js";
import { EpochMillisecondsSchema, UuidSchema } from "./sections.js";
import { SchedulerSettingsSchema, SchedulerStepsSchema } from "./settings.js";

const Sha256Schema = Type.String({ pattern: "^[0-9a-f]{64}$" });
export const StepRecommendationPartSchema = Type.Union([
  Type.Literal("learning"),
  Type.Literal("relearning"),
]);
export const StepRecommendationPartsSchema = Type.Array(
  StepRecommendationPartSchema,
  { minItems: 1, maxItems: 2, uniqueItems: true },
);
export const StepRecommendationRunStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("cancelled"),
  Type.Literal("failed"),
  Type.Literal("succeeded"),
]);

export const StepRatingStatisticsSchema = Type.Object({
  count: Type.Integer({ minimum: 0 }),
  delayQ1Seconds: Type.Number({ minimum: 0 }),
  delayQ2Seconds: Type.Number({ minimum: 0 }),
  delayQ3Seconds: Type.Number({ minimum: 0 }),
  retentionQ1: Type.Number({ minimum: 0, maximum: 1 }),
  retentionQ2: Type.Number({ minimum: 0, maximum: 1 }),
  retentionQ3: Type.Number({ minimum: 0, maximum: 1 }),
  retentionQ4: Type.Number({ minimum: 0, maximum: 1 }),
  retention: Type.Number({ minimum: 0, maximum: 1 }),
  stabilitySeconds: Type.Number({ minimum: 0 }),
}, { additionalProperties: false });

export const StepRecommendationValuesSchema = Type.Object({
  rawSeconds: Type.Array(Type.Number({ minimum: 0 }), { maxItems: 2 }),
  applicableMinutes: SchedulerStepsSchema,
  belowResolutionSeconds: Type.Array(Type.Number({ minimum: 0, maximum: 59.999999 }), { maxItems: 2 }),
}, { additionalProperties: false });

export const StepExclusionCountsSchema = Type.Object({
  invalidCardId: Type.Integer({ minimum: 0 }),
  invalidTimestamp: Type.Integer({ minimum: 0 }),
  invalidRating: Type.Integer({ minimum: 0 }),
  invalidState: Type.Integer({ minimum: 0 }),
  missingDuration: Type.Integer({ minimum: 0 }),
  nonIncreasingOrder: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

const NullableStats = Type.Union([StepRatingStatisticsSchema, Type.Null()]);
export const StepRecommendationResultSchema = Type.Object({
  learning: StepRecommendationValuesSchema,
  relearning: StepRecommendationValuesSchema,
  statistics: Type.Object({
    again: NullableStats,
    hard: NullableStats,
    good: NullableStats,
    againThenGood: NullableStats,
    goodThenAgain: NullableStats,
    relearning: NullableStats,
  }, { additionalProperties: false }),
  rawReviewCount: Type.Integer({ minimum: 0 }),
  validReviewCount: Type.Integer({ minimum: 0 }),
  validSequenceCount: Type.Integer({ minimum: 0 }),
  excludedSequenceCount: Type.Integer({ minimum: 0 }),
  exclusions: StepExclusionCountsSchema,
}, { additionalProperties: false });

export const StepRecommendationInputSnapshotSchema = Type.Object({
  schedulerSettings: SchedulerSettingsSchema,
  weights: Type.Array(Type.Number(), { minItems: 21, maxItems: 21 }),
  parameterProfileId: Type.String({ minLength: 1, maxLength: 200 }),
  selectedScopeRevisionMs: Type.Union([EpochMillisecondsSchema, Type.Null()]),
  effectiveSettingsSource: Type.Object({
    kind: Type.Union([Type.Literal("adapter-default"), Type.Literal("global"), Type.Literal("section")]),
    settingsId: Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
    updatedAtMs: Type.Union([EpochMillisecondsSchema, Type.Null()]),
  }, { additionalProperties: false }),
  packageVersion: Type.Literal("0.5.0"),
  algorithmVersion: Type.Literal("6.0"),
  adapterVersion: Type.Integer({ minimum: 1 }),
  schemaVersion: Type.Literal(1),
  rawReviewCount: Type.Integer({ minimum: 0 }),
  validReviewCount: Type.Integer({ minimum: 0 }),
  validSequenceCount: Type.Integer({ minimum: 0 }),
  excludedSequenceCount: Type.Integer({ minimum: 0 }),
  exclusions: StepExclusionCountsSchema,
  sourceReviewCutoffMs: Type.Union([EpochMillisecondsSchema, Type.Null()]),
  sourceFingerprint: Sha256Schema,
}, { additionalProperties: false });

export const StepApplicationStepsSchema = Type.Object({
  learning: SchedulerStepsSchema,
  relearning: SchedulerStepsSchema,
}, { additionalProperties: false });

export const StepRecommendationRunSchema = Type.Object({
  id: UuidSchema,
  scope: OptimizerScopeSchema,
  status: StepRecommendationRunStatusSchema,
  sourceReviewCutoffMs: Type.Union([EpochMillisecondsSchema, Type.Null()]),
  sourceFingerprint: Sha256Schema,
  revisionToken: Sha256Schema,
  inputSnapshot: StepRecommendationInputSnapshotSchema,
  result: Type.Union([StepRecommendationResultSchema, Type.Null()]),
  errorCode: Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()]),
  appliedParts: Type.Union([StepRecommendationPartsSchema, Type.Null()]),
  priorSteps: Type.Union([StepApplicationStepsSchema, Type.Null()]),
  appliedSteps: Type.Union([StepApplicationStepsSchema, Type.Null()]),
  appliedAtMs: Type.Union([EpochMillisecondsSchema, Type.Null()]),
  restoredAtMs: Type.Union([EpochMillisecondsSchema, Type.Null()]),
  createdAtMs: EpochMillisecondsSchema,
  startedAtMs: Type.Union([EpochMillisecondsSchema, Type.Null()]),
  finishedAtMs: Type.Union([EpochMillisecondsSchema, Type.Null()]),
}, { additionalProperties: false });

export const StepRecommendationStartSchema = Type.Object({
  scope: OptimizerScopeSchema,
}, { additionalProperties: false });
export const StepRecommendationApplySchema = Type.Object({
  parts: StepRecommendationPartsSchema,
  revisionToken: Sha256Schema,
}, { additionalProperties: false });
export const StepRecommendationRestoreSchema = Type.Object({
  revisionToken: Sha256Schema,
}, { additionalProperties: false });

export type StepRecommendationPart = Static<typeof StepRecommendationPartSchema>;
export type StepRatingStatistics = Static<typeof StepRatingStatisticsSchema>;
export type StepRecommendationValues = Static<typeof StepRecommendationValuesSchema>;
export type StepExclusionCounts = Static<typeof StepExclusionCountsSchema>;
export type StepRecommendationResult = Static<typeof StepRecommendationResultSchema>;
export type StepRecommendationInputSnapshot = Static<typeof StepRecommendationInputSnapshotSchema>;
export type StepApplicationSteps = Static<typeof StepApplicationStepsSchema>;
export type StepRecommendationRun = Static<typeof StepRecommendationRunSchema>;
export type StepRecommendationStart = Static<typeof StepRecommendationStartSchema>;
export type StepRecommendationApply = Static<typeof StepRecommendationApplySchema>;
export type StepRecommendationRestore = Static<typeof StepRecommendationRestoreSchema>;
