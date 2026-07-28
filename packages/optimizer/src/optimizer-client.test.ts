import { EventEmitter } from "node:events";
import {
  DEFAULT_SCHEDULER_SETTINGS,
  FSRS6_MANIFEST,
} from "@openrecall/scheduler";
import { describe, expect, it, vi } from "vitest";
import {
  trainOptimizer,
  type OptimizerWorkerData,
  type OptimizerWorkerLike,
} from "./optimizer-client.js";
import { validateOptimizerOutput } from "./validate-output.js";
import type { OptimizerExample } from "./types.js";

const examples: readonly OptimizerExample[] = [
  {
    learningItemId: "item-a",
    targetReviewLogId: "log-2",
    reviews: [
      { rating: 3, deltaDays: 0 },
      { rating: 4, deltaDays: 2 },
    ],
  },
];

const validResult = {
  weights: [...FSRS6_MANIFEST.defaultWeights],
  logLoss: 0.25,
  rmseBins: 0.1,
};

class FakeWorker extends EventEmitter implements OptimizerWorkerLike {
  terminated = false;
  readonly data: OptimizerWorkerData;

  constructor(data: OptimizerWorkerData) {
    super();
    this.data = data;
  }

  terminate(): Promise<number> {
    this.terminated = true;
    return Promise.resolve(0);
  }
}

function input(signal: AbortSignal, onProgress = vi.fn()) {
  return {
    examples,
    enableShortTerm: true,
    numRelearningSteps:
      DEFAULT_SCHEDULER_SETTINGS.relearningStepsMinutes.length,
    signal,
    onProgress,
  };
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe("trainOptimizer worker protocol", () => {
  it("reports monotonic coarse progress and validates a successful result", async () => {
    const progress = vi.fn();
    const controller = new AbortController();
    const resultPromise = trainOptimizer(input(controller.signal, progress), {
      createWorker(data) {
        const worker = new FakeWorker(data);
        queueMicrotask(() => {
          worker.emit("message", { type: "progress", fraction: 0.1 });
          worker.emit("message", { type: "progress", fraction: 0.05 });
          worker.emit("message", { type: "progress", fraction: 0.105 });
          worker.emit("message", { type: "progress", fraction: 0.2 });
          worker.emit("message", { type: "result", result: validResult });
        });
        return worker;
      },
    });

    await expect(resultPromise).resolves.toEqual(validResult);
    expect(progress.mock.calls.map(([fraction]) => fraction)).toEqual([
      0.1,
      0.2,
      1,
    ]);
  });

  it("rejects cancellation before start without creating a worker", async () => {
    const controller = new AbortController();
    controller.abort();
    const createWorker = vi.fn();

    await expect(
      trainOptimizer(input(controller.signal), { createWorker }),
    ).rejects.toThrow("OPTIMIZER_CANCELLED");
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("sets the shared cooperative flag when cancelled during training", async () => {
    const controller = new AbortController();
    let worker!: FakeWorker;
    const resultPromise = trainOptimizer(input(controller.signal), {
      createWorker(data) {
        worker = new FakeWorker(data);
        return worker;
      },
    });

    controller.abort();
    expect(
      Atomics.load(new Int32Array(worker.data.cancelBuffer), 0),
    ).toBe(1);
    worker.emit("message", { type: "cancelled" });
    await expect(resultPromise).rejects.toThrow("OPTIMIZER_CANCELLED");
    expect(worker.terminated).toBe(true);
  });

  it("maps worker errors, crashes, bad exits, and evaluation insufficiency", async () => {
    const scenarios: Array<{
      readonly emit: (worker: FakeWorker) => void;
      readonly code: string;
    }> = [
      {
        emit: (worker) =>
          worker.emit("message", {
            type: "error",
            code: "OPTIMIZER_EVALUATION_INSUFFICIENT",
          }),
        code: "OPTIMIZER_EVALUATION_INSUFFICIENT",
      },
      {
        emit: (worker) => worker.emit("error", new Error("native crash")),
        code: "OPTIMIZER_WORKER_CRASHED",
      },
      {
        emit: (worker) => worker.emit("exit", 17),
        code: "OPTIMIZER_WORKER_EXITED",
      },
      {
        emit: (worker) =>
          worker.emit("message", { type: "unexpected", private: "value" }),
        code: "OPTIMIZER_WORKER_MESSAGE_INVALID",
      },
    ];

    for (const scenario of scenarios) {
      const resultPromise = trainOptimizer(
        input(new AbortController().signal),
        {
          createWorker(data) {
            const worker = new FakeWorker(data);
            queueMicrotask(() => scenario.emit(worker));
            return worker;
          },
        },
      );
      await expect(resultPromise).rejects.toSatisfy(
        (error: unknown) => errorCode(error) === scenario.code,
      );
    }
  });

  it(
    "runs the real isolated worker and maps upstream insufficient evaluation data",
    async () => {
      await expect(
        trainOptimizer(input(new AbortController().signal)),
      ).rejects.toThrow("OPTIMIZER_EVALUATION_INSUFFICIENT");
    },
    15_000,
  );
});

describe("validateOptimizerOutput", () => {
  it("requires exactly 21 finite compatible weights and finite metrics", () => {
    expect(validateOptimizerOutput(validResult)).toEqual(validResult);

    for (const [value, code] of [
      [
        { ...validResult, weights: validResult.weights.slice(0, 20) },
        "OPTIMIZER_OUTPUT_WEIGHT_COUNT_INVALID",
      ],
      [
        {
          ...validResult,
          weights: validResult.weights.map((weight, index) =>
            index === 5 ? Number.NaN : weight,
          ),
        },
        "OPTIMIZER_OUTPUT_NON_FINITE",
      ],
      [
        { ...validResult, logLoss: Number.POSITIVE_INFINITY },
        "OPTIMIZER_EVALUATION_INVALID",
      ],
      [
        { ...validResult, rmseBins: -1 },
        "OPTIMIZER_EVALUATION_INVALID",
      ],
    ] as const) {
      expect(() => validateOptimizerOutput(value)).toThrow(code);
    }
  });

  it("rejects malformed result messages before exposing native details", async () => {
    const resultPromise = trainOptimizer(
      input(new AbortController().signal),
      {
        createWorker(data) {
          const worker = new FakeWorker(data);
          queueMicrotask(() =>
            worker.emit("message", {
              type: "result",
              result: { weights: "private native dump" },
            }),
          );
          return worker;
        },
      },
    );
    await expect(resultPromise).rejects.toThrow(
      "OPTIMIZER_OUTPUT_INVALID",
    );
  });
});
