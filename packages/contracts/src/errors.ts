import { Type, type Static } from "typebox";

const MessageKeySchema = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: "\\S",
});

export const ApiFieldErrorSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 500, pattern: "\\S" }),
    messageKey: MessageKeySchema,
  },
  { additionalProperties: false },
);

export const ApiErrorSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" }),
    messageKey: MessageKeySchema,
    fieldErrors: Type.Optional(Type.Array(ApiFieldErrorSchema)),
  },
  { additionalProperties: false },
);

export type ApiFieldError = Static<typeof ApiFieldErrorSchema>;
export type ApiError = Static<typeof ApiErrorSchema>;
