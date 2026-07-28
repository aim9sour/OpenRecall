import { describe, expect, it } from "vitest";
import {
  calculateReviewDuration,
  parseRatingResponse,
  serializeRatingResponse,
  type RatingResponse,
} from "./rating-service.js";

const response: RatingResponse = {
  sessionId: "session-1",
  entryId: "entry-1",
  learningItemId: "item-1",
  rating: 3,
  stateRevision: 4,
  dueAtMs: 5000,
  newlyJoined: 2,
  sessionRevision: 8,
};

describe("rating service stable values", () => {
  it("round-trips a canonical rating response byte-for-byte", () => {
    const serialized = serializeRatingResponse(response);

    expect(serialized).toBe(
      '{"sessionId":"session-1","entryId":"entry-1","learningItemId":"item-1","rating":3,"stateRevision":4,"dueAtMs":5000,"newlyJoined":2,"sessionRevision":8}',
    );
    expect(serializeRatingResponse(parseRatingResponse(serialized))).toBe(
      serialized,
    );
  });

  it("drops unknown stored fields when restoring the canonical response", () => {
    const serialized = JSON.stringify({
      ...response,
      unexpectedCardContent: "must not survive replay",
    });

    expect(parseRatingResponse(serialized)).toEqual(response);
    expect(serializeRatingResponse(parseRatingResponse(serialized))).toBe(
      serializeRatingResponse(response),
    );
  });

  it.each([
    "{}",
    "null",
    '{"sessionId":"x","rating":5}',
    '{"sessionId":"x","rating":3,"stateRevision":-1}',
    "not-json",
  ])("rejects an invalid stored response: %s", (serialized) => {
    expect(() => parseRatingResponse(serialized)).toThrow(
      "RATING_RESPONSE_INVALID",
    );
  });

  it("calculates nonnegative duration from reveal to rating", () => {
    expect(calculateReviewDuration(1200, 1500)).toBe(300);
    expect(() => calculateReviewDuration(1500, 1200)).toThrow(
      "REVIEW_RATING_TIME_INVALID",
    );
  });
});
