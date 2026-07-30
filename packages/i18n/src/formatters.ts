import type { LocaleTag } from "./types.js";
import { getLocaleDefinition } from "./locale-registry.js";

export type PluralCategory = Intl.LDMLPluralRule;
export type PluralForms = Readonly<
  Partial<Record<PluralCategory, string>> & {
    readonly other: string;
  }
>;

function validateFinite(value: number, code: string): void {
  if (!Number.isFinite(value)) throw new Error(code);
}

function formatLocale(locale: LocaleTag): string {
  return getLocaleDefinition(locale).formatLocale;
}

export function formatNumber(
  value: number,
  locale: LocaleTag,
  options: Intl.NumberFormatOptions = {},
): string {
  validateFinite(value, "FORMAT_NUMBER_INVALID");
  return new Intl.NumberFormat(formatLocale(locale), options).format(
    value,
  );
}

export function formatDateTime(
  value: number | Date,
  locale: LocaleTag,
  timeZone: string,
  options: Omit<Intl.DateTimeFormatOptions, "timeZone"> = {
    dateStyle: "medium",
    timeStyle: "short",
  },
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()) || timeZone.trim().length === 0) {
    throw new Error("FORMAT_DATE_TIME_INVALID");
  }
  return new Intl.DateTimeFormat(formatLocale(locale), {
    ...options,
    timeZone,
  }).format(date);
}

export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  locale: LocaleTag,
): string {
  validateFinite(value, "FORMAT_RELATIVE_TIME_INVALID");
  return new Intl.RelativeTimeFormat(formatLocale(locale), {
    numeric: "auto",
  }).format(value, unit);
}

export function formatDuration(
  durationMs: number,
  locale: LocaleTag,
): string {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
    throw new Error("FORMAT_DURATION_INVALID");
  }
  let remainingSeconds = Math.floor(durationMs / 1_000);
  const units = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
    ["second", 1],
  ] as const;
  const parts: string[] = [];

  for (const [unit, seconds] of units) {
    const count = Math.floor(remainingSeconds / seconds);
    remainingSeconds %= seconds;
    if (count > 0 || (unit === "second" && parts.length === 0)) {
      parts.push(
        new Intl.NumberFormat(formatLocale(locale), {
          style: "unit",
          unit,
          unitDisplay: "long",
        }).format(count),
      );
    }
  }

  return new Intl.ListFormat(formatLocale(locale), {
    style: "long",
    type: "unit",
  }).format(parts);
}

export function getPluralCategory(
  count: number,
  locale: LocaleTag,
): PluralCategory {
  validateFinite(count, "FORMAT_COUNT_INVALID");
  return new Intl.PluralRules(formatLocale(locale)).select(count);
}

export function formatPluralCount(
  count: number,
  locale: LocaleTag,
  forms: PluralForms,
): string {
  const category = getPluralCategory(count, locale);
  const template = forms[category] ?? forms.other;
  return template.replaceAll(
    "{{count}}",
    formatNumber(count, locale),
  );
}

export function formatRatingCount(
  ratingLabel: string,
  count: number,
  locale: LocaleTag,
): string {
  if (ratingLabel.trim().length === 0) {
    throw new Error("FORMAT_RATING_INVALID");
  }
  return `${ratingLabel}: ${formatNumber(count, locale)}`;
}
