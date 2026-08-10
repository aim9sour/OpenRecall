import { Type, type Static } from "typebox";
import { EpochMillisecondsSchema, UuidSchema } from "./sections.js";

const OptimizerSettingsScopeTargetSchema = Type.Union([
  Type.Object({ scopeType: Type.Literal("global"), sectionId: Type.Null() }, { additionalProperties: false }),
  Type.Object({ scopeType: Type.Literal("section"), sectionId: UuidSchema }, { additionalProperties: false }),
]);

const NumEpochsSchema = Type.Union([
  Type.Literal(3), Type.Literal(5), Type.Literal(7), Type.Literal(10),
]);
const BatchSizeSchema = Type.Union([
  Type.Literal(128), Type.Literal(256), Type.Literal(512), Type.Literal(1024),
]);
const MaxSeqLenSchema = Type.Union([
  Type.Literal(64), Type.Literal(128), Type.Literal(256), Type.Literal(512),
]);

export const OptimizerTrainingSettingsSchema = Type.Object(
  {
    numEpochs: NumEpochsSchema,
    batchSize: BatchSizeSchema,
    maxSeqLen: MaxSeqLenSchema,
  },
  { additionalProperties: false },
);

export const OptimizerTrainingConfigSchema = Type.Object(
  {
    numEpochs: NumEpochsSchema,
    batchSize: BatchSizeSchema,
    seed: Type.Literal(2023),
    maxSeqLen: MaxSeqLenSchema,
    learningRate: Type.Literal(0.04),
    gamma: Type.Literal(1),
  },
  { additionalProperties: false },
);

export const OptimizerTrainingControlSchema = Type.Object(
  {
    key: Type.Union([
      Type.Literal("numEpochs"),
      Type.Literal("batchSize"),
      Type.Literal("maxSeqLen"),
    ]),
    labelKey: Type.String({ minLength: 1, maxLength: 200 }),
    descriptionKey: Type.String({ minLength: 1, maxLength: 200 }),
    choices: Type.Array(Type.Integer(), { minItems: 1, uniqueItems: true }),
    defaultValue: Type.Integer(),
    deprecated: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const OptimizerCapabilitySchema = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 100 }),
    classification: Type.Union([
      Type.Literal("managed"),
      Type.Literal("derived"),
      Type.Literal("tool"),
      Type.Literal("internal"),
    ]),
  },
  { additionalProperties: false },
);

export const OptimizerTrainingManifestSchema = Type.Object(
  {
    upstreamPackage: Type.Literal("@open-spaced-repetition/binding"),
    upstreamVersion: Type.Literal("0.5.0"),
    fsrsCoreVersion: Type.Literal("FSRS-6"),
    algorithmVersion: Type.Literal("6.0"),
    adapterVersion: Type.Literal(2),
    schemaVersion: Type.Literal(1),
    controls: Type.Array(OptimizerTrainingControlSchema, { minItems: 3, maxItems: 3 }),
    readOnly: Type.Object(
      {
        seed: Type.Literal(2023),
        learningRate: Type.Literal(0.04),
        gamma: Type.Literal(1),
      },
      { additionalProperties: false },
    ),
    capabilities: Type.Array(OptimizerCapabilitySchema),
  },
  { additionalProperties: false },
);

export const OptimizerSettingsSourceSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Union([Type.Literal("global"), Type.Literal("section")]),
      settingsId: Type.String({ minLength: 1, maxLength: 200 }),
      updatedAtMs: EpochMillisecondsSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("adapter-default"),
      settingsId: Type.Null(),
      updatedAtMs: Type.Null(),
    },
    { additionalProperties: false },
  ),
]);

export const OptimizerTrainingSettingsScopeSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 200 }),
    scopeType: Type.Union([Type.Literal("global"), Type.Literal("section")]),
    sectionId: Type.Union([UuidSchema, Type.Null()]),
    adapterVersion: Type.Integer({ minimum: 1 }),
    settings: OptimizerTrainingSettingsSchema,
    createdAtMs: EpochMillisecondsSchema,
    updatedAtMs: EpochMillisecondsSchema,
  },
  { additionalProperties: false },
);

export const OptimizerSettingsMutationSchema = Type.Object(
  {
    expectedUpdatedAtMs: Type.Optional(EpochMillisecondsSchema),
    settings: OptimizerTrainingSettingsSchema,
  },
  { additionalProperties: false },
);

export const OptimizerSettingsResetSchema = Type.Object(
  { expectedUpdatedAtMs: EpochMillisecondsSchema },
  { additionalProperties: false },
);

export const OptimizerSettingsViewSchema = Type.Object(
  {
    manifest: OptimizerTrainingManifestSchema,
    defaults: OptimizerTrainingSettingsSchema,
    selectedScope: OptimizerSettingsScopeTargetSchema,
    savedOverride: Type.Union([OptimizerTrainingSettingsScopeSchema, Type.Null()]),
    effective: Type.Object(
      {
        settings: OptimizerTrainingSettingsSchema,
        source: OptimizerSettingsSourceSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const OptimizerTrainingPreflightRequestSchema = Type.Object(
  {
    scope: OptimizerSettingsScopeTargetSchema,
    settings: OptimizerTrainingSettingsSchema,
  },
  { additionalProperties: false },
);

export const OptimizerTrainingPreflightSchema = Type.Object(
  {
    rawReviewCount: Type.Integer({ minimum: 0 }),
    otherwiseEligibleExampleCount: Type.Integer({ minimum: 0 }),
    excludedByMaxSeqLenCount: Type.Integer({ minimum: 0 }),
    eligibleExampleCount: Type.Integer({ minimum: 0 }),
    minimumEligibleExamples: Type.Integer({ minimum: 1 }),
    sourceReviewCutoffMs: Type.Union([EpochMillisecondsSchema, Type.Null()]),
    canTrain: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const OptimizerRunInputSnapshotSchema = Type.Object(
  {
    kind: Type.Literal("current"),
    trainingConfig: OptimizerTrainingConfigSchema,
    enableShortTerm: Type.Boolean(),
    numRelearningSteps: Type.Integer({ minimum: 0, maximum: 64 }),
    settingsSource: OptimizerSettingsSourceSchema,
    schedulerSettingsId: Type.Union([Type.String({ minLength: 1, maxLength: 200 }), Type.Null()]),
    parameterProfileId: Type.String({ minLength: 1, maxLength: 200 }),
    packageVersion: Type.Literal("0.5.0"),
    fsrsCoreVersion: Type.Literal("FSRS-6"),
    algorithmVersion: Type.Literal("6.0"),
    adapterVersion: Type.Integer({ minimum: 1 }),
    schemaVersion: Type.Integer({ minimum: 1 }),
    rawReviewCount: Type.Integer({ minimum: 0 }),
    otherwiseEligibleExampleCount: Type.Integer({ minimum: 0 }),
    excludedByMaxSeqLenCount: Type.Integer({ minimum: 0 }),
    eligibleExampleCount: Type.Integer({ minimum: 0 }),
    sourceReviewCutoffMs: Type.Union([EpochMillisecondsSchema, Type.Null()]),
    sourceReviewFingerprint: Type.String({ minLength: 64, maxLength: 64, pattern: "^[0-9a-f]{64}$" }),
  },
  { additionalProperties: false },
);

const TechnicalProfileSchema = Type.Object(
  {
    profileId: Type.String({ minLength: 1, maxLength: 200 }),
    sourceKind: Type.Union([Type.Literal("official"), Type.Literal("global"), Type.Literal("section")]),
    eligibleExampleCount: Type.Integer({ minimum: 0 }),
    reviewCutoffMs: Type.Union([EpochMillisecondsSchema, Type.Null()]),
    createdAtMs: Type.Union([EpochMillisecondsSchema, Type.Null()]),
    packageVersion: Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()]),
    metricLogLoss: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    metricRmseBins: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export const OptimizerTechnicalInfoSchema = Type.Object(
  {
    manifest: OptimizerTrainingManifestSchema,
    officialTrainingConfig: OptimizerTrainingConfigSchema,
    parameterSource: Type.Object(
      {
        kind: Type.Union([Type.Literal("official"), Type.Literal("global"), Type.Literal("section")]),
        profileId: Type.String({ minLength: 1, maxLength: 200 }),
        eligibleExampleCount: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    activeProfile: TechnicalProfileSchema,
  },
  { additionalProperties: false },
);

export type OptimizerTrainingSettings = Static<typeof OptimizerTrainingSettingsSchema>;
export type OptimizerTrainingConfig = Static<typeof OptimizerTrainingConfigSchema>;
export type OptimizerTrainingControl = Static<typeof OptimizerTrainingControlSchema>;
export type OptimizerCapability = Static<typeof OptimizerCapabilitySchema>;
export type OptimizerTrainingManifest = Static<typeof OptimizerTrainingManifestSchema>;
export type OptimizerSettingsSource = Static<typeof OptimizerSettingsSourceSchema>;
export type OptimizerTrainingSettingsScope = Static<typeof OptimizerTrainingSettingsScopeSchema>;
export type OptimizerSettingsMutation = Static<typeof OptimizerSettingsMutationSchema>;
export type OptimizerSettingsReset = Static<typeof OptimizerSettingsResetSchema>;
export type OptimizerSettingsView = Static<typeof OptimizerSettingsViewSchema>;
export type OptimizerTrainingPreflightRequest = Static<typeof OptimizerTrainingPreflightRequestSchema>;
export type OptimizerTrainingPreflight = Static<typeof OptimizerTrainingPreflightSchema>;
export type OptimizerRunInputSnapshot = Static<typeof OptimizerRunInputSnapshotSchema>;
export type OptimizerTechnicalInfo = Static<typeof OptimizerTechnicalInfoSchema>;
