import {
  OFFICIAL_PARAMETER_PROFILE_ID,
  openDatabase,
} from "@openrecall/database";
import type {
  OptimizerResult,
  OptimizerScope,
  TrainingSetSummary,
} from "@openrecall/optimizer";
import {
  withTempDatabase,
} from "@openrecall/test-support";
import { describe, expect, it, vi } from "vitest";
import {
  OptimizerRunService,
  type OptimizerTrainer,
} from "./optimizer-run-service.js";

const globalScope: OptimizerScope = {
  scopeType: "global",
  sectionId: null,
};
const sectionScope: OptimizerScope = {
  scopeType: "section",
  sectionId: "section-a",
};
const trainedResult: OptimizerResult = {
  weights: Array.from({ length: 21 }, (_, index) => index + 0.5),
  logLoss: 0.2,
  rmseBins: 0.1,
};

function trainingSet(eligibleExampleCount: number): TrainingSetSummary {
  return {
    rawReviewCount: eligibleExampleCount + 25,
    eligibleExampleCount,
    sourceReviewCutoffMs:
      eligibleExampleCount === 0 ? null : 50_000,
    examples: Array.from({ length: eligibleExampleCount }, (_, index) => ({
      learningItemId: `item-${index}`,
      targetReviewLogId: `log-${index}`,
      reviews: [
        { rating: 3 as const, deltaDays: 0 },
        { rating: 4 as const, deltaDays: 1 },
      ],
    })),
  };
}

function seedSection(db: ReturnType<typeof openDatabase>): void {
  db.prepare(
    `
      INSERT INTO sections (id, name, created_at_ms, updated_at_ms)
      VALUES ('section-a', 'Biology', 0, 0)
    `,
  ).run();
}

describe("OptimizerRunService", () => {
  it("reports raw and eligible counts and rejects fewer than 400 examples", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seedSection(db);
        const loadTrainingSet = vi.fn(() => trainingSet(399));
        const train = vi.fn<OptimizerTrainer>();
        const service = new OptimizerRunService(db, {
          loadTrainingSet,
          nowMs: () => 1_000,
          train,
        });

        expect(service.getEligibility(sectionScope)).toMatchObject({
          scope: sectionScope,
          rawReviewCount: 424,
          eligibleExampleCount: 399,
          minimumEligibleExamples: 400,
          canTrain: false,
          parameterSource: { kind: "official" },
        });
        expect(() => service.startRun(sectionScope)).toThrow(
          expect.objectContaining({
            message: "OPTIMIZER_INSUFFICIENT_DATA",
            rawReviewCount: 424,
            eligibleExampleCount: 399,
          }),
        );
        expect(loadTrainingSet).toHaveBeenCalledWith(sectionScope);
        expect(train).not.toHaveBeenCalled();
      } finally {
        db.close();
      }
    });
  });

  it("allows one global run, throttles persisted progress, and inserts only a candidate profile", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      try {
        let nowMs = 1_000;
        const observedProgress: number[] = [];
        const train: OptimizerTrainer = async ({ onProgress }) => {
          nowMs = 1_100;
          onProgress(0.1);
          observedProgress.push(
            Number(
              db
                .prepare(
                  "SELECT progress FROM optimizer_runs ORDER BY created_at_ms DESC LIMIT 1",
                )
                .pluck()
                .get(),
            ),
          );
          nowMs = 1_500;
          onProgress(0.2);
          observedProgress.push(
            Number(
              db
                .prepare(
                  "SELECT progress FROM optimizer_runs ORDER BY created_at_ms DESC LIMIT 1",
                )
                .pluck()
                .get(),
            ),
          );
          nowMs = 2_200;
          onProgress(0.3);
          observedProgress.push(
            Number(
              db
                .prepare(
                  "SELECT progress FROM optimizer_runs ORDER BY created_at_ms DESC LIMIT 1",
                )
                .pluck()
                .get(),
            ),
          );
          return trainedResult;
        };
        const service = new OptimizerRunService(db, {
          loadTrainingSet: () => trainingSet(400),
          nowMs: () => nowMs,
          train,
        });

        const started = service.startRun(globalScope);
        expect(started).toMatchObject({
          scopeType: "global",
          sectionId: null,
          status: "running",
          rawReviewCount: 425,
          eligibleExampleCount: 400,
        });
        expect(() => service.startRun(globalScope)).toThrow(
          "OPTIMIZER_RUN_CONFLICT",
        );
        await service.whenIdle();

        expect(observedProgress).toEqual([0.1, 0.1, 0.3]);
        expect(service.getRun(started.id)).toMatchObject({
          status: "succeeded",
          progress: 1,
          metricLogLoss: 0.2,
          metricRmseBins: 0.1,
          resultProfileId: expect.any(String),
        });
        expect(
          db
            .prepare(
              "SELECT status FROM parameter_profiles WHERE id = ?",
            )
            .pluck()
            .get(service.getRun(started.id)?.resultProfileId),
        ).toBe("candidate");
        expect(
          db
            .prepare(
              "SELECT status FROM parameter_profiles WHERE id = ?",
            )
            .pluck()
            .get(OFFICIAL_PARAMETER_PROFILE_ID),
        ).toBe("active");
      } finally {
        db.close();
      }
    });
  });

  it("cancels cooperatively and records stable worker failure codes", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seedSection(db);
        let rejectTraining: ((error: Error) => void) | undefined;
        let observedSignal: AbortSignal | undefined;
        const service = new OptimizerRunService(db, {
          loadTrainingSet: () => trainingSet(400),
          nowMs: () => 1_000,
          train: ({ signal }) =>
            new Promise((_resolve, reject) => {
              observedSignal = signal;
              rejectTraining = reject;
              signal.addEventListener(
                "abort",
                () => reject(new Error("OPTIMIZER_CANCELLED")),
                { once: true },
              );
            }),
        });
        const started = service.startRun(globalScope);
        await Promise.resolve();
        expect(service.cancelRun(started.id)).toBe(true);
        expect(observedSignal?.aborted).toBe(true);
        await service.whenIdle();
        expect(service.getRun(started.id)).toMatchObject({
          status: "cancelled",
          errorCode: "OPTIMIZER_CANCELLED",
        });

        const failedService = new OptimizerRunService(db, {
          loadTrainingSet: () => trainingSet(400),
          nowMs: () => 2_000,
          train: async () => {
            throw new Error("OPTIMIZER_WORKER_CRASHED");
          },
        });
        const failed = failedService.startRun(sectionScope);
        await failedService.whenIdle();
        expect(failedService.getRun(failed.id)).toMatchObject({
          status: "failed",
          errorCode: "OPTIMIZER_WORKER_CRASHED",
        });
        rejectTraining?.(new Error("ignored after cancellation"));
      } finally {
        db.close();
      }
    });
  });

  it("marks abandoned work failed on restart", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        db.prepare(
          `
            INSERT INTO optimizer_runs
              (
                id, scope_type, section_id, status, raw_review_count,
                eligible_example_count, source_review_cutoff_ms,
                package_version, algorithm_version, progress,
                created_at_ms, started_at_ms
              )
            VALUES
              (
                'abandoned', 'global', NULL, 'running', 500, 400, 10,
                '0.5.0', '6.0', 0.4, 100, 100
              )
          `,
        ).run();
        const service = new OptimizerRunService(db, {
          loadTrainingSet: () => trainingSet(0),
          nowMs: () => 1_000,
          train: async () => trainedResult,
        });
        expect(
          db
            .prepare(
              "SELECT status, error_code, finished_at_ms FROM optimizer_runs WHERE id = 'abandoned'",
            )
            .get(),
        ).toEqual({
          status: "running",
          error_code: null,
          finished_at_ms: null,
        });

        service.recoverInterruptedRuns();
        expect(
          db
            .prepare(
              "SELECT status, error_code, finished_at_ms FROM optimizer_runs WHERE id = 'abandoned'",
            )
            .get(),
        ).toEqual({
          status: "failed",
          error_code: "OPTIMIZER_PROCESS_INTERRUPTED",
          finished_at_ms: 1_000,
        });
      } finally {
        db.close();
      }
    });
  });
});
