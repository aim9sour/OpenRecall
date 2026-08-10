import { describe, expect, it } from "vitest";
import {
  convertRecommendedSeconds,
  encodeStepRecommendationCsv,
  prepareStepRecommendationInput,
} from "./prepare-step-recommendation.js";
import type { StoredStepReview } from "./types.js";

function row(
  overrides: Partial<StoredStepReview> = {},
): StoredStepReview {
  return {
    reviewLogId: "log-1",
    learningItemId: "card-1",
    sectionId: "section-1",
    rating: 1,
    ratedAtMs: 1_000,
    reviewDurationMs: 250,
    priorStateJson: JSON.stringify({ memoryState: "new" }),
    ...overrides,
  };
}

describe("prepareStepRecommendationInput", () => {
  it("maps every official memory state and preserves millisecond values", () => {
    const rows = [
      row(),
      row({
        reviewLogId: "log-2",
        rating: 2,
        ratedAtMs: 2_000,
        reviewDurationMs: 500,
        priorStateJson: JSON.stringify({ memoryState: "learning" }),
      }),
      row({
        reviewLogId: "log-3",
        rating: 3,
        ratedAtMs: 3_000,
        priorStateJson: JSON.stringify({ memoryState: "review" }),
      }),
      row({
        reviewLogId: "log-4",
        rating: 4,
        ratedAtMs: 4_000,
        priorStateJson: JSON.stringify({ memoryState: "relearning" }),
      }),
    ];

    const prepared = prepareStepRecommendationInput(rows);

    expect(prepared.validRows).toEqual([
      expect.objectContaining({ reviewTimeMs: 1_000, reviewDurationMs: 250, state: 0 }),
      expect.objectContaining({ reviewTimeMs: 2_000, reviewDurationMs: 500, state: 1 }),
      expect.objectContaining({ state: 2 }),
      expect.objectContaining({ state: 3 }),
    ]);
    expect(prepared).toMatchObject({
      rawReviewCount: 4,
      validReviewCount: 4,
      validSequenceCount: 1,
      excludedSequenceCount: 0,
      sourceReviewCutoffMs: 4_000,
    });
  });

  it("allows equal timestamps when the review-log IDs establish strict tuple order", () => {
    const prepared = prepareStepRecommendationInput([
      row({ reviewLogId: "log-b", ratedAtMs: 1_000 }),
      row({ reviewLogId: "log-a", ratedAtMs: 1_000 }),
    ]);

    expect(prepared.validRows.map(({ reviewLogId }) => reviewLogId)).toEqual([
      "log-a",
      "log-b",
    ]);
    expect(prepared.exclusions.nonIncreasingOrder).toBe(0);
  });

  it.each([
    ["invalidCardId", { learningItemId: "" }],
    ["invalidTimestamp", { ratedAtMs: -1 }],
    ["invalidRating", { rating: 5 }],
    ["invalidState", { priorStateJson: "{" }],
    ["invalidState", { priorStateJson: JSON.stringify({ memoryState: "future" }) }],
    ["missingDuration", { reviewDurationMs: null }],
    ["missingDuration", { reviewDurationMs: -1 }],
  ] as const)("excludes the complete sequence for %s", (reason, override) => {
    const prepared = prepareStepRecommendationInput([
      row(reason === "invalidCardId" ? { learningItemId: "" } : {}),
      row({ reviewLogId: "log-2", ratedAtMs: 2_000, ...override }),
    ]);

    expect(prepared.validRows).toEqual([]);
    expect(prepared.validReviewCount).toBe(0);
    expect(prepared.validSequenceCount).toBe(0);
    expect(prepared.excludedSequenceCount).toBe(1);
    expect(prepared.exclusions[reason]).toBe(1);
  });

  it("counts a duplicated source tuple as non-increasing and excludes its sequence", () => {
    const duplicate = row();
    const prepared = prepareStepRecommendationInput([duplicate, duplicate]);

    expect(prepared.validRows).toEqual([]);
    expect(prepared.exclusions.nonIncreasingOrder).toBe(1);
  });

  it("fingerprints all raw canonical fields including later-excluded rows", () => {
    const base = [row(), row({ reviewLogId: "log-2", ratedAtMs: 2_000 })];
    const fingerprint = prepareStepRecommendationInput(base).sourceFingerprint;
    const mutations: readonly StoredStepReview[][] = [
      base.map((entry, index) => index === 1 ? { ...entry, rating: 4 } : entry),
      base.map((entry, index) => index === 1 ? { ...entry, ratedAtMs: 2_001 } : entry),
      base.map((entry, index) => index === 1 ? { ...entry, reviewDurationMs: 999 } : entry),
      base.map((entry, index) => index === 1 ? { ...entry, priorStateJson: "{" } : entry),
      [...base, row({ reviewLogId: "log-3", ratedAtMs: 3_000 })],
      base.slice(0, 1),
    ];

    for (const mutation of mutations) {
      expect(prepareStepRecommendationInput(mutation).sourceFingerprint).not.toBe(fingerprint);
    }
  });
});

describe("encodeStepRecommendationCsv", () => {
  it("emits the exact official header, RFC 4180 quoting, and milliseconds", () => {
    const validRows = prepareStepRecommendationInput([
      row({ learningItemId: "card,\"one\"" }),
    ]).validRows;

    expect(encodeStepRecommendationCsv(validRows).toString("utf8")).toBe(
      "card_id,review_time,review_rating,review_state,review_duration\n" +
        "\"card,\"\"one\"\"\",1000,1,0,250",
    );
  });
});

describe("convertRecommendedSeconds", () => {
  it("floors, sorts, and deduplicates applicable whole minutes", () => {
    expect(convertRecommendedSeconds([80, 5806])).toEqual({
      rawSeconds: [80, 5806],
      applicableMinutes: [1, 96],
      belowResolutionSeconds: [],
    });
    expect(convertRecommendedSeconds([30, 90, 119])).toEqual({
      rawSeconds: [30, 90, 119],
      applicableMinutes: [1],
      belowResolutionSeconds: [30],
    });
  });
});
