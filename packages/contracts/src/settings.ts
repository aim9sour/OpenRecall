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

export type SchedulerSettings = Static<typeof SchedulerSettingsSchema>;
export type SchedulerControl = Static<typeof SchedulerControlSchema>;
export type SchedulerManifest = Static<typeof SchedulerManifestSchema>;
export type SchedulerSettingsScope = Static<
  typeof SchedulerSettingsScopeSchema
>;
