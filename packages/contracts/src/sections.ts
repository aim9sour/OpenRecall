import { Type, type Static } from "typebox";

export const UuidSchema = Type.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
});

export const EpochMillisecondsSchema = Type.Integer({ minimum: 0 });

export const SectionSummarySchema = Type.Object(
  {
    id: UuidSchema,
    name: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
    createdAtMs: EpochMillisecondsSchema,
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

export type SectionSummary = Static<typeof SectionSummarySchema>;
