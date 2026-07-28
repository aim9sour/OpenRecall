export interface RevealedCardView {
  readonly sessionId: string;
  readonly entryId: string;
  readonly learningItemId: string;
  readonly presentationId: string;
  readonly back: string;
  readonly notes: string | null;
  readonly shownAtMs: number;
  readonly revealedAtMs: number;
}

export interface RatingResponse {
  readonly sessionId: string;
  readonly entryId: string;
  readonly learningItemId: string;
  readonly rating: 1 | 2 | 3 | 4;
  readonly stateRevision: number;
  readonly dueAtMs: number;
  readonly newlyJoined: number;
  readonly sessionRevision: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function assertRatingResponse(value: unknown): asserts value is RatingResponse {
  if (
    !isRecord(value) ||
    typeof value["sessionId"] !== "string" ||
    value["sessionId"].length === 0 ||
    typeof value["entryId"] !== "string" ||
    value["entryId"].length === 0 ||
    typeof value["learningItemId"] !== "string" ||
    value["learningItemId"].length === 0 ||
    ![1, 2, 3, 4].includes(value["rating"] as number) ||
    !isNonnegativeSafeInteger(value["stateRevision"]) ||
    !isNonnegativeSafeInteger(value["dueAtMs"]) ||
    !isNonnegativeSafeInteger(value["newlyJoined"]) ||
    !isNonnegativeSafeInteger(value["sessionRevision"])
  ) {
    throw new Error("RATING_RESPONSE_INVALID");
  }
}

export function serializeRatingResponse(response: RatingResponse): string {
  assertRatingResponse(response);
  return JSON.stringify({
    sessionId: response.sessionId,
    entryId: response.entryId,
    learningItemId: response.learningItemId,
    rating: response.rating,
    stateRevision: response.stateRevision,
    dueAtMs: response.dueAtMs,
    newlyJoined: response.newlyJoined,
    sessionRevision: response.sessionRevision,
  });
}

export function parseRatingResponse(serialized: string): RatingResponse {
  try {
    const value: unknown = JSON.parse(serialized);
    assertRatingResponse(value);
    return {
      sessionId: value.sessionId,
      entryId: value.entryId,
      learningItemId: value.learningItemId,
      rating: value.rating,
      stateRevision: value.stateRevision,
      dueAtMs: value.dueAtMs,
      newlyJoined: value.newlyJoined,
      sessionRevision: value.sessionRevision,
    };
  } catch {
    throw new Error("RATING_RESPONSE_INVALID");
  }
}

export function calculateReviewDuration(
  revealedAtMs: number,
  ratedAtMs: number,
): number {
  if (
    !isNonnegativeSafeInteger(revealedAtMs) ||
    !isNonnegativeSafeInteger(ratedAtMs) ||
    ratedAtMs < revealedAtMs
  ) {
    throw new RangeError("REVIEW_RATING_TIME_INVALID");
  }

  return ratedAtMs - revealedAtMs;
}
