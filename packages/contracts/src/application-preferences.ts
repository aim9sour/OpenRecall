import {
  SUPPORTED_LOCALES,
  type ProductionLocaleTag,
} from "@openrecall/i18n";
import { Type, type Static } from "typebox";
import { EpochMillisecondsSchema } from "./sections.js";

export const ProductionLocaleSchema = Type.Union(
  SUPPORTED_LOCALES.map((tag) => Type.Literal(tag)),
);

export const ApplicationLocalePreferenceSchema = Type.Object(
  {
    locale: ProductionLocaleSchema,
    updatedAtMs: EpochMillisecondsSchema,
  },
  { additionalProperties: false },
);

export const ApplicationLocalePreferenceMutationSchema = Type.Object(
  {
    locale: ProductionLocaleSchema,
    expectedUpdatedAtMs: EpochMillisecondsSchema,
  },
  { additionalProperties: false },
);

export type ApplicationLocalePreference = Omit<
  Static<typeof ApplicationLocalePreferenceSchema>,
  "locale"
> & { readonly locale: ProductionLocaleTag };

export type ApplicationLocalePreferenceMutation = Omit<
  Static<typeof ApplicationLocalePreferenceMutationSchema>,
  "locale"
> & { readonly locale: ProductionLocaleTag };
