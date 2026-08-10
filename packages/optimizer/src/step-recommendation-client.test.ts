import { EventEmitter } from "node:events";
import { FSRS6_MANIFEST } from "@openrecall/scheduler";
import { describe, expect, it, vi } from "vitest";
import {
  computeStepRecommendation,
  type StepRecommendationWorkerData,
  type StepRecommendationWorkerLike,
} from "./step-recommendation-client.js";
import type { ValidatedStepReview } from "./types.js";

const validRows: readonly ValidatedStepReview[] = [
  {
    reviewLogId: "log-1",
    cardId: "card-1",
    reviewTimeMs: 0,
    rating: 1,
    state: 0,
    reviewDurationMs: 0,
  },
  {
    reviewLogId: "log-2",
    cardId: "card-1",
    reviewTimeMs: 60_000,
    rating: 3,
    state: 1,
    reviewDurationMs: 500,
  },
];

const validResult = {
  learning: {
    rawSeconds: [80],
    applicableMinutes: [1],
    belowResolutionSeconds: [],
  },
  relearning: {
    rawSeconds: [],
    applicableMinutes: [],
    belowResolutionSeconds: [],
  },
  statistics: {
    again: {
      count: 100,
      delayQ1Seconds: 60,
      delayQ2Seconds: 60,
      delayQ3Seconds: 60,
      retentionQ1: 1,
      retentionQ2: 1,
      retentionQ3: 1,
      retentionQ4: 1,
      retention: 1,
      stabilitySeconds: 86_400,
    },
    hard: null,
    good: null,
    againThenGood: null,
    goodThenAgain: null,
    relearning: null,
  },
} as const;

class FakeWorker extends EventEmitter implements StepRecommendationWorkerLike {
  terminated = false;
  readonly data: StepRecommendationWorkerData;

  constructor(data: StepRecommendationWorkerData) {
    super();
    this.data = data;
  }

  terminate(): Promise<number> {
    this.terminated = true;
    return Promise.resolve(0);
  }
}

function input(signal = new AbortController().signal) {
  return {
    validRows,
    requestedRetention: 0.9,
    weights: [...FSRS6_MANIFEST.defaultWeights],
    signal,
  };
}

describe("computeStepRecommendation worker protocol", () => {
  it("passes validated structured data and accepts a closed valid result", async () => {
    let received!: StepRecommendationWorkerData;
    const promise = computeStepRecommendation(input(), {
      createWorker(data) {
        received = data;
        const worker = new FakeWorker(data);
        queueMicrotask(() => worker.emit("message", { type: "result", result: validResult }));
        return worker;
      },
    });

    await expect(promise).resolves.toEqual(validResult);
    expect(received.validRows).toEqual(validRows);
    expect(received.requestedRetention).toBe(0.9);
    expect(received.weights).toEqual(FSRS6_MANIFEST.defaultWeights);
    expect(received.cancelBuffer).toBeInstanceOf(SharedArrayBuffer);
  });

  it("rejects cancellation before start without creating a worker", async () => {
    const controller = new AbortController();
    controller.abort();
    const createWorker = vi.fn();

    await expect(
      computeStepRecommendation(input(controller.signal), { createWorker }),
    ).rejects.toThrow("STEP_RECOMMENDATION_CANCELLED");
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("sets the cancellation flag and terminates after the grace period", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      let worker!: FakeWorker;
      const promise = computeStepRecommendation(input(controller.signal), {
        cancelGraceMs: 25,
        createWorker(data) {
          worker = new FakeWorker(data);
          return worker;
        },
      });

      controller.abort();
      expect(Atomics.load(new Int32Array(worker.data.cancelBuffer), 0)).toBe(1);
      const rejection = expect(promise).rejects.toThrow(
        "STEP_RECOMMENDATION_CANCELLED",
      );
      await vi.advanceTimersByTimeAsync(25);
      await rejection;
      expect(worker.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["invalid message", (worker: FakeWorker) => worker.emit("message", { nope: true }), "STEP_RECOMMENDATION_WORKER_MESSAGE_INVALID"],
    ["reported failure", (worker: FakeWorker) => worker.emit("message", { type: "error", code: "STEP_RECOMMENDATION_ANALYSIS_FAILED" }), "STEP_RECOMMENDATION_ANALYSIS_FAILED"],
    ["native crash", (worker: FakeWorker) => worker.emit("error", new Error("private native text")), "STEP_RECOMMENDATION_WORKER_CRASHED"],
    ["nonzero exit", (worker: FakeWorker) => worker.emit("exit", 17), "STEP_RECOMMENDATION_WORKER_EXITED"],
  ] as const)("maps %s to a stable code", async (_name, emit, code) => {
    const promise = computeStepRecommendation(input(), {
      createWorker(data) {
        const worker = new FakeWorker(data);
        queueMicrotask(() => emit(worker));
        return worker;
      },
    });

    await expect(promise).rejects.toThrow(code);
  });

  it("rejects malformed result data and never exposes it", async () => {
    const promise = computeStepRecommendation(input(), {
      createWorker(data) {
        const worker = new FakeWorker(data);
        queueMicrotask(() => worker.emit("message", {
          type: "result",
          result: { ...validResult, privateCsv: "secret" },
        }));
        return worker;
      },
    });

    await expect(promise).rejects.toThrow("STEP_RECOMMENDATION_OUTPUT_INVALID");
  });

  it("validates rows, retention, and all 21 weights before worker creation", async () => {
    const createWorker = vi.fn();
    for (const invalid of [
      { ...input(), validRows: [] },
      { ...input(), requestedRetention: 1 },
      { ...input(), weights: FSRS6_MANIFEST.defaultWeights.slice(0, 20) },
      { ...input(), weights: FSRS6_MANIFEST.defaultWeights.map((value, index) => index === 2 ? Number.NaN : value) },
    ]) {
      await expect(
        computeStepRecommendation(invalid, { createWorker }),
      ).rejects.toThrow("STEP_RECOMMENDATION_INPUT_INVALID");
    }
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("runs the real isolated worker without exposing its in-memory CSV", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => [
      {
        ...validRows[0]!,
        reviewLogId: `log-${index}-1`,
        cardId: `card-${index}`,
      },
      {
        ...validRows[1]!,
        reviewLogId: `log-${index}-2`,
        cardId: `card-${index}`,
      },
    ]).flat();

    await expect(
      computeStepRecommendation({ ...input(), validRows: rows }),
    ).resolves.toMatchObject({
      learning: { rawSeconds: [] },
      statistics: { again: { count: 100, retention: 1 } },
    });
  }, 15_000);
});
