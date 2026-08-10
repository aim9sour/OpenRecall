import { randomUUID } from "node:crypto";
import type {
  OptimizerScope,
  StepRecommendationApply,
  StepRecommendationInputSnapshot,
  StepRecommendationRestore,
  StepRecommendationResult,
  StepRecommendationRun,
} from "@openrecall/contracts";
import {
  CURRENT_SCHEDULER_SETTINGS_MANIFEST,
  OptimizerDataRepository,
  SettingsRepository,
  StepRecommendationRepository,
} from "@openrecall/database";
import {
  computeStepRecommendation,
  OPTIMIZER_BINDING_VERSION,
  OPTIMIZER_TRAINING_MANIFEST,
  prepareStepRecommendationInput,
  type ComputedStepRecommendation,
  type ComputeStepRecommendationInput,
  type PreparedStepRecommendationInput,
} from "@openrecall/optimizer";
import { OptimizerJobCoordinator } from "./optimizer-job-coordinator.js";

type ApplicationDatabase = ConstructorParameters<typeof SettingsRepository>[0];

export type StepRecommendationComputer = (
  input: ComputeStepRecommendationInput,
) => Promise<ComputedStepRecommendation>;

interface StepRecommendationServiceDependencies {
  readonly nowMs?: () => number;
  readonly compute?: StepRecommendationComputer;
  readonly coordinator?: OptimizerJobCoordinator;
  readonly data?: OptimizerDataRepository;
  readonly settings?: SettingsRepository;
  readonly runs?: StepRecommendationRepository;
}

export interface StepRecommendationServiceApi {
  start(scope: OptimizerScope): StepRecommendationRun;
  get(runId: string): StepRecommendationRun | null;
  cancel(runId: string): boolean;
  apply(
    runId: string,
    input: StepRecommendationApply,
  ): Promise<StepRecommendationRun>;
  restore(
    runId: string,
    input: StepRecommendationRestore,
  ): Promise<StepRecommendationRun>;
  recoverInterruptedRuns(): number;
  whenIdle(): Promise<void>;
  dispose(): void;
}

const GLOBAL_RESOLUTION_SECTION_ID = "__global_optimizer_scope__";

function validateNow(nowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("STEP_RECOMMENDATION_TIME_INVALID");
  }
}

function stableFailureCode(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  return /^STEP_RECOMMENDATION_[A-Z0-9_]+$/u.test(code)
    ? code
    : "STEP_RECOMMENDATION_ANALYSIS_FAILED";
}

function equalNumbers(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function equalSettingsSource(
  left: StepRecommendationInputSnapshot["effectiveSettingsSource"],
  right: StepRecommendationInputSnapshot["effectiveSettingsSource"],
): boolean {
  return (
    left.kind === right.kind &&
    left.settingsId === right.settingsId &&
    left.updatedAtMs === right.updatedAtMs
  );
}

function selectedScopeRevision(
  settings: SettingsRepository,
  scope: OptimizerScope,
): number | null {
  return scope.scopeType === "global"
    ? settings.getGlobalSettings()?.updatedAtMs ?? null
    : settings.getSectionSettings(scope.sectionId)?.updatedAtMs ?? null;
}

function validParts(
  parts: readonly string[],
): parts is StepRecommendationApply["parts"] {
  return (
    parts.length >= 1 &&
    parts.length <= 2 &&
    new Set(parts).size === parts.length &&
    parts.every((part) => part === "learning" || part === "relearning")
  );
}

export class StepRecommendationService
  implements StepRecommendationServiceApi {
  readonly #db: ApplicationDatabase;
  readonly #nowMs: () => number;
  readonly #compute: StepRecommendationComputer;
  readonly #coordinator: OptimizerJobCoordinator;
  readonly #data: OptimizerDataRepository;
  readonly #settings: SettingsRepository;
  readonly #runs: StepRecommendationRepository;
  #active:
    | {
        readonly id: string;
        readonly controller: AbortController;
        readonly promise: Promise<void>;
      }
    | null = null;

  constructor(
    db: ApplicationDatabase,
    dependencies: StepRecommendationServiceDependencies = {},
  ) {
    this.#db = db;
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#compute = dependencies.compute ?? computeStepRecommendation;
    this.#coordinator = dependencies.coordinator ?? new OptimizerJobCoordinator();
    this.#data = dependencies.data ?? new OptimizerDataRepository(db);
    this.#settings = dependencies.settings ?? new SettingsRepository(db);
    this.#runs = dependencies.runs ?? new StepRecommendationRepository(db);
  }

  start(scope: OptimizerScope): StepRecommendationRun {
    this.#requireScope(scope);
    const prepared = this.#prepare(scope);
    const effective = this.#settings.resolveEffective(
      scope.scopeType === "section"
        ? scope.sectionId
        : GLOBAL_RESOLUTION_SECTION_ID,
    );
    const nowMs = this.#nowMs();
    validateNow(nowMs);
    const snapshot: StepRecommendationInputSnapshot = {
      schedulerSettings: effective.settings,
      weights: [...effective.weights],
      parameterProfileId: effective.parameterSource.profileId,
      selectedScopeRevisionMs: selectedScopeRevision(this.#settings, scope),
      effectiveSettingsSource: effective.settingsSource,
      packageVersion: OPTIMIZER_BINDING_VERSION,
      algorithmVersion: OPTIMIZER_TRAINING_MANIFEST.algorithmVersion,
      adapterVersion: CURRENT_SCHEDULER_SETTINGS_MANIFEST.adapterVersion,
      schemaVersion: 1,
      rawReviewCount: prepared.rawReviewCount,
      validReviewCount: prepared.validReviewCount,
      validSequenceCount: prepared.validSequenceCount,
      excludedSequenceCount: prepared.excludedSequenceCount,
      exclusions: prepared.exclusions,
      sourceReviewCutoffMs: prepared.sourceReviewCutoffMs,
      sourceFingerprint: prepared.sourceFingerprint,
    };
    const id = randomUUID();
    const controller = new AbortController();
    let promise!: Promise<void>;
    const release = this.#coordinator.acquire({
      id,
      kind: "step-recommendation",
      scope,
      cancel: () => controller.abort(),
      get settled() {
        return promise;
      },
    });

    let run: StepRecommendationRun;
    try {
      run = this.#runs.insertRunning({
        id,
        scope,
        inputSnapshot: snapshot,
        sourceReviewCutoffMs: prepared.sourceReviewCutoffMs,
        sourceFingerprint: prepared.sourceFingerprint,
        createdAtMs: nowMs,
        startedAtMs: nowMs,
      });
    } catch (error) {
      release();
      throw error;
    }

    promise = Promise.resolve()
      .then(() => this.#execute(run.id, prepared, snapshot, controller))
      .finally(() => {
        if (this.#active?.id === run.id) this.#active = null;
        release();
      });
    this.#active = { id: run.id, controller, promise };
    return run;
  }

  async #execute(
    runId: string,
    prepared: PreparedStepRecommendationInput,
    snapshot: StepRecommendationInputSnapshot,
    controller: AbortController,
  ): Promise<void> {
    try {
      const computed = await this.#compute({
        validRows: prepared.validRows,
        requestedRetention: snapshot.schedulerSettings.requestedRetention,
        weights: snapshot.weights,
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        throw new Error("STEP_RECOMMENDATION_CANCELLED");
      }
      const result: StepRecommendationResult = {
        ...computed,
        rawReviewCount: prepared.rawReviewCount,
        validReviewCount: prepared.validReviewCount,
        validSequenceCount: prepared.validSequenceCount,
        excludedSequenceCount: prepared.excludedSequenceCount,
        exclusions: prepared.exclusions,
      };
      const finishedAtMs = this.#nowMs();
      validateNow(finishedAtMs);
      this.#runs.markSucceeded(runId, result, finishedAtMs);
    } catch (error) {
      const finishedAtMs = this.#nowMs();
      validateNow(finishedAtMs);
      const code = stableFailureCode(error);
      if (
        controller.signal.aborted ||
        code === "STEP_RECOMMENDATION_CANCELLED"
      ) {
        this.#runs.markCancelled(runId, finishedAtMs);
      } else {
        this.#runs.markFailed(runId, code, finishedAtMs);
      }
    }
  }

  get(runId: string): StepRecommendationRun | null {
    return this.#runs.get(runId);
  }

  cancel(runId: string): boolean {
    if (this.#active?.id !== runId) return false;
    this.#active.controller.abort();
    return true;
  }

  recoverInterruptedRuns(): number {
    const nowMs = this.#nowMs();
    validateNow(nowMs);
    return this.#runs.recoverInterrupted(nowMs);
  }

  async apply(
    runId: string,
    input: StepRecommendationApply,
  ): Promise<StepRecommendationRun> {
    if (!validParts(input.parts)) {
      throw new Error("STEP_RECOMMENDATION_INPUT_INVALID");
    }
    const nowMs = this.#nowMs();
    validateNow(nowMs);
    return this.#db.transaction(() => {
      const run = this.#runs.get(runId);
      if (run === null) throw new Error("STEP_RECOMMENDATION_NOT_FOUND");
      if (
        run.status !== "succeeded" ||
        run.result === null ||
        run.revisionToken !== input.revisionToken ||
        run.appliedAtMs !== null
      ) {
        throw new Error("STEP_RECOMMENDATION_CONFLICT");
      }
      this.#requireScope(run.scope);
      const prepared = this.#prepare(run.scope);
      const effective = this.#settings.resolveEffective(
        run.scope.scopeType === "section"
          ? run.scope.sectionId
          : GLOBAL_RESOLUTION_SECTION_ID,
      );
      if (
        prepared.sourceFingerprint !== run.sourceFingerprint ||
        selectedScopeRevision(this.#settings, run.scope) !==
          run.inputSnapshot.selectedScopeRevisionMs ||
        !equalSettingsSource(
          effective.settingsSource,
          run.inputSnapshot.effectiveSettingsSource,
        ) ||
        effective.parameterSource.profileId !==
          run.inputSnapshot.parameterProfileId ||
        JSON.stringify(effective.settings) !==
          JSON.stringify(run.inputSnapshot.schedulerSettings) ||
        !equalNumbers(effective.weights, run.inputSnapshot.weights)
      ) {
        throw new Error("STEP_RECOMMENDATION_STALE");
      }
      for (const part of input.parts) {
        if (run.result[part].applicableMinutes.length === 0) {
          throw new Error("STEP_RECOMMENDATION_NOT_APPLICABLE");
        }
      }

      const priorSteps = {
        learning: [...effective.settings.learningStepsMinutes],
        relearning: [...effective.settings.relearningStepsMinutes],
      };
      const nextSettings = {
        ...effective.settings,
        learningStepsMinutes: input.parts.includes("learning")
          ? [...run.result.learning.applicableMinutes]
          : [...effective.settings.learningStepsMinutes],
        relearningStepsMinutes: input.parts.includes("relearning")
          ? [...run.result.relearning.applicableMinutes]
          : [...effective.settings.relearningStepsMinutes],
      };
      this.#settings.saveRecommendedSteps({
        scope: run.scope,
        expectedUpdatedAtMs: run.inputSnapshot.selectedScopeRevisionMs,
        settings: nextSettings,
        nowMs,
      });
      return this.#runs.recordApplication({
        runId,
        expectedRevisionToken: input.revisionToken,
        parts: input.parts,
        priorSteps,
        appliedSteps: {
          learning: [...nextSettings.learningStepsMinutes],
          relearning: [...nextSettings.relearningStepsMinutes],
        },
        appliedAtMs: nowMs,
      });
    })();
  }

  async restore(
    runId: string,
    input: StepRecommendationRestore,
  ): Promise<StepRecommendationRun> {
    const nowMs = this.#nowMs();
    validateNow(nowMs);
    return this.#db.transaction(() => {
      const run = this.#runs.get(runId);
      if (run === null) throw new Error("STEP_RECOMMENDATION_NOT_FOUND");
      if (run.revisionToken !== input.revisionToken) {
        throw new Error("STEP_RECOMMENDATION_CONFLICT");
      }
      if (
        run.appliedParts === null ||
        run.priorSteps === null ||
        run.appliedSteps === null ||
        run.appliedAtMs === null ||
        run.restoredAtMs !== null
      ) {
        throw new Error("STEP_RECOMMENDATION_RESTORE_STALE");
      }
      this.#requireScope(run.scope);
      const effective = this.#settings.resolveEffective(
        run.scope.scopeType === "section"
          ? run.scope.sectionId
          : GLOBAL_RESOLUTION_SECTION_ID,
      );
      if (
        (run.appliedParts.includes("learning") &&
          !equalNumbers(
            effective.settings.learningStepsMinutes,
            run.appliedSteps.learning,
          )) ||
        (run.appliedParts.includes("relearning") &&
          !equalNumbers(
            effective.settings.relearningStepsMinutes,
            run.appliedSteps.relearning,
          ))
      ) {
        throw new Error("STEP_RECOMMENDATION_RESTORE_STALE");
      }
      const nextSettings = {
        ...effective.settings,
        learningStepsMinutes: run.appliedParts.includes("learning")
          ? [...run.priorSteps.learning]
          : [...effective.settings.learningStepsMinutes],
        relearningStepsMinutes: run.appliedParts.includes("relearning")
          ? [...run.priorSteps.relearning]
          : [...effective.settings.relearningStepsMinutes],
      };
      this.#settings.saveRecommendedSteps({
        scope: run.scope,
        expectedUpdatedAtMs: selectedScopeRevision(this.#settings, run.scope),
        settings: nextSettings,
        nowMs,
      });
      return this.#runs.recordRestore({
        runId,
        expectedRevisionToken: input.revisionToken,
        restoredAtMs: nowMs,
      });
    })();
  }

  async whenIdle(): Promise<void> {
    await this.#coordinator.whenIdle();
  }

  dispose(): void {
    this.#coordinator.cancelActive();
  }

  #prepare(scope: OptimizerScope): PreparedStepRecommendationInput {
    return prepareStepRecommendationInput(
      this.#data.listStepReviewHistory(scope),
    );
  }

  #requireScope(scope: OptimizerScope): void {
    if (scope.scopeType === "global") return;
    if (scope.sectionId.trim().length === 0) {
      throw new Error("STEP_RECOMMENDATION_SECTION_NOT_FOUND");
    }
    const exists = this.#db
      .prepare<[string], { readonly found: number }>(
        "SELECT 1 AS found FROM sections WHERE id = ?",
      )
      .get(scope.sectionId);
    if (exists === undefined) {
      throw new Error("STEP_RECOMMENDATION_SECTION_NOT_FOUND");
    }
  }
}
