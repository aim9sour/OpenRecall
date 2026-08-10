import { Worker } from "node:worker_threads";
import type { OptimizerTrainingConfig } from "@openrecall/contracts";
import type { OptimizerExample } from "./types.js";
import {
  validateOptimizerOutput,
  type OptimizerResult,
} from "./validate-output.js";

export interface OptimizerWorkerData {
  readonly examples: readonly OptimizerExample[];
  readonly enableShortTerm: boolean;
  readonly numRelearningSteps: number;
  readonly trainingConfig: OptimizerTrainingConfig;
  readonly cancelBuffer: SharedArrayBuffer;
}

export interface OptimizerWorkerLike {
  on(event: "message", listener: (message: unknown) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  terminate(): Promise<number>;
}

interface OptimizerClientDependencies {
  readonly createWorker?: (
    data: OptimizerWorkerData,
  ) => OptimizerWorkerLike;
  readonly cancelGraceMs?: number;
}

export interface TrainOptimizerInput {
  readonly examples: readonly OptimizerExample[];
  readonly enableShortTerm: boolean;
  readonly numRelearningSteps: number;
  readonly trainingConfig: OptimizerTrainingConfig;
  readonly signal: AbortSignal;
  readonly onProgress: (fraction: number) => void;
}

const MIN_PROGRESS_INCREMENT = 0.01;
const WORKER_ERROR_CODES = new Set([
  "OPTIMIZER_EVALUATION_INSUFFICIENT",
  "OPTIMIZER_TRAINING_FAILED",
  "OPTIMIZER_WORKER_DATA_INVALID",
]);

function defaultCreateWorker(
  data: OptimizerWorkerData,
): OptimizerWorkerLike {
  return new Worker(new URL("./optimizer-worker.ts", import.meta.url), {
    execArgv: ["--import", "tsx"],
    workerData: data,
  });
}

export function trainOptimizer(
  input: TrainOptimizerInput,
  dependencies: OptimizerClientDependencies = {},
): Promise<OptimizerResult> {
  if (input.signal.aborted) {
    return Promise.reject(new Error("OPTIMIZER_CANCELLED"));
  }
  if (
    !Number.isInteger(input.numRelearningSteps) ||
    input.numRelearningSteps < 0
  ) {
    return Promise.reject(
      new Error("OPTIMIZER_RELEARNING_STEPS_INVALID"),
    );
  }
  const cancelBuffer = new SharedArrayBuffer(4);
  const cancelFlag = new Int32Array(cancelBuffer);
  const workerData: OptimizerWorkerData = {
    examples: input.examples,
    enableShortTerm: input.enableShortTerm,
    numRelearningSteps: input.numRelearningSteps,
    trainingConfig: input.trainingConfig,
    cancelBuffer,
  };
  const worker = (dependencies.createWorker ?? defaultCreateWorker)(
    workerData,
  );

  return new Promise<OptimizerResult>((resolve, reject) => {
    let settled = false;
    let lastProgress = 0;
    let cancelTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      input.signal.removeEventListener("abort", abort);
      if (cancelTimer !== undefined) clearTimeout(cancelTimer);
    };
    const finish = (
      outcome:
        | { readonly kind: "resolve"; readonly result: OptimizerResult }
        | { readonly kind: "reject"; readonly error: Error },
    ) => {
      if (settled) return;
      settled = true;
      cleanup();
      void worker.terminate().catch(() => undefined);
      if (outcome.kind === "resolve") resolve(outcome.result);
      else reject(outcome.error);
    };
    const fail = (code: string) =>
      finish({ kind: "reject", error: new Error(code) });
    const abort = () => {
      Atomics.store(cancelFlag, 0, 1);
      Atomics.notify(cancelFlag, 0);
      cancelTimer = setTimeout(
        () => fail("OPTIMIZER_CANCELLED"),
        dependencies.cancelGraceMs ?? 2_000,
      );
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
        fail("OPTIMIZER_WORKER_MESSAGE_INVALID");
        return;
      }
      if (message.type === "progress") {
        if (
          !("fraction" in message) ||
          typeof message.fraction !== "number" ||
          !Number.isFinite(message.fraction) ||
          message.fraction < 0 ||
          message.fraction > 1
        ) {
          fail("OPTIMIZER_WORKER_MESSAGE_INVALID");
          return;
        }
        if (
          message.fraction > lastProgress &&
          (message.fraction === 1 ||
            message.fraction - lastProgress >= MIN_PROGRESS_INCREMENT)
        ) {
          lastProgress = message.fraction;
          input.onProgress(message.fraction);
        }
        return;
      }
      if (message.type === "cancelled") {
        fail("OPTIMIZER_CANCELLED");
        return;
      }
      if (message.type === "error") {
        const code =
          "code" in message &&
          typeof message.code === "string" &&
          WORKER_ERROR_CODES.has(message.code)
            ? message.code
            : "OPTIMIZER_TRAINING_FAILED";
        fail(code);
        return;
      }
      if (message.type === "result" && "result" in message) {
        if (input.signal.aborted || Atomics.load(cancelFlag, 0) !== 0) {
          fail("OPTIMIZER_CANCELLED");
          return;
        }
        try {
          const result = validateOptimizerOutput(message.result);
          if (lastProgress < 1) input.onProgress(1);
          finish({ kind: "resolve", result });
        } catch (error) {
          fail(
            error instanceof Error
              ? error.message
              : "OPTIMIZER_OUTPUT_INVALID",
          );
        }
        return;
      }
      fail("OPTIMIZER_WORKER_MESSAGE_INVALID");
    });
    worker.on("error", () =>
      fail(
        input.signal.aborted
          ? "OPTIMIZER_CANCELLED"
          : "OPTIMIZER_WORKER_CRASHED",
      ),
    );
    worker.on("exit", () =>
      fail(
        input.signal.aborted
          ? "OPTIMIZER_CANCELLED"
          : "OPTIMIZER_WORKER_EXITED",
      ),
    );
  });
}
