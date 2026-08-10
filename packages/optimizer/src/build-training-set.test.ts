import { describe, expect, it } from "vitest";
import { buildTrainingSet } from "./build-training-set.js";
import { toBindingItems } from "./binding-adapter.js";
import type { StoredOptimizerReview } from "./types.js";

function review(
  id: string,
  deltaDays: number,
  options: Partial<StoredOptimizerReview> = {},
): StoredOptimizerReview {
  return {
    reviewLogId: id,
    learningItemId: "item-a",
    sectionId: "section-a",
    rating: 3,
    deltaDays,
    ratedAtMs: Number(id.replace(/\D/g, "")) || 1,
    ...options,
  };
}

describe("buildTrainingSet", () => {
  it("expands only positive-day targets while retaining same-day history", () => {
    const summary = buildTrainingSet([
      review("log-1", 0, { rating: 1, ratedAtMs: 10 }),
      review("log-2", 0, { rating: 2, ratedAtMs: 20 }),
      review("log-3", 1, { rating: 3, ratedAtMs: 30 }),
      review("log-4", 3, { rating: 4, ratedAtMs: 40 }),
    ], { maxSeqLen: 512 });

    expect(summary).toEqual({
      rawReviewCount: 4,
      preFilterEligibleExampleCount: 2,
      eligibleExampleCount: 2,
      maxSequenceExcludedCount: 0,
      sourceReviewCutoffMs: 40,
      sourceReviewFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      examples: [
        {
          learningItemId: "item-a",
          targetReviewLogId: "log-3",
          reviews: [
            { rating: 1, deltaDays: 0 },
            { rating: 2, deltaDays: 0 },
            { rating: 3, deltaDays: 1 },
          ],
        },
        {
          learningItemId: "item-a",
          targetReviewLogId: "log-4",
          reviews: [
            { rating: 1, deltaDays: 0 },
            { rating: 2, deltaDays: 0 },
            { rating: 3, deltaDays: 1 },
            { rating: 4, deltaDays: 3 },
          ],
        },
      ],
    });
    expect(summary.examples[0]?.reviews).not.toBe(
      summary.examples[1]?.reviews,
    );
  });

  it("never uses the first review as a target and never crosses item boundaries", () => {
    const summary = buildTrainingSet([
      review("b-2", 2, {
        learningItemId: "item-b",
        ratedAtMs: 20,
      }),
      review("a-1", 5, { ratedAtMs: 10 }),
      review("b-1", 0, {
        learningItemId: "item-b",
        ratedAtMs: 10,
      }),
    ], { maxSeqLen: 512 });

    expect(summary.rawReviewCount).toBe(3);
    expect(summary.examples).toEqual([
      {
        learningItemId: "item-b",
        targetReviewLogId: "b-2",
        reviews: [
          { rating: 3, deltaDays: 0 },
          { rating: 3, deltaDays: 2 },
        ],
      },
    ]);
  });

  it("orders eligible examples by target time for time-series evaluation", () => {
    const summary = buildTrainingSet([
      review("a-2", 5, {
        learningItemId: "item-a",
        ratedAtMs: 50,
      }),
      review("b-2", 3, {
        learningItemId: "item-b",
        ratedAtMs: 40,
      }),
      review("a-1", 0, {
        learningItemId: "item-a",
        ratedAtMs: 10,
      }),
      review("b-1", 0, {
        learningItemId: "item-b",
        ratedAtMs: 20,
      }),
    ], { maxSeqLen: 512 });

    expect(
      summary.examples.map(({ targetReviewLogId }) => targetReviewLogId),
    ).toEqual(["b-2", "a-2"]);
  });

  it("uses immutable log IDs to order equal timestamps and validates rows", () => {
    const summary = buildTrainingSet([
      review("log-b", 1, { ratedAtMs: 100 }),
      review("log-a", 0, { ratedAtMs: 100 }),
    ], { maxSeqLen: 512 });
    expect(summary.examples[0]).toMatchObject({
      targetReviewLogId: "log-b",
      reviews: [
        { rating: 3, deltaDays: 0 },
        { rating: 3, deltaDays: 1 },
      ],
    });

    expect(() =>
      buildTrainingSet([
        review("bad-rating", 0, { rating: 5 as never }),
      ], { maxSeqLen: 512 }),
    ).toThrow("OPTIMIZER_REVIEW_RATING_INVALID");
    expect(() =>
      buildTrainingSet([review("bad-delta", -1)], { maxSeqLen: 512 }),
    ).toThrow("OPTIMIZER_REVIEW_DELTA_INVALID");
    expect(() =>
      buildTrainingSet([review("bad-time", 0, { ratedAtMs: -1 })], { maxSeqLen: 512 }),
    ).toThrow("OPTIMIZER_REVIEW_TIME_INVALID");
  });

  it("converts application examples only at the isolated binding boundary", () => {
    const summary = buildTrainingSet([
      review("log-1", 0, { rating: 2, ratedAtMs: 10 }),
      review("log-2", 4, { rating: 4, ratedAtMs: 20 }),
    ], { maxSeqLen: 512 });
    const items = toBindingItems(summary.examples);

    expect(
      items.map((item) =>
        item.reviews.map(({ rating, deltaT }) => ({ rating, deltaT })),
      ),
    ).toEqual([
      [
        { rating: 2, deltaT: 0 },
        { rating: 4, deltaT: 4 },
      ],
    ]);
  });

  it("excludes complete overlong examples instead of truncating histories", () => {
    const summary = buildTrainingSet([
      review("log-1", 0, { ratedAtMs: 10 }),
      review("log-2", 1, { ratedAtMs: 20 }),
      review("log-3", 1, { ratedAtMs: 30 }),
      review("log-4", 1, { ratedAtMs: 40 }),
    ], { maxSeqLen: 2 });

    expect(summary.preFilterEligibleExampleCount).toBe(3);
    expect(summary.eligibleExampleCount).toBe(1);
    expect(summary.maxSequenceExcludedCount).toBe(2);
    expect(summary.examples.every((example) => example.reviews.length <= 2)).toBe(true);
    expect(summary.sourceReviewFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fingerprints every canonical field, insert, and deletion", () => {
    const base = [
      review("log-1", 0, { ratedAtMs: 10 }),
      review("log-2", 2, { ratedAtMs: 20 }),
    ];
    const fingerprint = buildTrainingSet(base, { maxSeqLen: 64 }).sourceReviewFingerprint;
    const mutations: StoredOptimizerReview[][] = [
      [base[0]!, { ...base[1]!, reviewLogId: "log-x" }],
      [base[0]!, { ...base[1]!, learningItemId: "item-x" }],
      [base[0]!, { ...base[1]!, sectionId: "section-x" }],
      [base[0]!, { ...base[1]!, rating: 4 }],
      [base[0]!, { ...base[1]!, deltaDays: 3 }],
      [base[0]!, { ...base[1]!, ratedAtMs: 21 }],
      [base[0]!],
      [...base, review("log-3", 3, { ratedAtMs: 30 })],
    ];
    for (const rows of mutations) {
      expect(buildTrainingSet(rows, { maxSeqLen: 64 }).sourceReviewFingerprint).not.toBe(fingerprint);
    }
  });
});
