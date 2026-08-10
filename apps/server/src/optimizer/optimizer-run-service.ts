import { randomUUID } from "node:crypto";
import type {
  OptimizerEligibility,
  OptimizerRun,
  OptimizerRunInputSnapshot,
  OptimizerRunStatus,
  OptimizerTechnicalInfo,
  OptimizerTrainingPreflight,
  OptimizerTrainingSettings,
} from "@openrecall/contracts";
import { OptimizerRunInputSnapshotSchema } from "@openrecall/contracts";
import {
  CURRENT_SCHEDULER_SETTINGS_MANIFEST,
  OptimizerDataRepository,
  OptimizerSettingsRepository,
  SettingsRepository,
  type OptimizerEligibilityCounts,
} from "@openrecall/database";
import { MINIMUM_ELIGIBLE_EXAMPLES } from "@openrecall/domain";
import {
  buildTrainingSet,
  OFFICIAL_OPTIMIZER_TRAINING_CONFIG,
  OPTIMIZER_BINDING_VERSION,
  OPTIMIZER_TRAINING_MANIFEST,
  resolveOptimizerTrainingConfig,
  trainOptimizer,
  type OptimizerResult,
  type OptimizerScope,
  type TrainOptimizerInput,
  type TrainingSetSummary,
} from "@openrecall/optimizer";
import { Value } from "typebox/value";
import { OptimizerJobCoordinator } from "./optimizer-job-coordinator.js";

type ApplicationDatabase = ConstructorParameters<
  typeof SettingsRepository
>[0];

interface OptimizerRunRow {
  readonly id: string;
  readonly scope_type: "global" | "section";
  readonly section_id: string | null;
  readonly status: OptimizerRunStatus;
  readonly raw_review_count: number;
  readonly eligible_example_count: number;
  readonly source_review_cutoff_ms: number | null;
  readonly package_version: string;
  readonly algorithm_version: string;
  readonly progress: number;
  readonly result_profile_id: string | null;
  readonly metric_log_loss: number | null;
  readonly metric_rmse_bins: number | null;
  readonly error_code: string | null;
  readonly created_at_ms: number;
  readonly started_at_ms: number | null;
  readonly finished_at_ms: number | null;
  readonly input_snapshot_json: string | null;
  readonly max_sequence_excluded_count: number;
  readonly source_review_fingerprint: string | null;
}

export type OptimizerTrainer = (
  input: TrainOptimizerInput,
) => Promise<OptimizerResult>;

interface OptimizerRunDependencies {
  readonly nowMs?: () => number;
  readonly loadTrainingSet?: (
    scope: OptimizerScope,
    maxSeqLen: number,
  ) => TrainingSetSummary;
  readonly loadEligibility?: (
    scope: OptimizerScope,
  ) => OptimizerEligibilityCounts;
  readonly train?: OptimizerTrainer;
  readonly coordinator?: OptimizerJobCoordinator;
  readonly optimizerSettings?: OptimizerSettingsRepository;
}

export class OptimizerEligibilityError extends Error {
  readonly rawReviewCount: number;
  readonly eligibleExampleCount: number;

  constructor(summary: TrainingSetSummary) {
    super("OPTIMIZER_INSUFFICIENT_DATA");
    this.rawReviewCount = summary.rawReviewCount;
    this.eligibleExampleCount = summary.eligibleExampleCount;
  }
}

function mapRun(row: OptimizerRunRow): OptimizerRun {
  let inputSnapshot: OptimizerRun["inputSnapshot"];
  if (row.input_snapshot_json === null) {
    inputSnapshot = {
      kind: "legacy-official",
      trainingConfig: OFFICIAL_OPTIMIZER_TRAINING_CONFIG,
      settingsSource: null,
      enableShortTerm: null,
      numRelearningSteps: null,
    };
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.input_snapshot_json);
    } catch {
      throw new Error("OPTIMIZER_RUN_SNAPSHOT_PERSISTED_INVALID");
    }
    if (!Value.Check(OptimizerRunInputSnapshotSchema, parsed)) {
      throw new Error("OPTIMIZER_RUN_SNAPSHOT_PERSISTED_INVALID");
    }
    inputSnapshot = parsed;
  }
  return {
    id: row.id,
    scopeType: row.scope_type,
    sectionId: row.section_id,
    status: row.status,
    rawReviewCount: row.raw_review_count,
    eligibleExampleCount: row.eligible_example_count,
    sourceReviewCutoffMs: row.source_review_cutoff_ms,
    packageVersion: row.package_version,
    algorithmVersion: row.algorithm_version,
    progress: row.progress,
    resultProfileId: row.result_profile_id,
    metricLogLoss: row.metric_log_loss,
    metricRmseBins: row.metric_rmse_bins,
    errorCode: row.error_code,
    createdAtMs: row.created_at_ms,
    startedAtMs: row.started_at_ms,
    finishedAtMs: row.finished_at_ms,
    inputSnapshot,
  };
}

function validateNow(nowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("OPTIMIZER_TIME_INVALID");
  }
}

function stableFailureCode(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  return /^OPTIMIZER_[A-Z0-9_]+$/.test(code)
    ? code
    : "OPTIMIZER_TRAINING_FAILED";
}

export interface OptimizerRunServiceApi {
  recoverInterruptedRuns?(): void;
  getEligibility(scope: OptimizerScope): OptimizerEligibility;
  preflight?(scope: OptimizerScope, settings: OptimizerTrainingSettings): OptimizerTrainingPreflight;
  getTechnicalInfo?(scope: OptimizerScope): OptimizerTechnicalInfo;
  startRun(scope: OptimizerScope): OptimizerRun;
  getRun(runId: string): OptimizerRun | null;
  cancelRun(runId: string): boolean;
  quiesceForSectionDeletion(sectionId: string): Promise<() => void>;
  whenIdle(): Promise<void>;
  dispose(): void;
}

export class OptimizerRunService implements OptimizerRunServiceApi {
  readonly #db: ApplicationDatabase;
  readonly #nowMs: () => number;
  readonly #loadTrainingSet: (
    scope: OptimizerScope,
    maxSeqLen: number,
  ) => TrainingSetSummary;
  readonly #loadEligibility: (
    scope: OptimizerScope,
  ) => OptimizerEligibilityCounts;
  readonly #train: OptimizerTrainer;
  readonly #settings: SettingsRepository;
  readonly #optimizerSettings: OptimizerSettingsRepository;
  readonly #coordinator: OptimizerJobCoordinator;
  #active:
    | {
        readonly id: string;
        readonly scope: OptimizerScope;
        readonly controller: AbortController;
        readonly promise: Promise<void>;
      }
    | null = null;

  constructor(
    db: ApplicationDatabase,
    dependencies: OptimizerRunDependencies = {},
  ) {
    this.#db = db;
    this.#nowMs = dependencies.nowMs ?? Date.now;
    this.#settings = new SettingsRepository(db);
    this.#optimizerSettings = dependencies.optimizerSettings ?? new OptimizerSettingsRepository(db);
    this.#coordinator = dependencies.coordinator ?? new OptimizerJobCoordinator();
    const data = new OptimizerDataRepository(db);
    this.#loadTrainingSet =
      dependencies.loadTrainingSet ??
      ((scope, maxSeqLen) => buildTrainingSet(data.listReviewHistory(scope), { maxSeqLen }));
    this.#loadEligibility =
      dependencies.loadEligibility ??
      ((scope) => {
        const settings = this.#optimizerSettings.resolveEffective(
          scope.scopeType === "section" ? scope.sectionId : null,
        ).settings;
        const summary = this.#loadTrainingSet(scope, settings.maxSeqLen);
        return {
          rawReviewCount: summary.rawReviewCount,
          eligibleExampleCount: summary.eligibleExampleCount,
          sourceReviewCutoffMs: summary.sourceReviewCutoffMs,
        };
      });
    this.#train = dependencies.train ?? trainOptimizer;
  }

  recoverInterruptedRuns(): void {
    const nowMs = this.#nowMs();
    validateNow(nowMs);
    this.#db
      .prepare(
        `
          UPDATE optimizer_runs
          SET
            status = 'failed',
            error_code = 'OPTIMIZER_PROCESS_INTERRUPTED',
            finished_at_ms = ?
          WHERE status = 'running'
        `,
      )
      .run(nowMs);
  }

  getEligibility(scope: OptimizerScope): OptimizerEligibility {
    const summary = this.#loadEligibility(scope);
    const sectionId =
      scope.scopeType === "section"
        ? scope.sectionId
        : "__global_optimizer_scope__";
    const parameterSource =
      this.#settings.resolveEffective(sectionId).parameterSource;
    return {
      scope,
      rawReviewCount: summary.rawReviewCount,
      eligibleExampleCount: summary.eligibleExampleCount,
      minimumEligibleExamples: MINIMUM_ELIGIBLE_EXAMPLES,
      sourceReviewCutoffMs: summary.sourceReviewCutoffMs,
      canTrain:
        summary.eligibleExampleCount >= MINIMUM_ELIGIBLE_EXAMPLES,
      parameterSource,
      activeRun:
        this.#active === null ? null : this.getRun(this.#active.id),
    };
  }

  preflight(
    scope: OptimizerScope,
    settings: OptimizerTrainingSettings,
  ): OptimizerTrainingPreflight {
    const summary = this.#loadTrainingSet(scope, settings.maxSeqLen);
    return {
      rawReviewCount: summary.rawReviewCount,
      otherwiseEligibleExampleCount: summary.preFilterEligibleExampleCount,
      excludedByMaxSeqLenCount: summary.maxSequenceExcludedCount,
      eligibleExampleCount: summary.eligibleExampleCount,
      minimumEligibleExamples: MINIMUM_ELIGIBLE_EXAMPLES,
      sourceReviewCutoffMs: summary.sourceReviewCutoffMs,
      canTrain: summary.eligibleExampleCount >= MINIMUM_ELIGIBLE_EXAMPLES,
    };
  }

  getTechnicalInfo(scope: OptimizerScope): OptimizerTechnicalInfo {
    const sectionId = scope.scopeType === "section"
      ? scope.sectionId
      : "__global_optimizer_scope__";
    const effective = this.#settings.resolveEffective(sectionId);
    const profile = this.#db.prepare<[string], {
      id: string;
      scope_type: "official" | "global" | "section";
      eligible_example_count: number;
      review_cutoff_ms: number | null;
      created_at_ms: number;
    }>(`
      SELECT id, scope_type, eligible_example_count, review_cutoff_ms, created_at_ms
      FROM parameter_profiles WHERE id = ?
    `).get(effective.parameterSource.profileId);
    if (profile === undefined) throw new Error("PARAMETER_PROFILE_PERSISTED_INVALID");
    const producingRun = this.#db.prepare<[string], {
      package_version: string;
      metric_log_loss: number | null;
      metric_rmse_bins: number | null;
    }>(`
      SELECT package_version, metric_log_loss, metric_rmse_bins
      FROM optimizer_runs
      WHERE result_profile_id = ? AND status = 'succeeded'
      ORDER BY finished_at_ms DESC, id DESC LIMIT 1
    `).get(profile.id);
    return {
      manifest: OPTIMIZER_TRAINING_MANIFEST,
      officialTrainingConfig: OFFICIAL_OPTIMIZER_TRAINING_CONFIG,
      parameterSource: effective.parameterSource,
      activeProfile: {
        profileId: profile.id,
        sourceKind: profile.scope_type,
        eligibleExampleCount: profile.eligible_example_count,
        reviewCutoffMs: profile.review_cutoff_ms,
        createdAtMs: profile.scope_type === "official" ? null : profile.created_at_ms,
        packageVersion: producingRun?.package_version ?? null,
        metricLogLoss: producingRun?.metric_log_loss ?? null,
        metricRmseBins: producingRun?.metric_rmse_bins ?? null,
      },
    };
  }

  startRun(scope: OptimizerScope): OptimizerRun {
    const selectedSectionId = scope.scopeType === "section" ? scope.sectionId : null;
    const optimizerEffective = this.#optimizerSettings.resolveEffective(selectedSectionId);
    const summary = this.#loadTrainingSet(scope, optimizerEffective.settings.maxSeqLen);
    if (
      summary.eligibleExampleCount < MINIMUM_ELIGIBLE_EXAMPLES
    ) {
      throw new OptimizerEligibilityError(summary);
    }
    const nowMs = this.#nowMs();
    validateNow(nowMs);
    const id = randomUUID();
    const controller = new AbortController();
    const effective = this.#settings.resolveEffective(
      scope.scopeType === "section"
        ? scope.sectionId
        : "__global_optimizer_scope__",
    );
    const snapshot: OptimizerRunInputSnapshot = {
      kind: "current",
      trainingConfig: resolveOptimizerTrainingConfig(optimizerEffective.settings),
      enableShortTerm: effective.settings.enableShortTerm,
      numRelearningSteps: effective.settings.relearningStepsMinutes.length,
      settingsSource: optimizerEffective.source,
      schedulerSettingsId: effective.settingsSource.settingsId,
      parameterProfileId: effective.parameterSource.profileId,
      packageVersion: OPTIMIZER_BINDING_VERSION,
      fsrsCoreVersion: OPTIMIZER_TRAINING_MANIFEST.fsrsCoreVersion,
      algorithmVersion: OPTIMIZER_TRAINING_MANIFEST.algorithmVersion,
      adapterVersion: OPTIMIZER_TRAINING_MANIFEST.adapterVersion,
      schemaVersion: OPTIMIZER_TRAINING_MANIFEST.schemaVersion,
      rawReviewCount: summary.rawReviewCount,
      otherwiseEligibleExampleCount: summary.preFilterEligibleExampleCount,
      excludedByMaxSeqLenCount: summary.maxSequenceExcludedCount,
      eligibleExampleCount: summary.eligibleExampleCount,
      sourceReviewCutoffMs: summary.sourceReviewCutoffMs,
      sourceReviewFingerprint: summary.sourceReviewFingerprint,
    };
    let promise!: Promise<void>;
    const releaseJob = this.#coordinator.acquire({
      id,
      kind: "training",
      scope,
      cancel: () => controller.abort(),
      get settled() { return promise; },
    });

    try {
      this.#db.transaction(() => {
      this.#db
        .prepare(
          `
            INSERT INTO optimizer_runs
              (
                id, scope_type, section_id, status, raw_review_count,
                eligible_example_count, source_review_cutoff_ms,
                package_version, algorithm_version, progress,
                created_at_ms, input_snapshot_json,
                max_sequence_excluded_count, source_review_fingerprint
              )
            VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
          `,
        )
        .run(
          id,
          scope.scopeType,
          scope.sectionId,
          summary.rawReviewCount,
          summary.eligibleExampleCount,
          summary.sourceReviewCutoffMs,
          OPTIMIZER_BINDING_VERSION,
          CURRENT_SCHEDULER_SETTINGS_MANIFEST.algorithmVersion,
          nowMs,
          JSON.stringify(snapshot),
          summary.maxSequenceExcludedCount,
          summary.sourceReviewFingerprint,
        );
      this.#db
        .prepare(
          `
            UPDATE optimizer_runs
            SET status = 'running', started_at_ms = ?
            WHERE id = ? AND status = 'queued'
          `,
        )
        .run(nowMs, id);
      })();
    } catch (error) {
      releaseJob();
      throw error;
    }

    promise = Promise.resolve()
      .then(() =>
        this.#execute(
          id,
          scope,
          summary,
          snapshot,
          controller,
        ),
      )
      .finally(() => {
        if (this.#active?.id === id) this.#active = null;
        releaseJob();
      });
    this.#active = { id, scope, controller, promise };
    const run = this.getRun(id);
    if (run === null) throw new Error("OPTIMIZER_RUN_INSERT_FAILED");
    return run;
  }

  async #execute(
    id: string,
    scope: OptimizerScope,
    summary: TrainingSetSummary,
    snapshot: OptimizerRunInputSnapshot,
    controller: AbortController,
  ): Promise<void> {
    let lastPersistedAtMs = Number.NEGATIVE_INFINITY;
    let lastProgress = 0;
    try {
      const result = await this.#train({
        examples: summary.examples,
        enableShortTerm: snapshot.enableShortTerm,
        numRelearningSteps: snapshot.numRelearningSteps,
        trainingConfig: snapshot.trainingConfig,
        signal: controller.signal,
        onProgress: (fraction) => {
          if (
            !Number.isFinite(fraction) ||
            fraction <= lastProgress ||
            fraction < 0 ||
            fraction > 1
          ) {
            return;
          }
          lastProgress = fraction;
          const nowMs = this.#nowMs();
          validateNow(nowMs);
          if (
            lastPersistedAtMs !== Number.NEGATIVE_INFINITY &&
            nowMs - lastPersistedAtMs < 1_000
          ) {
            return;
          }
          this.#db
            .prepare(
              `
                UPDATE optimizer_runs
                SET progress = ?
                WHERE id = ? AND status = 'running' AND progress < ?
              `,
            )
            .run(fraction, id, fraction);
          lastPersistedAtMs = nowMs;
        },
      });
      if (controller.signal.aborted) {
        throw new Error("OPTIMIZER_CANCELLED");
      }
      const finishedAtMs = this.#nowMs();
      validateNow(finishedAtMs);
      const profileId = randomUUID();
      this.#db.transaction(() => {
        this.#db
          .prepare(
            `
              INSERT INTO parameter_profiles
                (
                  id, scope_type, section_id, algorithm_id,
                  algorithm_version, adapter_version, weights_json,
                  eligible_example_count, review_cutoff_ms, status,
                  created_at_ms
                )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?)
            `,
          )
          .run(
            profileId,
            scope.scopeType,
            scope.sectionId,
            CURRENT_SCHEDULER_SETTINGS_MANIFEST.algorithmId,
            CURRENT_SCHEDULER_SETTINGS_MANIFEST.algorithmVersion,
            CURRENT_SCHEDULER_SETTINGS_MANIFEST.adapterVersion,
            JSON.stringify(result.weights),
            summary.eligibleExampleCount,
            summary.sourceReviewCutoffMs,
            finishedAtMs,
          );
        this.#db
          .prepare(
            `
              UPDATE optimizer_runs
              SET
                status = 'succeeded',
                progress = 1,
                result_profile_id = ?,
                metric_log_loss = ?,
                metric_rmse_bins = ?,
                finished_at_ms = ?
              WHERE id = ? AND status = 'running'
            `,
          )
          .run(
            profileId,
            result.logLoss,
            result.rmseBins,
            finishedAtMs,
            id,
          );
      })();
    } catch (error) {
      const finishedAtMs = this.#nowMs();
      validateNow(finishedAtMs);
      const cancelled =
        controller.signal.aborted ||
        stableFailureCode(error) === "OPTIMIZER_CANCELLED";
      this.#db
        .prepare(
          `
            UPDATE optimizer_runs
            SET status = ?, error_code = ?, finished_at_ms = ?
            WHERE id = ? AND status = 'running'
          `,
        )
        .run(
          cancelled ? "cancelled" : "failed",
          cancelled
            ? "OPTIMIZER_CANCELLED"
            : stableFailureCode(error),
          finishedAtMs,
          id,
        );
    }
  }

  getRun(runId: string): OptimizerRun | null {
    const row = this.#db
      .prepare<[string], OptimizerRunRow>(
        `
          SELECT
            id, scope_type, section_id, status, raw_review_count,
            eligible_example_count, source_review_cutoff_ms,
            package_version, algorithm_version, progress,
            result_profile_id, metric_log_loss, metric_rmse_bins,
            error_code, created_at_ms, started_at_ms, finished_at_ms,
            input_snapshot_json, max_sequence_excluded_count,
            source_review_fingerprint
          FROM optimizer_runs
          WHERE id = ?
        `,
      )
      .get(runId);
    return row === undefined ? null : mapRun(row);
  }

  cancelRun(runId: string): boolean {
    if (this.#active?.id !== runId) return false;
    this.#active.controller.abort();
    return true;
  }

  async quiesceForSectionDeletion(
    sectionId: string,
  ): Promise<() => void> {
    return this.#coordinator.quiesceForSectionDeletion(sectionId);
  }

  async whenIdle(): Promise<void> {
    await this.#coordinator.whenIdle();
  }

  dispose(): void {
    this.#coordinator.cancelActive();
  }
}
