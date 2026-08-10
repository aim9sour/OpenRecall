import {
  computeParameters,
  evaluateWithTimeSeriesSplits,
} from "@open-spaced-repetition/binding";
import { parentPort, workerData } from "node:worker_threads";
import { toBindingItems } from "./binding-adapter.js";
import type { OptimizerWorkerData } from "./optimizer-client.js";
import { validateOptimizerTrainingConfig } from "./validate-settings.js";

function cancelled(flag: Int32Array): boolean {
  return Atomics.load(flag, 0) !== 0;
}

function evaluationInsufficient(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : String(error);
  return /NotEnoughData|not enough data|insufficient/i.test(text);
}

async function run(): Promise<void> {
  const data = workerData as Partial<OptimizerWorkerData>;
  const numRelearningSteps = data.numRelearningSteps;
  let trainingConfig;
  try {
    trainingConfig = validateOptimizerTrainingConfig(data.trainingConfig);
  } catch {
    parentPort?.postMessage({
      type: "error",
      code: "OPTIMIZER_WORKER_DATA_INVALID",
    });
    return;
  }
  if (
    !Array.isArray(data.examples) ||
    typeof data.enableShortTerm !== "boolean" ||
    typeof numRelearningSteps !== "number" ||
    !Number.isInteger(numRelearningSteps) ||
    numRelearningSteps < 0 ||
    !(data.cancelBuffer instanceof SharedArrayBuffer)
  ) {
    parentPort?.postMessage({
      type: "error",
      code: "OPTIMIZER_WORKER_DATA_INVALID",
    });
    return;
  }
  const cancelFlag = new Int32Array(data.cancelBuffer);
  if (cancelled(cancelFlag)) {
    parentPort?.postMessage({ type: "cancelled" });
    return;
  }
  const items = toBindingItems(data.examples);
  const progress = (current: number, total: number): boolean => {
    const fraction =
      total <= 0 ? 0 : Math.max(0, Math.min(1, current / total));
    parentPort?.postMessage({ type: "progress", fraction });
    return !cancelled(cancelFlag);
  };
  const options = {
    enableShortTerm: data.enableShortTerm,
    numRelearningSteps,
    trainingConfig,
    // Upstream defines this as a cooperative progress polling interval,
    // not as a deadline for the optimization run.
    timeout: 250,
    progress,
  };

  let weights: number[];
  try {
    weights = await computeParameters(items, options);
  } catch (error) {
    if (cancelled(cancelFlag)) {
      parentPort?.postMessage({ type: "cancelled" });
      return;
    }
    parentPort?.postMessage({
      type: "error",
      code: "OPTIMIZER_TRAINING_FAILED",
    });
    return;
  }
  if (cancelled(cancelFlag)) {
    parentPort?.postMessage({ type: "cancelled" });
    return;
  }

  try {
    const evaluation = await evaluateWithTimeSeriesSplits(items, options);
    if (cancelled(cancelFlag)) {
      parentPort?.postMessage({ type: "cancelled" });
      return;
    }
    parentPort?.postMessage({
      type: "result",
      result: {
        weights,
        logLoss: evaluation.logLoss,
        rmseBins: evaluation.rmseBins,
      },
    });
  } catch (error) {
    if (cancelled(cancelFlag)) {
      parentPort?.postMessage({ type: "cancelled" });
      return;
    }
    parentPort?.postMessage({
      type: "error",
      code: evaluationInsufficient(error)
        ? "OPTIMIZER_EVALUATION_INSUFFICIENT"
        : "OPTIMIZER_TRAINING_FAILED",
    });
  }
}

void run();
