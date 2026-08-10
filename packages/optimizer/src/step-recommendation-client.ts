import { Worker } from "node:worker_threads";
import {
  StepRatingStatisticsSchema,
  StepRecommendationValuesSchema,
} from "@openrecall/contracts";
import { FSRS6_MANIFEST } from "@openrecall/scheduler";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type {
  ComputedStepRecommendation,
  ValidatedStepReview,
} from "./types.js";

export interface StepRecommendationWorkerData {
  readonly validRows: readonly ValidatedStepReview[];
  readonly requestedRetention: number;
  readonly weights: readonly number[];
  readonly cancelBuffer: SharedArrayBuffer;
}

export interface StepRecommendationWorkerLike {
  on(event: "message", listener: (message: unknown) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  terminate(): Promise<number>;
}

interface StepRecommendationClientDependencies {
  readonly createWorker?: (
    data: StepRecommendationWorkerData,
  ) => StepRecommendationWorkerLike;
  readonly cancelGraceMs?: number;
}

export interface ComputeStepRecommendationInput {
  readonly validRows: readonly ValidatedStepReview[];
  readonly requestedRetention: number;
  readonly weights: readonly number[];
  readonly signal: AbortSignal;
}

const NullableStatsSchema = Type.Union([
  StepRatingStatisticsSchema,
  Type.Null(),
]);
const ComputedStepRecommendationSchema = Type.Object(
  {
    learning: StepRecommendationValuesSchema,
    relearning: StepRecommendationValuesSchema,
    statistics: Type.Object(
      {
        again: NullableStatsSchema,
        hard: NullableStatsSchema,
        good: NullableStatsSchema,
        againThenGood: NullableStatsSchema,
        goodThenAgain: NullableStatsSchema,
        relearning: NullableStatsSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

function isValidRow(row: unknown): row is ValidatedStepReview {
  if (typeof row !== "object" || row === null) return false;
  const value = row as Partial<ValidatedStepReview>;
  return (
    typeof value.reviewLogId === "string" &&
    value.reviewLogId.length > 0 &&
    typeof value.cardId === "string" &&
    value.cardId.trim().length > 0 &&
    Number.isSafeInteger(value.reviewTimeMs) &&
    (value.reviewTimeMs ?? -1) >= 0 &&
    Number.isInteger(value.rating) &&
    (value.rating ?? 0) >= 1 &&
    (value.rating ?? 5) <= 4 &&
    Number.isInteger(value.state) &&
    (value.state ?? -1) >= 0 &&
    (value.state ?? 4) <= 3 &&
    Number.isSafeInteger(value.reviewDurationMs) &&
    (value.reviewDurationMs ?? -1) >= 0
  );
}

export function isValidStepRecommendationWorkerData(
  data: Partial<StepRecommendationWorkerData>,
): data is StepRecommendationWorkerData {
  return (
    Array.isArray(data.validRows) &&
    data.validRows.length > 0 &&
    data.validRows.every(isValidRow) &&
    typeof data.requestedRetention === "number" &&
    Number.isFinite(data.requestedRetention) &&
    data.requestedRetention > 0 &&
    data.requestedRetention < 1 &&
    Array.isArray(data.weights) &&
    data.weights.length === FSRS6_MANIFEST.defaultWeights.length &&
    data.weights.every(
      (weight) => typeof weight === "number" && Number.isFinite(weight),
    ) &&
    data.cancelBuffer instanceof SharedArrayBuffer
  );
}

function validateResult(value: unknown): ComputedStepRecommendation {
  if (!Value.Check(ComputedStepRecommendationSchema, value)) {
    throw new Error("STEP_RECOMMENDATION_OUTPUT_INVALID");
  }
  return structuredClone(value);
}

function defaultCreateWorker(
  data: StepRecommendationWorkerData,
): StepRecommendationWorkerLike {
  return new Worker(
    new URL("./step-recommendation-worker.ts", import.meta.url),
    {
      execArgv: ["--import", "tsx"],
      workerData: data,
    },
  );
}

export function computeStepRecommendation(
  input: ComputeStepRecommendationInput,
  dependencies: StepRecommendationClientDependencies = {},
): Promise<ComputedStepRecommendation> {
  if (input.signal.aborted) {
    return Promise.reject(new Error("STEP_RECOMMENDATION_CANCELLED"));
  }
  const cancelBuffer = new SharedArrayBuffer(4);
  const workerData: StepRecommendationWorkerData = {
    validRows: input.validRows,
    requestedRetention: input.requestedRetention,
    weights: input.weights,
    cancelBuffer,
  };
  if (!isValidStepRecommendationWorkerData(workerData)) {
    return Promise.reject(new Error("STEP_RECOMMENDATION_INPUT_INVALID"));
  }

  const worker = (dependencies.createWorker ?? defaultCreateWorker)(workerData);
  const cancelFlag = new Int32Array(cancelBuffer);

  return new Promise<ComputedStepRecommendation>((resolve, reject) => {
    let settled = false;
    let cancelTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      input.signal.removeEventListener("abort", abort);
      if (cancelTimer !== undefined) clearTimeout(cancelTimer);
    };
    const finish = (
      outcome:
        | { readonly kind: "resolve"; readonly value: ComputedStepRecommendation }
        | { readonly kind: "reject"; readonly code: string },
    ) => {
      if (settled) return;
      settled = true;
      cleanup();
      void worker.terminate().catch(() => undefined);
      if (outcome.kind === "resolve") resolve(outcome.value);
      else reject(new Error(outcome.code));
    };
    const fail = (code: string) => finish({ kind: "reject", code });
    const abort = () => {
      if (settled) return;
      Atomics.store(cancelFlag, 0, 1);
      Atomics.notify(cancelFlag, 0);
      cancelTimer = setTimeout(() => {
        void worker
          .terminate()
          .catch(() => undefined)
          .finally(() => fail("STEP_RECOMMENDATION_CANCELLED"));
      }, dependencies.cancelGraceMs ?? 100);
      cancelTimer.unref?.();
    };

    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) abort();

    worker.on("message", (message) => {
      if (settled) return;
      if (
        typeof message !== "object" ||
        message === null ||
        !("type" in message) ||
        typeof message.type !== "string"
      ) {
        fail("STEP_RECOMMENDATION_WORKER_MESSAGE_INVALID");
        return;
      }
      if (message.type === "cancelled") {
        fail("STEP_RECOMMENDATION_CANCELLED");
        return;
      }
      if (message.type === "error") {
        const code =
          "code" in message &&
          (message.code === "STEP_RECOMMENDATION_WORKER_DATA_INVALID" ||
            message.code === "STEP_RECOMMENDATION_ANALYSIS_FAILED")
            ? message.code
            : "STEP_RECOMMENDATION_ANALYSIS_FAILED";
        fail(code);
        return;
      }
      if (message.type === "result" && "result" in message) {
        if (input.signal.aborted || Atomics.load(cancelFlag, 0) !== 0) {
          fail("STEP_RECOMMENDATION_CANCELLED");
          return;
        }
        try {
          finish({ kind: "resolve", value: validateResult(message.result) });
        } catch {
          fail("STEP_RECOMMENDATION_OUTPUT_INVALID");
        }
        return;
      }
      fail("STEP_RECOMMENDATION_WORKER_MESSAGE_INVALID");
    });
    worker.on("error", () =>
      fail(
        input.signal.aborted
          ? "STEP_RECOMMENDATION_CANCELLED"
          : "STEP_RECOMMENDATION_WORKER_CRASHED",
      ),
    );
    worker.on("exit", () =>
      fail(
        input.signal.aborted
          ? "STEP_RECOMMENDATION_CANCELLED"
          : "STEP_RECOMMENDATION_WORKER_EXITED",
      ),
    );
  });
}
