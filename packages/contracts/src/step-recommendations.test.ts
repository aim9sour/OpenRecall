import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  StepRecommendationApplySchema,
  StepRecommendationRestoreSchema,
} from "./step-recommendations.js";

describe("step recommendation contracts", () => {
  it("accepts only unique learning and relearning application parts", () => {
    expect(Value.Check(StepRecommendationApplySchema, {
      parts: ["learning", "relearning"],
      revisionToken: "a".repeat(64),
    })).toBe(true);
    for (const parts of [[], ["weights"], ["learning", "learning"]]) {
      expect(Value.Check(StepRecommendationApplySchema, {
        parts,
        revisionToken: "a".repeat(64),
      })).toBe(false);
    }
  });

  it("keeps restore tokens opaque and rejects extra request fields", () => {
    expect(Value.Check(StepRecommendationRestoreSchema, {
      revisionToken: "b".repeat(64),
    })).toBe(true);
    expect(Value.Check(StepRecommendationRestoreSchema, {
      revisionToken: "b".repeat(64),
      runId: "client-controlled",
    })).toBe(false);
  });
});
