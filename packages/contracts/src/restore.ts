import { Type, type Static } from "typebox";

export const RestoreResultSchema = Type.Object(
  {
    databaseRevision: Type.Integer({ minimum: 2 }),
    restoredUserVersion: Type.Integer({ minimum: 1 }),
    preRestoreBackupFilename: Type.String({
      minLength: 1,
      maxLength: 120,
    }),
  },
  { additionalProperties: false },
);

export type RestoreResult = Static<typeof RestoreResultSchema>;
