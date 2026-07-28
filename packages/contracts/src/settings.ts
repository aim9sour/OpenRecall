import { Type, type Static } from "typebox";
import { EpochMillisecondsSchema, UuidSchema } from "./sections.js";

export const SchedulerStepsSchema = Type.Array(
  Type.Integer({ minimum: 1, maximum: 1_439 }),
  { maxItems: 64, uniqueItems: true },
);

export const SchedulerSettingsSchema = Type.Object(
  {
    requestedRetention: Type.Number({ minimum: 0.8, maximum: 0.95 }),
    maximumIntervalDays: Type.Integer({ minimum: 1, maximum: 36_500 }),
    enableFuzz: Type.Boolean(),
    enableShortTerm: Type.Boolean(),
    learningStepsMinutes: SchedulerStepsSchema,
    relearningStepsMinutes: SchedulerStepsSchema,
  },
  { additionalProperties: false },
);

const ControlMetadataSchema = {
  labelKey: Type.String({ minLength: 1, maxLength: 200 }),
  descriptionKey: Type.String({ minLength: 1, maxLength: 200 }),
  deprecated: Type.Boolean(),
} as const;

export const SchedulerControlSchema = Type.Union([
  Type.Object(
    {
      ...ControlMetadataSchema,
      key: Type.Literal("requestedRetention"),
      kind: Type.Literal("number"),
      defaultValue: Type.Number(),
      min: Type.Literal(0.8),
      max: Type.Literal(0.95),
      step: Type.Literal(0.01),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ControlMetadataSchema,
      key: Type.Literal("maximumIntervalDays"),
      kind: Type.Literal("integer"),
      defaultValue: Type.Integer(),
      min: Type.Literal(1),
      max: Type.Literal(36_500),
      step: Type.Literal(1),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ControlMetadataSchema,
      key: Type.Literal("enableFuzz"),
      kind: Type.Literal("boolean"),
      defaultValue: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ControlMetadataSchema,
      key: Type.Literal("enableShortTerm"),
      kind: Type.Literal("boolean"),
      defaultValue: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ControlMetadataSchema,
      key: Type.Literal("learningStepsMinutes"),
      kind: Type.Literal("steps"),
      defaultValue: SchedulerStepsSchema,
      maxMinutes: Type.Literal(1_439),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ControlMetadataSchema,
      key: Type.Literal("relearningStepsMinutes"),
      kind: Type.Literal("steps"),
      defaultValue: SchedulerStepsSchema,
      maxMinutes: Type.Literal(1_439),
    },
    { additionalProperties: false },
  ),
]);

export const SchedulerManifestSchema = Type.Object(
  {
    algorithmId: Type.String({ minLength: 1, maxLength: 100 }),
    algorithmVersion: Type.String({ minLength: 1, maxLength: 100 }),
    upstreamPackage: Type.String({ minLength: 1, maxLength: 200 }),
    adapterVersion: Type.Integer({ minimum: 1 }),
    controls: Type.Array(SchedulerControlSchema),
  },
  { additionalProperties: false },
);

export const SchedulerSettingsScopeSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 200 }),
    scopeType: Type.Union([
      Type.Literal("global"),
      Type.Literal("section"),
    ]),
    sectionId: Type.Union([UuidSchema, Type.Null()]),
    adapterVersion: Type.Integer({ minimum: 1 }),
    settings: SchedulerSettingsSchema,
    updatedAtMs: EpochMillisecondsSchema,
  },
  { additionalProperties: false },
);

export const SettingsQuerySchema = Type.Object(
  {
    sectionId: Type.Optional(UuidSchema),
  },
  { additionalProperties: false },
);

export const SchedulerSettingsMutationSchema = Type.Object(
  {
    expectedUpdatedAtMs: Type.Optional(EpochMillisecondsSchema),
    settings: SchedulerSettingsSchema,
  },
  { additionalProperties: false },
);

export const SchedulerSettingsResetSchema = Type.Object(
  {
    expectedUpdatedAtMs: EpochMillisecondsSchema,
  },
  { additionalProperties: false },
);

const SettingsSourceSchema = Type.Union([
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

const ParameterSourceSchema = Type.Object(
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

export const SettingsViewSchema = Type.Object(
  {
    manifest: SchedulerManifestSchema,
    defaults: SchedulerSettingsSchema,
    selectedScope: Type.Object(
      {
        scopeType: Type.Union([
          Type.Literal("global"),
          Type.Literal("section"),
        ]),
        sectionId: Type.Union([UuidSchema, Type.Null()]),
      },
      { additionalProperties: false },
    ),
    savedOverride: Type.Union([
      SchedulerSettingsScopeSchema,
      Type.Null(),
    ]),
    effective: Type.Object(
      {
        settings: SchedulerSettingsSchema,
        settingsSource: SettingsSourceSchema,
        parameterSource: ParameterSourceSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type SchedulerSettings = Static<typeof SchedulerSettingsSchema>;
export type SchedulerControl = Static<typeof SchedulerControlSchema>;
export type SchedulerManifest = Static<typeof SchedulerManifestSchema>;
export type SchedulerSettingsScope = Static<
  typeof SchedulerSettingsScopeSchema
>;
export type SettingsQuery = Static<typeof SettingsQuerySchema>;
export type SchedulerSettingsMutation = Static<
  typeof SchedulerSettingsMutationSchema
>;
export type SchedulerSettingsReset = Static<
  typeof SchedulerSettingsResetSchema
>;
export type SettingsView = Static<typeof SettingsViewSchema>;
