import { arabicLocale } from "./locales/ar.js";
import { englishLocale } from "./locales/en.js";
import type {
  LocaleDefinition,
  ProductionLocaleTag,
} from "./types.js";

export const localeDefinitions = {
  ar: arabicLocale,
  en: englishLocale,
} as const satisfies Readonly<
  Record<ProductionLocaleTag, LocaleDefinition>
>;
