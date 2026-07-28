import type { LocaleTag } from "./types.js";

export const COMMON_MESSAGE_KEYS = [
  "app.name",
  "skip.main",
  "nav.primary",
  "nav.home",
  "nav.statistics",
  "nav.settings",
  "home.title",
  "home.createHeading",
  "home.sectionsHeading",
  "home.empty",
  "section.create",
  "section.name",
  "section.startReview",
  "section.reviewUnavailable",
  "section.statistics",
  "section.backHome",
  "stats.total",
  "stats.new",
  "stats.due",
  "form.submitting",
  "import.preview",
  "import.commit",
  "error.summary",
  "error.field.invalid",
  "error.internal",
] as const;

export const requiredPluralSuffixes = {
  en: ["one", "other"],
  ar: ["zero", "one", "two", "few", "many", "other"],
} as const satisfies Readonly<Record<LocaleTag, readonly string[]>>;
