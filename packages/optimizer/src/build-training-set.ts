import { createHash } from "node:crypto";
import type {
  OptimizerExample,
  OptimizerReview,
  StoredOptimizerReview,
  TrainingSetSummary,
} from "./types.js";

function validateRow(row: StoredOptimizerReview): void {
  if (
    !Number.isInteger(row.rating) ||
    row.rating < 1 ||
    row.rating > 4
  ) {
    throw new Error("OPTIMIZER_REVIEW_RATING_INVALID");
  }
  if (!Number.isInteger(row.deltaDays) || row.deltaDays < 0) {
    throw new Error("OPTIMIZER_REVIEW_DELTA_INVALID");
  }
  if (!Number.isSafeInteger(row.ratedAtMs) || row.ratedAtMs < 0) {
    throw new Error("OPTIMIZER_REVIEW_TIME_INVALID");
  }
  if (
    row.reviewLogId.length === 0 ||
    row.learningItemId.length === 0 ||
    row.sectionId.length === 0
  ) {
    throw new Error("OPTIMIZER_REVIEW_ID_INVALID");
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function fingerprintOptimizerReviews(
  rows: readonly StoredOptimizerReview[],
): string {
  const hash = createHash("sha256");
  for (const row of rows) {
    for (const value of [
      row.reviewLogId,
      row.learningItemId,
      row.sectionId,
      String(row.rating),
      String(row.deltaDays),
      String(row.ratedAtMs),
    ]) {
      hash.update(String(Buffer.byteLength(value, "utf8")));
      hash.update(":");
      hash.update(value, "utf8");
    }
    hash.update(";");
  }
  return hash.digest("hex");
}

export function buildTrainingSet(
  storedReviews: readonly StoredOptimizerReview[],
  options: { readonly maxSeqLen: number },
): TrainingSetSummary {
  if (!Number.isSafeInteger(options.maxSeqLen) || options.maxSeqLen < 1) {
    throw new Error("OPTIMIZER_MAX_SEQUENCE_LENGTH_INVALID");
  }
  for (const row of storedReviews) validateRow(row);
  const rows = [...storedReviews].sort(
    (left, right) =>
      compareText(left.learningItemId, right.learningItemId) ||
      left.ratedAtMs - right.ratedAtMs ||
      compareText(left.reviewLogId, right.reviewLogId),
  );
  const timestampedExamples: Array<{
    readonly example: OptimizerExample;
    readonly targetRatedAtMs: number;
  }> = [];
  let history: OptimizerReview[] = [];
  let currentItemId: string | null = null;

  for (const row of rows) {
    if (row.learningItemId !== currentItemId) {
      currentItemId = row.learningItemId;
      history = [];
    }
    history.push({
      rating: row.rating,
      deltaDays: row.deltaDays,
    });
    if (history.length > 1 && row.deltaDays > 0) {
      timestampedExamples.push({
        targetRatedAtMs: row.ratedAtMs,
        example: {
          learningItemId: row.learningItemId,
          targetReviewLogId: row.reviewLogId,
          reviews: history.map((review) => ({ ...review })),
        },
      });
    }
  }
  timestampedExamples.sort(
    (left, right) =>
      left.targetRatedAtMs - right.targetRatedAtMs ||
      compareText(
        left.example.targetReviewLogId,
        right.example.targetReviewLogId,
      ) ||
      compareText(
        left.example.learningItemId,
        right.example.learningItemId,
      ),
  );
  const allExamples = timestampedExamples.map(({ example }) => example);
  const examples = allExamples.filter(
    (example) => example.reviews.length <= options.maxSeqLen,
  );

  return {
    rawReviewCount: rows.length,
    preFilterEligibleExampleCount: allExamples.length,
    eligibleExampleCount: examples.length,
    maxSequenceExcludedCount: allExamples.length - examples.length,
    sourceReviewCutoffMs:
      rows.length === 0
        ? null
        : Math.max(...rows.map(({ ratedAtMs }) => ratedAtMs)),
    sourceReviewFingerprint: fingerprintOptimizerReviews(rows),
    examples,
  };
}
