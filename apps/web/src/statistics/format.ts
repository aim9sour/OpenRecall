import type { I18nInstance } from "../app/I18nProvider.js";

type Translate = I18nInstance["t"];

export function formatProbability(
  value: number | null,
  language: string,
  t: Translate,
): string {
  return value === null
    ? t("statistics.notEnoughData")
    : new Intl.NumberFormat(language, {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
}

export function formatDuration(
  durationMs: number,
  language: string,
  t: Translate,
): string {
  const totalSeconds = Math.floor(durationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const number = new Intl.NumberFormat(language);
  if (minutes === 0) {
    return t("statistics.duration.seconds", {
      count: number.format(seconds),
    });
  }
  if (seconds === 0) {
    return t("statistics.duration.minutes", {
      count: number.format(minutes),
    });
  }
  return t("statistics.duration.minutesSeconds", {
    minutes: number.format(minutes),
    seconds: number.format(seconds),
  });
}

export function formatStudyDay(
  studyDay: string,
  language: string,
): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${studyDay}T12:00:00.000Z`));
}

export function formatDateTime(
  valueMs: number | null,
  language: string,
  t: Translate,
): string {
  return valueMs === null
    ? t("statistics.never")
    : new Intl.DateTimeFormat(language, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(valueMs));
}
