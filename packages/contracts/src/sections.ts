import { Type, type Static } from "typebox";

export const UuidSchema = Type.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
});

export const EpochMillisecondsSchema = Type.Integer({ minimum: 0 });

export const SectionCreateSchema = Type.Object(
  {
    name: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: "\\S",
    }),
  },
  { additionalProperties: false },
);

export const SectionSchema = Type.Object(
  {
    id: UuidSchema,
    name: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
    createdAtMs: EpochMillisecondsSchema,
    updatedAtMs: EpochMillisecondsSchema,
  },
  { additionalProperties: false },
);

export const SectionSummarySchema = Type.Object(
  {
    id: UuidSchema,
    name: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
    createdAtMs: EpochMillisecondsSchema,
    updatedAtMs: EpochMillisecondsSchema,
    counts: Type.Object(
      {
        total: Type.Integer({ minimum: 0 }),
        new: Type.Integer({ minimum: 0 }),
        dueNow: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    nextDueAtMs: Type.Union([EpochMillisecondsSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export const SectionRenameSchema = Type.Object(
  {
    name: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: "\\S",
    }),
    expectedUpdatedAtMs: EpochMillisecondsSchema,
  },
  { additionalProperties: false },
);

export const SectionDeleteSchema = Type.Object(
  {
    confirmed: Type.Optional(Type.Boolean()),
    expectedUpdatedAtMs: EpochMillisecondsSchema,
  },
  { additionalProperties: false },
);

export const SectionConflictResponseSchema = Type.Object(
  {
    code: Type.Literal("SECTION_CONFLICT"),
    messageKey: Type.Union([
      Type.Literal("section.rename.conflict"),
      Type.Literal("section.delete.conflict"),
    ]),
    current: SectionSummarySchema,
  },
  { additionalProperties: false },
);

export type SectionCreate = Static<typeof SectionCreateSchema>;
export type Section = Static<typeof SectionSchema>;
export type SectionSummary = Static<typeof SectionSummarySchema>;
export type SectionRename = Static<typeof SectionRenameSchema>;
export type SectionDelete = Static<typeof SectionDeleteSchema>;
export type SectionConflictResponse = Static<
  typeof SectionConflictResponseSchema
>;
