import type {
  StatisticsEvent,
  StatisticsSummary,
} from "./types.js";

export class StatisticsRowError extends Error {
  readonly rowIndex: number;

  constructor(code: string, rowIndex: number) {
    super(code);
    this.rowIndex = rowIndex;
  }
}

function validateEvent(event: StatisticsEvent, index: number): void {
  if (event.learningItemId.length === 0) {
    throw new StatisticsRowError("STATISTICS_ITEM_ID_INVALID", index);
  }
  if (![1, 2, 3, 4].includes(event.rating)) {
    throw new StatisticsRowError("STATISTICS_RATING_INVALID", index);
  }
  if (
    event.retrievability !== null &&
    (!Number.isFinite(event.retrievability) ||
      event.retrievability < 0 ||
      event.retrievability > 1)
  ) {
    throw new StatisticsRowError(
      "STATISTICS_RETRIEVABILITY_INVALID",
      index,
    );
  }
  if (
    event.durationMs !== null &&
    (!Number.isSafeInteger(event.durationMs) || event.durationMs < 0)
  ) {
    throw new StatisticsRowError("STATISTICS_DURATION_INVALID", index);
  }
  if (!Number.isSafeInteger(event.ratedAtMs)) {
    throw new StatisticsRowError("STATISTICS_TIME_INVALID", index);
  }
}

export function calculateStatisticsSummary(
  events: readonly StatisticsEvent[],
): StatisticsSummary {
  const ratingCounts: StatisticsSummary["ratingCounts"] = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
  };
  const uniqueItems = new Set<string>();
  let retrievabilityTotal = 0;
  let retrievabilityCount = 0;
  let retrievabilityExcluded = 0;
  let studyDurationMs = 0;
  let durationExcluded = 0;

  events.forEach((event, index) => {
    validateEvent(event, index);
    ratingCounts[event.rating] += 1;
    uniqueItems.add(event.learningItemId);
    if (event.retrievability === null) {
      retrievabilityExcluded += 1;
    } else {
      retrievabilityTotal += event.retrievability;
      retrievabilityCount += 1;
    }
    if (event.durationMs === null) {
      durationExcluded += 1;
    } else {
      studyDurationMs += event.durationMs;
    }
  });

  const successfulRatings =
    ratingCounts[2] + ratingCounts[3] + ratingCounts[4];
  return {
    reviewEvents: events.length,
    uniqueItems: uniqueItems.size,
    ratingCounts,
    actualRecall:
      events.length === 0 ? null : successfulRatings / events.length,
    meanPredictedRetrievability:
      retrievabilityCount === 0
        ? null
        : retrievabilityTotal / retrievabilityCount,
    retrievabilityExcluded,
    studyDurationMs,
    durationExcluded,
  };
}
