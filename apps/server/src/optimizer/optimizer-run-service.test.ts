import {
  OptimizerSettingsRepository,
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
const otherSectionScope: OptimizerScope = {
  scopeType: "section",
  sectionId: "section-b",
};
const trainedResult: OptimizerResult = {
  weights: Array.from({ length: 21 }, (_, index) => index + 0.5),
  logLoss: 0.2,
  rmseBins: 0.1,
};

function trainingSet(eligibleExampleCount: number): TrainingSetSummary {
  return {
    rawReviewCount: eligibleExampleCount + 25,
    preFilterEligibleExampleCount: eligibleExampleCount,
    eligibleExampleCount,
    maxSequenceExcludedCount: 0,
    sourceReviewCutoffMs:
      eligibleExampleCount === 0 ? null : 50_000,
    sourceReviewFingerprint: "a".repeat(64),
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
  db.prepare(
    `
      INSERT INTO sections (id, name, created_at_ms, updated_at_ms)
      VALUES ('section-b', 'Chemistry', 0, 0)
    `,
  ).run();
}

describe("OptimizerRunService", () => {
  it("persists and trains with one immutable effective input snapshot", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seedSection(db);
        new OptimizerSettingsRepository(db).saveSection({
          sectionId: "section-a",
          expectedUpdatedAtMs: null,
          settings: { numEpochs: 7, batchSize: 256, maxSeqLen: 128 },
          nowMs: 10,
        });
        let received: Parameters<OptimizerTrainer>[0] | undefined;
        const service = new OptimizerRunService(db, {
          loadTrainingSet: () => trainingSet(400),
          nowMs: () => 1_000,
          train: async (input) => {
            received = input;
            return trainedResult;
          },
        });

        const run = service.startRun(sectionScope);
        expect(run.inputSnapshot).toMatchObject({
          trainingConfig: {
            numEpochs: 7,
            batchSize: 256,
            seed: 2023,
            maxSeqLen: 128,
            learningRate: 0.04,
            gamma: 1,
          },
          settingsSource: { kind: "section" },
          enableShortTerm: true,
          numRelearningSteps: 1,
          sourceReviewFingerprint: "a".repeat(64),
        });
        await service.whenIdle();
        expect(received?.trainingConfig).toEqual(run.inputSnapshot.kind === "current"
          ? run.inputSnapshot.trainingConfig
          : undefined);
        expect(JSON.parse(String(db.prepare(
          "SELECT input_snapshot_json FROM optimizer_runs WHERE id = ?",
        ).pluck().get(run.id)))).toEqual(run.inputSnapshot);
      } finally {
        db.close();
      }
    });
  });

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
        expect(loadTrainingSet).toHaveBeenCalledWith(sectionScope, 256);
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

  it.each([sectionScope, globalScope])(
    "aborts affected active training and waits before granting a deletion gate",
    async (activeScope) => {
      await withTempDatabase(async (databasePath) => {
        const db = openDatabase(databasePath);
        try {
          seedSection(db);
          let observedSignal: AbortSignal | undefined;
          let settleTraining: (() => void) | undefined;
          let trainingCall = 0;
          const service = new OptimizerRunService(db, {
            loadTrainingSet: () => trainingSet(400),
            nowMs: () => 1_000,
            train: ({ signal }) => {
              trainingCall += 1;
              if (trainingCall > 1) return Promise.resolve(trainedResult);
              return new Promise((_resolve, reject) => {
                observedSignal = signal;
                settleTraining = () =>
                  reject(new Error("OPTIMIZER_CANCELLED"));
              });
            },
          });
          service.startRun(activeScope);
          await Promise.resolve();

          let quiesced = false;
          const releasePromise = service.quiesceForSectionDeletion(
            sectionScope.sectionId,
          );
          void releasePromise.then(() => {
            quiesced = true;
          });
          expect(observedSignal?.aborted).toBe(true);
          await Promise.resolve();
          expect(quiesced).toBe(false);

          settleTraining?.();
          const release = await releasePromise;
          expect(() => service.startRun(sectionScope)).toThrow(
            "OPTIMIZER_SECTION_DELETION_IN_PROGRESS",
          );
          expect(() => service.startRun(globalScope)).toThrow(
            "OPTIMIZER_SECTION_DELETION_IN_PROGRESS",
          );

          const unrelated = service.startRun(otherSectionScope);
          await service.whenIdle();
          expect(service.getRun(unrelated.id)?.status).toBe("succeeded");
          release();
          release();
        } finally {
          db.close();
        }
      });
    },
  );

  it("keeps concurrent deletion gates isolated until every release", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seedSection(db);
        const service = new OptimizerRunService(db, {
          loadTrainingSet: () => trainingSet(400),
          nowMs: () => 1_000,
          train: async () => trainedResult,
        });
        const first = await service.quiesceForSectionDeletion("section-a");
        const second = await service.quiesceForSectionDeletion("section-a");

        first();
        expect(() => service.startRun(sectionScope)).toThrow(
          "OPTIMIZER_SECTION_DELETION_IN_PROGRESS",
        );
        second();
        const started = service.startRun(sectionScope);
        await service.whenIdle();
        expect(service.getRun(started.id)?.status).toBe("succeeded");
      } finally {
        db.close();
      }
    });
  });

  it("does not cancel active training for an unrelated section", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seedSection(db);
        let signal: AbortSignal | undefined;
        let finish: ((value: OptimizerResult) => void) | undefined;
        const service = new OptimizerRunService(db, {
          loadTrainingSet: () => trainingSet(400),
          nowMs: () => 1_000,
          train: (input) =>
            new Promise((resolve) => {
              signal = input.signal;
              finish = resolve;
            }),
        });
        service.startRun(otherSectionScope);
        await Promise.resolve();

        const release = await service.quiesceForSectionDeletion(
          sectionScope.sectionId,
        );
        expect(signal?.aborted).toBe(false);
        release();
        finish?.(trainedResult);
        await service.whenIdle();
      } finally {
        db.close();
      }
    });
  });

  it("releases the deletion gate when optimizer quiescence itself fails", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seedSection(db);
        let failCleanupClock = false;
        let rejectTraining: (() => void) | undefined;
        let trainingCall = 0;
        const service = new OptimizerRunService(db, {
          loadTrainingSet: () => trainingSet(400),
          nowMs: () => {
            if (failCleanupClock) {
              throw new Error("EXPECTED_CLEANUP_FAILURE");
            }
            return 1_000;
          },
          train: () => {
            trainingCall += 1;
            if (trainingCall > 1) return Promise.resolve(trainedResult);
            return new Promise((_resolve, reject) => {
              rejectTraining = () => reject(new Error("OPTIMIZER_CANCELLED"));
            });
          },
        });
        service.startRun(sectionScope);
        await Promise.resolve();

        failCleanupClock = true;
        const quiescence = service.quiesceForSectionDeletion("section-a");
        rejectTraining?.();
        await expect(quiescence).rejects.toThrow("EXPECTED_CLEANUP_FAILURE");

        failCleanupClock = false;
        const next = service.startRun(sectionScope);
        await service.whenIdle();
        expect(service.getRun(next.id)?.status).toBe("succeeded");
      } finally {
        db.close();
      }
    });
  });
});
