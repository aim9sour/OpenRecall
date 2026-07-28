import {
  createInitialState,
  DEFAULT_SCHEDULER_SETTINGS,
  FSRS6_MANIFEST,
  previewRatings,
} from "@openrecall/scheduler";

export interface OptimizerResult {
  readonly weights: readonly number[];
  readonly logLoss: number;
  readonly rmseBins: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateOptimizerOutput(value: unknown): OptimizerResult {
  if (
    !isRecord(value) ||
    !Array.isArray(value["weights"]) ||
    typeof value["logLoss"] !== "number" ||
    typeof value["rmseBins"] !== "number"
  ) {
    throw new Error("OPTIMIZER_OUTPUT_INVALID");
  }
  const weights = value["weights"];
  if (weights.length !== FSRS6_MANIFEST.defaultWeights.length) {
    throw new Error("OPTIMIZER_OUTPUT_WEIGHT_COUNT_INVALID");
  }
  if (
    weights.some(
      (weight) => typeof weight !== "number" || !Number.isFinite(weight),
    )
  ) {
    throw new Error("OPTIMIZER_OUTPUT_NON_FINITE");
  }
  if (
    !Number.isFinite(value["logLoss"]) ||
    value["logLoss"] < 0 ||
    !Number.isFinite(value["rmseBins"]) ||
    value["rmseBins"] < 0
  ) {
    throw new Error("OPTIMIZER_EVALUATION_INVALID");
  }

  const result: OptimizerResult = {
    weights: [...(weights as number[])],
    logLoss: value["logLoss"],
    rmseBins: value["rmseBins"],
  };
  let roundTrip: unknown;
  try {
    roundTrip = JSON.parse(JSON.stringify(result));
  } catch {
    throw new Error("OPTIMIZER_OUTPUT_SERIALIZATION_INVALID");
  }
  if (JSON.stringify(roundTrip) !== JSON.stringify(result)) {
    throw new Error("OPTIMIZER_OUTPUT_SERIALIZATION_INVALID");
  }

  try {
    previewRatings(createInitialState(0), {
      nowMs: 0,
      studyDay: { timeZone: "UTC", boundaryMinutes: 0 },
      settings: DEFAULT_SCHEDULER_SETTINGS,
      weights: result.weights,
      parameterProfileId: "optimizer-validation",
    });
  } catch {
    throw new Error("OPTIMIZER_OUTPUT_INCOMPATIBLE");
  }
  return result;
}
