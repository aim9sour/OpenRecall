import { Type, type Static } from "typebox";
import { EpochMillisecondsSchema, UuidSchema } from "./sections.js";

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

export type OptimizerScope = Static<typeof OptimizerScopeSchema>;
export type OptimizerScopeQuery = Static<
  typeof OptimizerScopeQuerySchema
>;
export type OptimizerRunStatus = Static<
  typeof OptimizerRunStatusSchema
>;
export type OptimizerRun = Static<typeof OptimizerRunSchema>;
export type OptimizerEligibility = Static<
  typeof OptimizerEligibilitySchema
>;
