import { createHash } from "node:crypto";
import type { StepRecommendationValues } from "@openrecall/contracts";
import type {
  PreparedStepRecommendationInput,
  StoredStepReview,
  ValidatedStepReview,
} from "./types.js";

type ExclusionReason = keyof PreparedStepRecommendationInput["exclusions"];

const MEMORY_STATE = {
  new: 0,
  learning: 1,
  review: 2,
  relearning: 3,
} as const;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCanonicalRows(
  left: StoredStepReview,
  right: StoredStepReview,
): number {
  return (
    compareText(left.learningItemId, right.learningItemId) ||
    left.ratedAtMs - right.ratedAtMs ||
    compareText(left.reviewLogId, right.reviewLogId)
  );
}

function fingerprintRows(rows: readonly StoredStepReview[]): string {
  const hash = createHash("sha256");
  for (const row of rows) {
    const fields: readonly (string | number | null)[] = [
      row.reviewLogId,
      row.learningItemId,
      row.sectionId,
      row.rating,
      row.ratedAtMs,
      row.reviewDurationMs,
      row.priorStateJson,
    ];
    for (const value of fields) {
      const text = value === null ? "<null>" : String(value);
      hash
        .update(String(Buffer.byteLength(text, "utf8")))
        .update(":")
        .update(text)
        .update(";");
    }
  }
  return hash.digest("hex");
}

function parseState(priorStateJson: string): 0 | 1 | 2 | 3 | null {
  try {
    const parsed: unknown = JSON.parse(priorStateJson);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("memoryState" in parsed)
    ) {
      return null;
    }
    const memoryState = parsed.memoryState;
    return typeof memoryState === "string" && memoryState in MEMORY_STATE
      ? MEMORY_STATE[memoryState as keyof typeof MEMORY_STATE]
      : null;
  } catch {
    return null;
  }
}

function validateSequence(
  rows: readonly StoredStepReview[],
):
  | { readonly validRows: readonly ValidatedStepReview[] }
  | { readonly reason: ExclusionReason } {
  const validRows: ValidatedStepReview[] = [];
  let previous: StoredStepReview | undefined;

  for (const row of rows) {
    if (row.learningItemId.trim().length === 0) {
      return { reason: "invalidCardId" };
    }
    if (!Number.isSafeInteger(row.ratedAtMs) || row.ratedAtMs < 0) {
      return { reason: "invalidTimestamp" };
    }
    if (!Number.isInteger(row.rating) || row.rating < 1 || row.rating > 4) {
      return { reason: "invalidRating" };
    }
    const state = parseState(row.priorStateJson);
    if (state === null) {
      return { reason: "invalidState" };
    }
    if (
      row.reviewDurationMs === null ||
      !Number.isSafeInteger(row.reviewDurationMs) ||
      row.reviewDurationMs < 0
    ) {
      return { reason: "missingDuration" };
    }
    if (
      previous !== undefined &&
      (row.ratedAtMs < previous.ratedAtMs ||
        (row.ratedAtMs === previous.ratedAtMs &&
          compareText(row.reviewLogId, previous.reviewLogId) <= 0))
    ) {
      return { reason: "nonIncreasingOrder" };
    }
    previous = row;
    validRows.push({
      reviewLogId: row.reviewLogId,
      cardId: row.learningItemId,
      reviewTimeMs: row.ratedAtMs,
      rating: row.rating as ValidatedStepReview["rating"],
      state,
      reviewDurationMs: row.reviewDurationMs,
    });
  }

  return { validRows };
}

export function prepareStepRecommendationInput(
  sourceRows: readonly StoredStepReview[],
): PreparedStepRecommendationInput {
  const rows = [...sourceRows].sort(compareCanonicalRows);
  const exclusions: Record<ExclusionReason, number> = {
    invalidCardId: 0,
    invalidTimestamp: 0,
    invalidRating: 0,
    invalidState: 0,
    missingDuration: 0,
    nonIncreasingOrder: 0,
  };
  const validRows: ValidatedStepReview[] = [];
  let validSequenceCount = 0;
  let excludedSequenceCount = 0;

  for (let index = 0; index < rows.length; ) {
    const cardId = rows[index]?.learningItemId;
    let end = index + 1;
    while (end < rows.length && rows[end]?.learningItemId === cardId) {
      end += 1;
    }
    const result = validateSequence(rows.slice(index, end));
    if ("reason" in result) {
      exclusions[result.reason] += 1;
      excludedSequenceCount += 1;
    } else {
      validRows.push(...result.validRows);
      validSequenceCount += 1;
    }
    index = end;
  }

  let sourceReviewCutoffMs: number | null = null;
  for (const { ratedAtMs } of rows) {
    if (
      Number.isSafeInteger(ratedAtMs) &&
      ratedAtMs >= 0 &&
      (sourceReviewCutoffMs === null || ratedAtMs > sourceReviewCutoffMs)
    ) {
      sourceReviewCutoffMs = ratedAtMs;
    }
  }

  return {
    sourceFingerprint: fingerprintRows(rows),
    sourceReviewCutoffMs,
    rawReviewCount: rows.length,
    validReviewCount: validRows.length,
    validSequenceCount,
    excludedSequenceCount,
    exclusions,
    validRows,
  };
}

function quoteCsv(value: string): string {
  return /[",\r\n]/u.test(value)
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

export function encodeStepRecommendationCsv(
  rows: readonly ValidatedStepReview[],
): Buffer {
  const lines = [
    "card_id,review_time,review_rating,review_state,review_duration",
    ...rows.map((row) =>
      [
        quoteCsv(row.cardId),
        row.reviewTimeMs,
        row.rating,
        row.state,
        row.reviewDurationMs,
      ].join(","),
    ),
  ];
  return Buffer.from(lines.join("\n"), "utf8");
}

export function convertRecommendedSeconds(
  secondsValues: readonly number[],
): StepRecommendationValues {
  const applicableMinutes = new Set<number>();
  const belowResolutionSeconds: number[] = [];
  for (const seconds of secondsValues) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error("STEP_RECOMMENDATION_SECONDS_INVALID");
    }
    if (seconds < 60) {
      belowResolutionSeconds.push(seconds);
    } else {
      applicableMinutes.add(Math.floor(seconds / 60));
    }
  }
  return {
    rawSeconds: [...secondsValues],
    applicableMinutes: [...applicableMinutes].sort((left, right) => left - right),
    belowResolutionSeconds,
  };
}
