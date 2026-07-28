import type { StudyDayConfig } from "../time/types.js";
import { toSchedulerDate } from "../time/scheduler-clock.js";
import type {
  CurrentDueState,
  DailyActivityPoint,
  StatisticsEvent,
  WorkloadForecastPoint,
} from "./types.js";

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function studyDayKey(
  epochMs: number,
  config: StudyDayConfig,
): string {
  const shifted = toSchedulerDate(epochMs, config);
  return isoDate(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

export function groupDailyActivity(
  events: readonly StatisticsEvent[],
  config: StudyDayConfig,
): DailyActivityPoint[] {
  const groups = new Map<
    string,
    {
      reviewEvents: number;
      uniqueItems: Set<string>;
      durationMs: number;
      durationExcluded: number;
    }
  >();
  for (const event of events) {
    const key = studyDayKey(event.ratedAtMs, config);
    const group = groups.get(key) ?? {
      reviewEvents: 0,
      uniqueItems: new Set<string>(),
      durationMs: 0,
      durationExcluded: 0,
    };
    group.reviewEvents += 1;
    group.uniqueItems.add(event.learningItemId);
    if (event.durationMs === null) {
      group.durationExcluded += 1;
    } else if (Number.isSafeInteger(event.durationMs) && event.durationMs >= 0) {
      group.durationMs += event.durationMs;
    } else {
      throw new Error("STATISTICS_DURATION_INVALID");
    }
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([studyDay, group]) => ({
      studyDay,
      reviewEvents: group.reviewEvents,
      uniqueItems: group.uniqueItems.size,
      durationMs: group.durationMs,
      durationExcluded: group.durationExcluded,
    }));
}

export function groupCurrentDueForecast(
  states: readonly CurrentDueState[],
  nowMs: number,
  config: StudyDayConfig,
  days = 30,
): WorkloadForecastPoint[] {
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    throw new RangeError("STATISTICS_FORECAST_DAYS_INVALID");
  }
  const current = toSchedulerDate(nowMs, config);
  const currentDayMs = Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate(),
  );
  const points = Array.from({ length: days }, (_, offset) => ({
    studyDay: new Date(currentDayMs + offset * 86_400_000)
      .toISOString()
      .slice(0, 10),
    count: 0,
  }));
  const indexByDay = new Map(
    points.map((point, index) => [point.studyDay, index]),
  );
  for (const state of states) {
    const key = studyDayKey(Math.max(nowMs, state.dueAtMs), config);
    const index = indexByDay.get(key);
    if (index !== undefined) {
      points[index] = { ...points[index]!, count: points[index]!.count + 1 };
    }
  }
  return points;
}
