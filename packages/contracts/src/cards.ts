import { Type, type Static } from "typebox";
import {
  EpochMillisecondsSchema,
  UuidSchema,
} from "./sections.js";

const MeaningfulTextSchema = Type.String({
  minLength: 1,
  maxLength: 20_000,
  pattern: "\\S",
});

export const CardLifecycleSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("trashed"),
]);

export const CardPresentationEditSchema = Type.Object(
  {
    id: Type.Optional(UuidSchema),
    front: MeaningfulTextSchema,
    back: MeaningfulTextSchema,
    notes: Type.Optional(
      Type.Union([Type.String({ maxLength: 20_000 }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);

export const CardPresentationSchema = Type.Object(
  {
    id: UuidSchema,
    kind: Type.Union([Type.Literal("primary"), Type.Literal("variant")]),
    ordinal: Type.Integer({ minimum: 0 }),
    front: MeaningfulTextSchema,
    back: MeaningfulTextSchema,
    notes: Type.Union([Type.String({ maxLength: 20_000 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export const CardSchema = Type.Object(
  {
    id: UuidSchema,
    sectionId: UuidSchema,
    lifecycle: CardLifecycleSchema,
    createdAtMs: EpochMillisecondsSchema,
    updatedAtMs: EpochMillisecondsSchema,
    trashedAtMs: Type.Union([EpochMillisecondsSchema, Type.Null()]),
    presentations: Type.Array(CardPresentationSchema, {
      minItems: 1,
      maxItems: 10_001,
    }),
  },
  { additionalProperties: false },
);

export const CardPageSchema = Type.Object(
  {
    items: Type.Array(CardSchema, { maxItems: 100 }),
    nextCursor: Type.Union([
      Type.String({ minLength: 1, maxLength: 500 }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export const CardListQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    query: Type.Optional(Type.String({ maxLength: 500 })),
    lifecycle: Type.Optional(CardLifecycleSchema),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

export const CardItemParamsSchema = Type.Object(
  { itemId: UuidSchema },
  { additionalProperties: false },
);

export const CardEditSchema = Type.Object(
  {
    expectedUpdatedAtMs: EpochMillisecondsSchema,
    presentations: Type.Array(CardPresentationEditSchema, {
      minItems: 1,
      maxItems: 10_001,
    }),
  },
  { additionalProperties: false },
);

export const CardLifecycleMutationSchema = Type.Object(
  { expectedUpdatedAtMs: EpochMillisecondsSchema },
  { additionalProperties: false },
);

export const PermanentDeleteSchema = Type.Object(
  {
    confirmationItemId: UuidSchema,
    expectedUpdatedAtMs: EpochMillisecondsSchema,
  },
  { additionalProperties: false },
);

export type CardLifecycle = Static<typeof CardLifecycleSchema>;
export type CardPresentationEdit = Static<typeof CardPresentationEditSchema>;
export type CardPresentation = Static<typeof CardPresentationSchema>;
export type Card = Static<typeof CardSchema>;
export type CardPage = Static<typeof CardPageSchema>;
export type CardListQuery = Static<typeof CardListQuerySchema>;
export type CardItemParams = Static<typeof CardItemParamsSchema>;
export type CardEdit = Static<typeof CardEditSchema>;
export type CardLifecycleMutation = Static<
  typeof CardLifecycleMutationSchema
>;
export type PermanentDelete = Static<typeof PermanentDeleteSchema>;
