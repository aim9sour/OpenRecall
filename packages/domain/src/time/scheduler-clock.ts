import { Temporal } from "@js-temporal/polyfill";
import type { StudyDayConfig } from "./types.js";

const MILLISECONDS_PER_DAY = 86_400_000;

function validateConfig(config: StudyDayConfig): void {
  if (
    !Number.isInteger(config.boundaryMinutes) ||
    config.boundaryMinutes < 0 ||
    config.boundaryMinutes > 1439
  ) {
    throw new RangeError(
      "Study-day boundary minutes must be an integer from 0 through 1439.",
    );
  }

  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(
      config.timeZone,
    );
  } catch (error) {
    throw new RangeError(`Invalid IANA time zone: ${config.timeZone}`, {
      cause: error,
    });
  }
}

function validateEpochMilliseconds(epochMs: number): void {
  if (!Number.isSafeInteger(epochMs)) {
    throw new RangeError("Epoch milliseconds must be a safe integer.");
  }
}

function validateSchedulerDate(date: Date): void {
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError("Scheduler date must be valid.");
  }
}

export function toSchedulerDate(
  epochMs: number,
  config: StudyDayConfig,
): Date {
  validateConfig(config);
  validateEpochMilliseconds(epochMs);

  const shiftedWallTime = Temporal.Instant.fromEpochMilliseconds(epochMs)
    .toZonedDateTimeISO(config.timeZone)
    .toPlainDateTime()
    .subtract({ minutes: config.boundaryMinutes });

  return new Date(
    Date.UTC(
      shiftedWallTime.year,
      shiftedWallTime.month - 1,
      shiftedWallTime.day,
      shiftedWallTime.hour,
      shiftedWallTime.minute,
      shiftedWallTime.second,
      shiftedWallTime.millisecond,
    ),
  );
}

export function fromSchedulerDate(
  date: Date,
  config: StudyDayConfig,
): number {
  validateConfig(config);
  validateSchedulerDate(date);

  const shiftedWallTime = Temporal.PlainDateTime.from({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
  });

  return shiftedWallTime
    .add({ minutes: config.boundaryMinutes })
    .toZonedDateTime(config.timeZone, { disambiguation: "compatible" })
    .toInstant().epochMilliseconds;
}

export function studyDayDelta(
  previousMs: number,
  currentMs: number,
  config: StudyDayConfig,
): number {
  validateEpochMilliseconds(previousMs);
  validateEpochMilliseconds(currentMs);

  if (currentMs < previousMs) {
    throw new RangeError(
      "Current time must not be earlier than the previous time.",
    );
  }

  const previousDate = toSchedulerDate(previousMs, config);
  const currentDate = toSchedulerDate(currentMs, config);
  const previousStudyDay = Date.UTC(
    previousDate.getUTCFullYear(),
    previousDate.getUTCMonth(),
    previousDate.getUTCDate(),
  );
  const currentStudyDay = Date.UTC(
    currentDate.getUTCFullYear(),
    currentDate.getUTCMonth(),
    currentDate.getUTCDate(),
  );

  return (currentStudyDay - previousStudyDay) / MILLISECONDS_PER_DAY;
}
