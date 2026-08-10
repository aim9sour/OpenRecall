import { Type, type Static } from "typebox";
import { EpochMillisecondsSchema, UuidSchema } from "./sections.js";
import { OptimizerRunInputSnapshotSchema } from "./optimizer-settings.js";

export const OptimizerScopeSchema = Type.Union([
  Type.Object(
    {
      scopeType: Type.Literal("global"),
      sectionId: Type.Null(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      scopeType: Type.Literal("section"),
      sectionId: UuidSchema,
    },
    { additionalProperties: false },
  ),
]);

export const OptimizerScopeQuerySchema = Type.Object(
  {
    scopeType: Type.Union([
      Type.Literal("global"),
      Type.Literal("section"),
    ]),
    sectionId: Type.Optional(UuidSchema),
  },
  { additionalProperties: false },
);

export const OptimizerRunStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("cancelled"),
  Type.Literal("failed"),
  Type.Literal("succeeded"),
]);

export const LegacyOptimizerRunInputSnapshotSchema = Type.Object(
  {
    kind: Type.Literal("legacy-official"),
    trainingConfig: Type.Object(
      {
        numEpochs: Type.Literal(5),
        batchSize: Type.Literal(512),
        seed: Type.Literal(2023),
        maxSeqLen: Type.Literal(256),
        learningRate: Type.Literal(0.04),
        gamma: Type.Literal(1),
      },
      { additionalProperties: false },
    ),
    settingsSource: Type.Null(),
    enableShortTerm: Type.Null(),
    numRelearningSteps: Type.Null(),
  },
  { additionalProperties: false },
);

export const OptimizerRunSnapshotSchema = Type.Union([
  OptimizerRunInputSnapshotSchema,
  LegacyOptimizerRunInputSnapshotSchema,
]);

export const OptimizerRunSchema = Type.Object(
  {
    id: UuidSchema,
    scopeType: Type.Union([
      Type.Literal("global"),
      Type.Literal("section"),
    ]),
    sectionId: Type.Union([UuidSchema, Type.Null()]),
    status: OptimizerRunStatusSchema,
    rawReviewCount: Type.Integer({ minimum: 0 }),
    eligibleExampleCount: Type.Integer({ minimum: 0 }),
    sourceReviewCutoffMs: Type.Union([
      EpochMillisecondsSchema,
      Type.Null(),
    ]),
    packageVersion: Type.String({ minLength: 1, maxLength: 100 }),
    algorithmVersion: Type.String({ minLength: 1, maxLength: 100 }),
    progress: Type.Number({ minimum: 0, maximum: 1 }),
    resultProfileId: Type.Union([UuidSchema, Type.Null()]),
    metricLogLoss: Type.Union([
      Type.Number({ minimum: 0 }),
      Type.Null(),
    ]),
    metricRmseBins: Type.Union([
      Type.Number({ minimum: 0 }),
      Type.Null(),
    ]),
    errorCode: Type.Union([
      Type.String({ minLength: 1, maxLength: 100 }),
      Type.Null(),
    ]),
    inputSnapshot: OptimizerRunSnapshotSchema,
    createdAtMs: EpochMillisecondsSchema,
    startedAtMs: Type.Union([
      EpochMillisecondsSchema,
      Type.Null(),
    ]),
    finishedAtMs: Type.Union([
      EpochMillisecondsSchema,
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

const OptimizerParameterSourceSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("official"),
      Type.Literal("global"),
      Type.Literal("section"),
    ]),
    profileId: Type.String({ minLength: 1, maxLength: 200 }),
    eligibleExampleCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const OptimizerEligibilitySchema = Type.Object(
  {
    scope: OptimizerScopeSchema,
    rawReviewCount: Type.Integer({ minimum: 0 }),
    eligibleExampleCount: Type.Integer({ minimum: 0 }),
    minimumEligibleExamples: Type.Integer({ minimum: 1 }),
    sourceReviewCutoffMs: Type.Union([
      EpochMillisecondsSchema,
      Type.Null(),
    ]),
    canTrain: Type.Boolean(),
    parameterSource: OptimizerParameterSourceSchema,
    activeRun: Type.Union([OptimizerRunSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const OptimizerProfileStatusSchema = Type.Union([
  Type.Literal("candidate"),
  Type.Literal("active"),
  Type.Literal("superseded"),
]);

export const OptimizerProfileSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 200 }),
    scopeType: Type.Union([
      Type.Literal("official"),
      Type.Literal("global"),
      Type.Literal("section"),
    ]),
    sectionId: Type.Union([UuidSchema, Type.Null()]),
    algorithmId: Type.String({ minLength: 1, maxLength: 100 }),
    algorithmVersion: Type.String({ minLength: 1, maxLength: 100 }),
    adapterVersion: Type.Integer({ minimum: 1 }),
    eligibleExampleCount: Type.Integer({ minimum: 0 }),
    reviewCutoffMs: Type.Union([
      EpochMillisecondsSchema,
      Type.Null(),
    ]),
    status: OptimizerProfileStatusSchema,
    createdAtMs: EpochMillisecondsSchema,
    packageVersion: Type.Union([
      Type.String({ minLength: 1, maxLength: 100 }),
      Type.Null(),
    ]),
    metricLogLoss: Type.Union([
      Type.Number({ minimum: 0 }),
      Type.Null(),
    ]),
    metricRmseBins: Type.Union([
      Type.Number({ minimum: 0 }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export const ProfileDueShiftSchema = Type.Object(
  {
    earlier: Type.Integer({ minimum: 0 }),
    later: Type.Integer({ minimum: 0 }),
    unchanged: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const ProfileWorkloadPointSchema = Type.Object(
  {
    dayOffset: Type.Integer({ minimum: 0, maximum: 29 }),
    count: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const OptimizerProfilePreviewSchema = Type.Object(
  {
    profile: OptimizerProfileSchema,
    previousProfile: OptimizerProfileSchema,
    affectedItemCount: Type.Integer({ minimum: 0 }),
    reviewCount: Type.Integer({ minimum: 0 }),
    sourceMatches: Type.Boolean(),
    revisionToken: Type.String({
      minLength: 64,
      maxLength: 64,
      pattern: "^[0-9a-f]{64}$",
    }),
    dueShift: ProfileDueShiftSchema,
    oldWorkload: Type.Array(ProfileWorkloadPointSchema, {
      minItems: 30,
      maxItems: 30,
    }),
    newWorkload: Type.Array(ProfileWorkloadPointSchema, {
      minItems: 30,
      maxItems: 30,
    }),
  },
  { additionalProperties: false },
);

export const OptimizerProfileApplySchema = Type.Object(
  {
    revisionToken: Type.String({
      minLength: 64,
      maxLength: 64,
      pattern: "^[0-9a-f]{64}$",
    }),
  },
  { additionalProperties: false },
);

export const OptimizerProfileApplicationSchema = Type.Object(
  {
    id: UuidSchema,
    profileId: Type.String({ minLength: 1, maxLength: 200 }),
    previousProfileId: Type.String({ minLength: 1, maxLength: 200 }),
    scopeType: Type.Union([
      Type.Literal("global"),
      Type.Literal("section"),
    ]),
    sectionId: Type.Union([UuidSchema, Type.Null()]),
    sourceReviewCutoffMs: Type.Union([
      EpochMillisecondsSchema,
      Type.Null(),
    ]),
    backupFilename: Type.String({ minLength: 1, maxLength: 120 }),
    appliedAtMs: EpochMillisecondsSchema,
    affectedItemCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const OptimizerProfileListSchema = Type.Array(
  OptimizerProfileSchema,
);

export type OptimizerScope = Static<typeof OptimizerScopeSchema>;
export type OptimizerScopeQuery = Static<
  typeof OptimizerScopeQuerySchema
>;
export type OptimizerRunStatus = Static<
  typeof OptimizerRunStatusSchema
>;
export type OptimizerRun = Static<typeof OptimizerRunSchema>;
export type OptimizerRunSnapshot = Static<typeof OptimizerRunSnapshotSchema>;
export type OptimizerEligibility = Static<
  typeof OptimizerEligibilitySchema
>;
export type OptimizerProfileStatus = Static<
  typeof OptimizerProfileStatusSchema
>;
export type OptimizerProfile = Static<typeof OptimizerProfileSchema>;
export type ProfileDueShift = Static<typeof ProfileDueShiftSchema>;
export type ProfileWorkloadPoint = Static<
  typeof ProfileWorkloadPointSchema
>;
export type OptimizerProfilePreview = Static<
  typeof OptimizerProfilePreviewSchema
>;
export type OptimizerProfileApply = Static<
  typeof OptimizerProfileApplySchema
>;
export type OptimizerProfileApplication = Static<
  typeof OptimizerProfileApplicationSchema
>;
