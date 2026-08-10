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
    await expect(computeParameters([item], {
      enableShortTerm: true,
      numRelearningSteps: 1,
      trainingConfig: OFFICIAL_OPTIMIZER_TRAINING_CONFIG,
    })).resolves.toHaveLength(21);
  }, 180_000);
});
