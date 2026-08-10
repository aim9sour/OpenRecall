import {
  computeOptimalSteps,
  type StepRatingStats,
} from "@open-spaced-repetition/binding";
import { parentPort, workerData } from "node:worker_threads";
import {
  convertRecommendedSeconds,
  encodeStepRecommendationCsv,
} from "./prepare-step-recommendation.js";
import {
  isValidStepRecommendationWorkerData,
  type StepRecommendationWorkerData,
} from "./step-recommendation-client.js";
import type { ComputedStepRecommendation } from "./types.js";

function cancelled(flag: Int32Array): boolean {
  return Atomics.load(flag, 0) !== 0;
}

function finiteNonnegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("STEP_RECOMMENDATION_OUTPUT_INVALID");
  }
  return value;
}

function normalizeStats(
  value: StepRatingStats | undefined,
): ComputedStepRecommendation["statistics"]["again"] {
  if (value === undefined) return null;
  if (!Number.isInteger(value.count) || value.count < 0) {
    throw new Error("STEP_RECOMMENDATION_OUTPUT_INVALID");
  }
  return {
    count: value.count,
    delayQ1Seconds: finiteNonnegative(value.delayQ1),
    delayQ2Seconds: finiteNonnegative(value.delayQ2),
    delayQ3Seconds: finiteNonnegative(value.delayQ3),
    retentionQ1: finiteNonnegative(value.r1),
    retentionQ2: finiteNonnegative(value.r2),
    retentionQ3: finiteNonnegative(value.r3),
    retentionQ4: finiteNonnegative(value.r4),
    retention: finiteNonnegative(value.retention),
    stabilitySeconds: finiteNonnegative(value.stability),
  };
}

function run(): void {
  const data = workerData as Partial<StepRecommendationWorkerData>;
  if (!isValidStepRecommendationWorkerData(data)) {
    parentPort?.postMessage({
      type: "error",
      code: "STEP_RECOMMENDATION_WORKER_DATA_INVALID",
    });
    return;
  }
  const cancelFlag = new Int32Array(data.cancelBuffer);
  if (cancelled(cancelFlag)) {
    parentPort?.postMessage({ type: "cancelled" });
    return;
  }

  try {
    const csvBytes = encodeStepRecommendationCsv(data.validRows);
    const result = computeOptimalSteps(
      csvBytes,
      data.requestedRetention,
      [...data.weights],
    );
    if (cancelled(cancelFlag)) {
      parentPort?.postMessage({ type: "cancelled" });
      return;
    }
    const normalized: ComputedStepRecommendation = {
      learning: convertRecommendedSeconds(result.recommendedLearningSteps),
      relearning: convertRecommendedSeconds(result.recommendedRelearningSteps),
      statistics: {
        again: normalizeStats(result.again),
        hard: normalizeStats(result.hard),
        good: normalizeStats(result.good),
        againThenGood: normalizeStats(result.againThenGood),
        goodThenAgain: normalizeStats(result.goodThenAgain),
        relearning: normalizeStats(result.relearning),
      },
    };
    parentPort?.postMessage({ type: "result", result: normalized });
  } catch {
    parentPort?.postMessage({
      type: "error",
      code: "STEP_RECOMMENDATION_ANALYSIS_FAILED",
    });
  }
}

run();
