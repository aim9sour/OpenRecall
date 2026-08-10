import {
  computeParameters,
  FSRSBindingItem,
  FSRSBindingReview,
} from "@open-spaced-repetition/binding";
import { describe, expect, it } from "vitest";
import { OFFICIAL_OPTIMIZER_TRAINING_CONFIG } from "./manifest.js";

describe("installed optimizer binding", () => {
  it("accepts OpenRecall's complete official training configuration", async () => {
    const item = new FSRSBindingItem([
      new FSRSBindingReview(3, 0),
      new FSRSBindingReview(4, 1),
    ]);
    const explicit = await computeParameters([item], {
      enableShortTerm: true,
      numRelearningSteps: 1,
      trainingConfig: OFFICIAL_OPTIMIZER_TRAINING_CONFIG,
    });
    const upstreamDefaults = await computeParameters([item], {
      enableShortTerm: true,
      numRelearningSteps: 1,
    });

    expect(explicit).toHaveLength(21);
    expect(explicit).toEqual(upstreamDefaults);
  }, 180_000);
});
