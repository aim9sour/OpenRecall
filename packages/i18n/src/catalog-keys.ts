import type { LocaleTag } from "./types.js";

export const COMMON_MESSAGE_KEYS = [
  "app.name",
  "nav.home",
  "nav.statistics",
  "nav.settings",
  "section.create",
  "section.name",
  "import.preview",
  "import.commit",
  "error.summary",
] as const;

export const requiredPluralSuffixes = {
  en: ["one", "other"],
  ar: ["zero", "one", "two", "few", "many", "other"],
} as const satisfies Readonly<Record<LocaleTag, readonly string[]>>;
