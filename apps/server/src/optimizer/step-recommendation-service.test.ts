import type {
  StepRecommendationResult,
  StepRecommendationRun,
} from "@openrecall/contracts";
import {
  OptimizerDataRepository,
  SettingsRepository,
  StepRecommendationRepository,
  openDatabase,
} from "@openrecall/database";
import {
  prepareStepRecommendationInput,
  type ComputedStepRecommendation,
} from "@openrecall/optimizer";
import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it, vi } from "vitest";
import { OptimizerJobCoordinator } from "./optimizer-job-coordinator.js";
import {
  StepRecommendationService,
  type StepRecommendationComputer,
} from "./step-recommendation-service.js";

const recommendation: ComputedStepRecommendation = {
  learning: {
    rawSeconds: [80, 5_806],
    applicableMinutes: [1, 96],
    belowResolutionSeconds: [],
  },
  relearning: {
    rawSeconds: [1_200],
    applicableMinutes: [20],
    belowResolutionSeconds: [],
  },
  statistics: {
    again: null,
    hard: null,
    good: null,
    againThenGood: null,
    goodThenAgain: null,
    relearning: null,
  },
};

const SECTION_ID = "11111111-1111-4111-8111-111111111111";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function seed(db: ReturnType<typeof openDatabase>): void {
  db.exec(`
    INSERT INTO sections (id, name, created_at_ms, updated_at_ms)
    VALUES ('${SECTION_ID}', 'A', 0, 0);
    INSERT INTO learning_items (id, section_id, lifecycle, created_at_ms, updated_at_ms)
    VALUES ('item-a', '${SECTION_ID}', 'active', 0, 0);
    INSERT INTO presentations (
      id, learning_item_id, kind, ordinal, front, back,
      normalized_front, normalized_back
    ) VALUES ('presentation-a', 'item-a', 'primary', 0, 'Q', 'A', 'q', 'a');
    INSERT INTO review_sessions (id, section_id, status, started_at_ms, completed_at_ms)
    VALUES ('session-a', '${SECTION_ID}', 'completed', 0, 120000);
  `);
  insertReview(db, "log-1", 0, 1, "new");
  insertReview(db, "log-2", 60_000, 3, "learning");
}

function insertReview(
  db: ReturnType<typeof openDatabase>,
  id: string,
  ratedAtMs: number,
  rating: number,
  memoryState: string,
): void {
  db.prepare(`
    INSERT INTO session_queue_entries (
      id, session_id, learning_item_id, status, enqueued_due_at_ms,
      enqueued_at_ms, completed_at_ms, presentation_id
    ) VALUES (?, 'session-a', 'item-a', 'completed', 0, 0, ?, 'presentation-a')
  `).run(`entry-${id}`, ratedAtMs);
  db.prepare(`
    INSERT INTO review_logs (
      id, session_id, queue_entry_id, learning_item_id, section_id,
      presentation_id, front_snapshot, back_snapshot, rating,
      shown_at_ms, revealed_at_ms, rated_at_ms, review_duration_ms,
      study_day_delta, prior_state_json, result_state_json,
      algorithm_id, algorithm_version, adapter_version,
      parameter_profile_id, time_zone, boundary_minutes, settings_json,
      resulting_due_at_ms
    ) VALUES (
      ?, 'session-a', ?, 'item-a', '${SECTION_ID}', 'presentation-a', 'Q', 'A', ?,
      ?, ?, ?, 0, 0, ?, '{}', 'FSRS-6', '6.0', 1,
      'official-fsrs6-v1', 'UTC', 0, '{}', ?
    )
  `).run(
    id,
    `entry-${id}`,
    rating,
    ratedAtMs,
    ratedAtMs,
    ratedAtMs,
    JSON.stringify({ memoryState }),
    ratedAtMs + 1,
  );
}

function nextClock(start = 1_000): () => number {
  let now = start;
  return () => now++;
}

async function completedRun(
  service: StepRecommendationService,
): Promise<StepRecommendationRun> {
  const started = service.start({ scopeType: "section", sectionId: SECTION_ID });
  await service.whenIdle();
  return service.get(started.id)!;
}

function expectSucceededResult(run: StepRecommendationRun): StepRecommendationResult {
  expect(run.status).toBe("succeeded");
  expect(run.result).not.toBeNull();
  return run.result!;
}

describe("StepRecommendationService", () => {
  it("persists an immutable snapshot and succeeds with recommendation or no-recommendation results", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seed(db);
        const officialWeights = new SettingsRepository(db)
          .resolveEffective(SECTION_ID).weights;
        const compute = vi.fn<StepRecommendationComputer>().mockResolvedValue(recommendation);
        const service = new StepRecommendationService(db, {
          nowMs: nextClock(),
          compute,
        });
        const run = await completedRun(service);
        const result = expectSucceededResult(run);
        expect(result).toMatchObject({
          learning: recommendation.learning,
          rawReviewCount: 2,
          validReviewCount: 2,
          validSequenceCount: 1,
          excludedSequenceCount: 0,
        });
        expect(run.inputSnapshot).toMatchObject({
          schedulerSettings: { requestedRetention: 0.9 },
          weights: [...officialWeights],
          parameterProfileId: "official-fsrs6-v1",
          selectedScopeRevisionMs: null,
          effectiveSettingsSource: {
            kind: "global",
            settingsId: "scheduler-settings-global",
            updatedAtMs: 0,
          },
          rawReviewCount: 2,
          validReviewCount: 2,
        });
        expect(compute).toHaveBeenCalledWith(expect.objectContaining({
          requestedRetention: 0.9,
          weights: [...officialWeights],
          validRows: expect.any(Array),
          signal: expect.any(AbortSignal),
        }));

        const none = new StepRecommendationService(db, {
          nowMs: nextClock(2_000),
          compute: vi.fn().mockResolvedValue({
            ...recommendation,
            learning: { rawSeconds: [], applicableMinutes: [], belowResolutionSeconds: [] },
            relearning: { rawSeconds: [], applicableMinutes: [], belowResolutionSeconds: [] },
          }),
        });
        expectSucceededResult(await completedRun(none));
      } finally {
        db.close();
      }
    });
  });

  it("maps cancellation, crashes, restart recovery, job conflict, and deletion quiescence truthfully", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seed(db);
        const coordinator = new OptimizerJobCoordinator();
        const work = deferred<ComputedStepRecommendation>();
        const compute: StepRecommendationComputer = (input) => {
          if (input.signal.aborted) {
            return Promise.reject(new Error("STEP_RECOMMENDATION_CANCELLED"));
          }
          input.signal.addEventListener("abort", () => work.reject(new Error("STEP_RECOMMENDATION_CANCELLED")), { once: true });
          return work.promise;
        };
        const service = new StepRecommendationService(db, {
          nowMs: nextClock(), coordinator, compute,
        });
        const active = service.start({ scopeType: "global", sectionId: null });
        expect(() => service.start({ scopeType: "section", sectionId: SECTION_ID }))
          .toThrow("OPTIMIZER_RUN_CONFLICT");
        const gate = coordinator.quiesceForSectionDeletion(SECTION_ID);
        await service.whenIdle();
        const releaseGate = await gate;
        expect(service.get(active.id)).toMatchObject({ status: "cancelled" });
        releaseGate();

        const crash = new StepRecommendationService(db, {
          nowMs: nextClock(2_000),
          compute: vi.fn().mockRejectedValue(new Error("native private text")),
        });
        const crashed = await completedRun(crash);
        expect(crashed).toMatchObject({
          status: "failed",
          errorCode: "STEP_RECOMMENDATION_ANALYSIS_FAILED",
        });

        const interrupted = new StepRecommendationService(db, { nowMs: nextClock(3_000) });
        const repositoryRun = new StepRecommendationRepository(db).insertRunning({
          id: "c8f65aa8-122b-41e1-985c-61cd3cbb3210",
          scope: { scopeType: "global", sectionId: null },
          inputSnapshot: crashed.inputSnapshot,
          sourceReviewCutoffMs: crashed.sourceReviewCutoffMs,
          sourceFingerprint: crashed.sourceFingerprint,
          createdAtMs: 3_000,
          startedAtMs: 3_000,
        });
        expect(interrupted.recoverInterruptedRuns()).toBe(1);
        expect(interrupted.get(repositoryRun.id)).toMatchObject({
          status: "failed",
          errorCode: "STEP_RECOMMENDATION_INTERRUPTED",
        });
      } finally {
        db.close();
      }
    });
  });

  it("applies selected portions atomically and restores only unchanged applied values", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seed(db);
        const service = new StepRecommendationService(db, {
          nowMs: nextClock(),
          compute: vi.fn().mockResolvedValue(recommendation),
        });
        const run = await completedRun(service);
        const applied = await service.apply(run.id, {
          parts: ["learning"],
          revisionToken: run.revisionToken,
        });
        expect(applied).toMatchObject({
          appliedParts: ["learning"],
          priorSteps: { learning: [1, 10], relearning: [10] },
          appliedSteps: { learning: [1, 96], relearning: [10] },
        });
        const settings = new SettingsRepository(db);
        expect(settings.resolveEffective(SECTION_ID).settings).toMatchObject({
          learningStepsMinutes: [1, 96],
          relearningStepsMinutes: [10],
          requestedRetention: 0.9,
          maximumIntervalDays: 36_500,
        });
        const restored = await service.restore(run.id, {
          revisionToken: applied.revisionToken,
        });
        expect(restored.restoredAtMs).not.toBeNull();
        expect(settings.resolveEffective(SECTION_ID).settings.learningStepsMinutes)
          .toEqual([1, 10]);

        const second = await completedRun(service);
        const both = await service.apply(second.id, {
          parts: ["learning", "relearning"],
          revisionToken: second.revisionToken,
        });
        expect(settings.resolveEffective(SECTION_ID).settings).toMatchObject({
          learningStepsMinutes: [1, 96],
          relearningStepsMinutes: [20],
        });
        settings.saveSectionSettings({
          sectionId: SECTION_ID,
          expectedUpdatedAtMs: settings.getSectionSettings(SECTION_ID)!.updatedAtMs,
          adapterVersion: 1,
          settings: {
            ...settings.resolveEffective(SECTION_ID).settings,
            learningStepsMinutes: [5],
          },
          nowMs: 9_000,
        });
        await expect(service.restore(second.id, {
          revisionToken: both.revisionToken,
        })).rejects.toThrow("STEP_RECOMMENDATION_RESTORE_STALE");
        expect(service.get(second.id)?.restoredAtMs).toBeNull();
      } finally {
        db.close();
      }
    });
  });

  it("rejects fingerprint, settings, parameter-source, and applicability staleness without partial writes", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seed(db);
        const service = new StepRecommendationService(db, {
          nowMs: nextClock(),
          compute: vi.fn().mockResolvedValue(recommendation),
        });
        const settings = new SettingsRepository(db);

        const fingerprintRun = await completedRun(service);
        db.prepare("UPDATE review_logs SET rating = 4 WHERE id = 'log-1'").run();
        await expect(service.apply(fingerprintRun.id, {
          parts: ["learning"], revisionToken: fingerprintRun.revisionToken,
        })).rejects.toThrow("STEP_RECOMMENDATION_STALE");
        expect(settings.getSectionSettings(SECTION_ID)).toBeNull();
        db.prepare("UPDATE review_logs SET rating = 1 WHERE id = 'log-1'").run();

        const settingsRun = await completedRun(service);
        const global = settings.getGlobalSettings()!;
        settings.saveGlobalSettings({
          expectedUpdatedAtMs: global.updatedAtMs,
          adapterVersion: 1,
          settings: { ...global.settings, maximumIntervalDays: 10_000 },
          nowMs: 5_000,
        });
        await expect(service.apply(settingsRun.id, {
          parts: ["learning"], revisionToken: settingsRun.revisionToken,
        })).rejects.toThrow("STEP_RECOMMENDATION_STALE");

        const profileRun = await completedRun(service);
        db.prepare(`
          INSERT INTO parameter_profiles (
            id, scope_type, section_id, algorithm_id, algorithm_version,
            adapter_version, weights_json, eligible_example_count,
            review_cutoff_ms, status, created_at_ms
          ) VALUES ('new-global', 'global', NULL, 'FSRS-6', '6.0', 1, ?, 400, 60000, 'active', 6000)
        `).run(JSON.stringify(settings.resolveEffective(SECTION_ID).weights));
        await expect(service.apply(profileRun.id, {
          parts: ["learning"], revisionToken: profileRun.revisionToken,
        })).rejects.toThrow("STEP_RECOMMENDATION_STALE");

        const subMinute: ComputedStepRecommendation = {
          ...recommendation,
          learning: { rawSeconds: [30], applicableMinutes: [], belowResolutionSeconds: [30] },
        };
        const subService = new StepRecommendationService(db, {
          nowMs: nextClock(7_000),
          compute: vi.fn().mockResolvedValue(subMinute),
        });
        const subRun = await completedRun(subService);
        await expect(subService.apply(subRun.id, {
          parts: ["learning"], revisionToken: subRun.revisionToken,
        })).rejects.toThrow("STEP_RECOMMENDATION_NOT_APPLICABLE");
        expect(subService.get(subRun.id)?.appliedAtMs).toBeNull();
      } finally {
        db.close();
      }
    });
  });

  it("rolls back the settings write if the application audit cannot be recorded", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seed(db);
        const service = new StepRecommendationService(db, {
          nowMs: nextClock(),
          compute: vi.fn().mockResolvedValue(recommendation),
        });
        const run = await completedRun(service);
        db.exec(`
          CREATE TRIGGER test_block_step_application
          BEFORE UPDATE OF applied_at_ms ON step_recommendation_runs
          WHEN NEW.applied_at_ms IS NOT NULL
          BEGIN
            SELECT RAISE(ABORT, 'TEST_AUDIT_WRITE_BLOCKED');
          END;
        `);

        await expect(service.apply(run.id, {
          parts: ["learning"],
          revisionToken: run.revisionToken,
        })).rejects.toThrow("TEST_AUDIT_WRITE_BLOCKED");
        expect(new SettingsRepository(db).getSectionSettings(SECTION_ID)).toBeNull();
        expect(service.get(run.id)?.appliedAtMs).toBeNull();
      } finally {
        db.close();
      }
    });
  });

  it("uses the real data preparation boundary when recomputing a fingerprint", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      try {
        seed(db);
        const raw = new OptimizerDataRepository(db).listStepReviewHistory({
          scopeType: "section", sectionId: SECTION_ID,
        });
        expect(prepareStepRecommendationInput(raw).sourceFingerprint).toMatch(/^[0-9a-f]{64}$/u);
      } finally {
        db.close();
      }
    });
  });
});
