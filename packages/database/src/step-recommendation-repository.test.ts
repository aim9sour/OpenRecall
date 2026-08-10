import type {
  StepRecommendationInputSnapshot,
  StepRecommendationResult,
} from "@openrecall/contracts";
import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./open-database.js";
import { StepRecommendationRepository } from "./step-recommendation-repository.js";

const fingerprint = "a".repeat(64);
const exclusions = {
  invalidCardId: 0, invalidTimestamp: 0, invalidRating: 0,
  invalidState: 0, missingDuration: 0, nonIncreasingOrder: 0,
};
const snapshot: StepRecommendationInputSnapshot = {
  schedulerSettings: {
    requestedRetention: 0.9, maximumIntervalDays: 36_500,
    enableFuzz: false, enableShortTerm: true,
    learningStepsMinutes: [1, 10], relearningStepsMinutes: [10],
  },
  weights: Array.from({ length: 21 }, () => 0.1),
  parameterProfileId: "official-fsrs6-v1",
  selectedScopeRevisionMs: 0,
  effectiveSettingsSource: { kind: "global", settingsId: "scheduler-settings-global", updatedAtMs: 0 },
  packageVersion: "0.5.0", algorithmVersion: "6.0", adapterVersion: 1, schemaVersion: 1,
  rawReviewCount: 200, validReviewCount: 200, validSequenceCount: 100,
  excludedSequenceCount: 0, exclusions, sourceReviewCutoffMs: 5_000,
  sourceFingerprint: fingerprint,
};
const emptyValues = { rawSeconds: [], applicableMinutes: [], belowResolutionSeconds: [] };
const result: StepRecommendationResult = {
  learning: emptyValues, relearning: emptyValues,
  statistics: { again: null, hard: null, good: null, againThenGood: null, goodThenAgain: null, relearning: null },
  rawReviewCount: 200, validReviewCount: 200, validSequenceCount: 100,
  excludedSequenceCount: 0, exclusions,
};

describe("StepRecommendationRepository", () => {
  it("persists lifecycle, rotates opaque tokens, and guards apply and restore", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      const repository = new StepRecommendationRepository(db);
      try {
        const run = repository.insertRunning({
          id: "a8f65aa8-122b-41e1-985c-61cd3cbb3210",
          scope: { scopeType: "global", sectionId: null },
          inputSnapshot: snapshot,
          sourceReviewCutoffMs: 5_000,
          sourceFingerprint: fingerprint,
          createdAtMs: 1_000,
          startedAtMs: 1_000,
        });
        expect(run.status).toBe("running");
        expect(run.revisionToken).toMatch(/^[0-9a-f]{64}$/u);
        repository.markSucceeded(run.id, result, 2_000);
        const succeeded = repository.get(run.id)!;
        expect(succeeded.result).toEqual(result);

        const applied = repository.recordApplication({
          runId: run.id,
          expectedRevisionToken: succeeded.revisionToken,
          parts: ["learning"],
          priorSteps: { learning: [1, 10], relearning: [10] },
          appliedSteps: { learning: [1, 96], relearning: [10] },
          appliedAtMs: 3_000,
        });
        expect(applied.revisionToken).not.toBe(succeeded.revisionToken);
        expect(() => repository.recordApplication({
          runId: run.id,
          expectedRevisionToken: succeeded.revisionToken,
          parts: ["learning"],
          priorSteps: { learning: [1, 10], relearning: [10] },
          appliedSteps: { learning: [1, 96], relearning: [10] },
          appliedAtMs: 3_001,
        })).toThrow("STEP_RECOMMENDATION_CONFLICT");
        const restored = repository.recordRestore({
          runId: run.id,
          expectedRevisionToken: applied.revisionToken,
          restoredAtMs: 4_000,
        });
        expect(restored.restoredAtMs).toBe(4_000);
        expect(restored.revisionToken).not.toBe(applied.revisionToken);
      } finally { db.close(); }
    });
  });

  it("recovers interrupted running rows without inventing a result", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      const repository = new StepRecommendationRepository(db);
      try {
        repository.insertRunning({
          id: "b8f65aa8-122b-41e1-985c-61cd3cbb3210",
          scope: { scopeType: "global", sectionId: null }, inputSnapshot: snapshot,
          sourceReviewCutoffMs: 5_000, sourceFingerprint: fingerprint,
          createdAtMs: 1_000, startedAtMs: 1_000,
        });
        expect(repository.recoverInterrupted(2_000)).toBe(1);
        expect(repository.get("b8f65aa8-122b-41e1-985c-61cd3cbb3210")).toMatchObject({
          status: "failed", errorCode: "STEP_RECOMMENDATION_INTERRUPTED", result: null,
        });
      } finally { db.close(); }
    });
  });
});
