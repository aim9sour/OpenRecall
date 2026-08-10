import { computeOptimalSteps } from "@open-spaced-repetition/binding";
import { FSRS6_MANIFEST } from "@openrecall/scheduler";
import { describe, expect, it } from "vitest";

function csv(rows: readonly string[]): Buffer {
  return Buffer.from([
    "card_id,review_time,review_rating,review_state,review_duration",
    ...rows,
  ].join("\n"), "utf8");
}

describe("installed computeOptimalSteps binding", () => {
  it("matches the upstream-supported 100-sequence threshold fixture", () => {
    const data = csv(Array.from({ length: 100 }, (_, index) => [
      `${index},0,1,0,0`,
      `${index},60000,3,1,0`,
    ]).flat());

    const result = computeOptimalSteps(
      data,
      0.9,
      [...FSRS6_MANIFEST.defaultWeights],
    );

    expect(result.again).toMatchObject({ count: 100, retention: 1 });
    expect(result.recommendedLearningSteps).toEqual([]);
  });

  it("rejects malformed CSV and a parameter array shorter than 21", () => {
    expect(() => computeOptimalSteps(csv(["broken"]), 0.9, 0.1542)).toThrow();
    expect(() => computeOptimalSteps(
      csv(["card-1,0,1,0,0", "card-1,60000,3,1,0"]),
      0.9,
      FSRS6_MANIFEST.defaultWeights.slice(0, 20),
    )).toThrow(/at least 21/i);
  });
});
