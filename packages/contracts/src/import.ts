import { Type, type Static } from "typebox";

const MeaningfulTextSchema = Type.String({
  minLength: 1,
  maxLength: 20_000,
  pattern: "\\S",
});

export const CardPresentationInputSchema = Type.Object(
  {
    front: MeaningfulTextSchema,
    back: MeaningfulTextSchema,
    notes: Type.Optional(
      Type.Union([Type.String({ maxLength: 20_000 }), Type.Null()]),
    ),
  },
  { additionalProperties: true },
);

export const CardImportSchema = Type.Object(
  {
    front: MeaningfulTextSchema,
    back: MeaningfulTextSchema,
    notes: Type.Optional(
      Type.Union([Type.String({ maxLength: 20_000 }), Type.Null()]),
    ),
    variants: Type.Optional(Type.Array(CardPresentationInputSchema)),
  },
  { additionalProperties: true },
);

export const ImportPreviewRowSchema = Type.Object(
  {
    index: Type.Integer({ minimum: 0 }),
    status: Type.Union([
      Type.Literal("valid"),
      Type.Literal("duplicate"),
      Type.Literal("invalid"),
    ]),
    issues: Type.Array(
      Type.Object(
        {
          path: Type.String({ minLength: 1, maxLength: 500 }),
          messageKey: Type.String({ minLength: 1, maxLength: 200 }),
        },
        { additionalProperties: false },
      ),
    ),
    warnings: Type.Array(
      Type.Object(
        {
          path: Type.String({ minLength: 1, maxLength: 500 }),
          messageKey: Type.String({ minLength: 1, maxLength: 200 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const ImportPreviewSchema = Type.Object(
  {
    total: Type.Integer({ minimum: 0 }),
    valid: Type.Integer({ minimum: 0 }),
    duplicate: Type.Integer({ minimum: 0 }),
    invalid: Type.Integer({ minimum: 0 }),
    rows: Type.Array(ImportPreviewRowSchema),
  },
  { additionalProperties: false },
);

export type CardPresentationInput = Static<
  typeof CardPresentationInputSchema
>;
export type CardImport = Static<typeof CardImportSchema>;
export type ImportPreviewRow = Static<typeof ImportPreviewRowSchema>;
export type ImportPreview = Static<typeof ImportPreviewSchema>;
