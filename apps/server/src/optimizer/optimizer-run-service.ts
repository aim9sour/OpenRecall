import { randomUUID } from "node:crypto";
import type {
  OptimizerEligibility,
  OptimizerRun,
  OptimizerRunStatus,
} from "@openrecall/contracts";
import {
  CURRENT_SCHEDULER_SETTINGS_MANIFEST,
  OptimizerDataRepository,
  SettingsRepository,
  type OptimizerEligibilityCounts,
} from "@openrecall/database";
import { MINIMUM_ELIGIBLE_EXAMPLES } from "@openrecall/domain";
import {
  buildTrainingSet,
  OPTIMIZER_BINDING_VERSION,
  trainOptimizer,
  type OptimizerResult,
  type OptimizerScope,
  type TrainOptimizerInput,
  type TrainingSetSummary,
} from "@openrecall/optimizer";

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
}

export type OptimizerTrainer = (
  input: TrainOptimizerInput,
) => Promise<OptimizerResult>;

interface OptimizerRunDependencies {
  readonly nowMs?: () => number;
  readonly loadTrainingSet?: (
    scope: OptimizerScope,
  ) => TrainingSetSummary;
  readonly loadEligibility?: (
    scope: OptimizerScope,
  ) => OptimizerEligibilityCounts;
  readonly train?: OptimizerTrainer;
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
  startRun(scope: OptimizerScope): OptimizerRun;
  getRun(runId: string): OptimizerRun | null;
  cancelRun(runId: string): boolean;
  whenIdle(): Promise<void>;
  dispose(): void;
}

export class OptimizerRunService implements OptimizerRunServiceApi {
  readonly #db: ApplicationDatabase;
  readonly #nowMs: () => number;
  readonly #loadTrainingSet: (
    scope: OptimizerScope,
  ) => TrainingSetSummary;
  readonly #loadEligibility: (
    scope: OptimizerScope,
  ) => OptimizerEligibilityCounts;
  readonly #train: OptimizerTrainer;
  readonly #settings: SettingsRepository;
  #active:
    | {
        readonly id: string;
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
    const data = new OptimizerDataRepository(db);
    this.#loadTrainingSet =
      dependencies.loadTrainingSet ??
      ((scope) => buildTrainingSet(data.listReviewHistory(scope)));
    this.#loadEligibility =
      dependencies.loadEligibility ??
      (dependencies.loadTrainingSet === undefined
        ? (scope) => data.getEligibilityCounts(scope)
        : (scope) => {
            const summary = dependencies.loadTrainingSet!(scope);
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

  startRun(scope: OptimizerScope): OptimizerRun {
    if (this.#active !== null) {
      throw new Error("OPTIMIZER_RUN_CONFLICT");
    }
    const summary = this.#loadTrainingSet(scope);
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

    this.#db.transaction(() => {
      this.#db
        .prepare(
          `
            INSERT INTO optimizer_runs
              (
                id, scope_type, section_id, status, raw_review_count,
                eligible_example_count, source_review_cutoff_ms,
                package_version, algorithm_version, progress,
                created_at_ms
              )
            VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, 0, ?)
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

    const promise = Promise.resolve()
      .then(() =>
        this.#execute(
          id,
          scope,
          summary,
          effective.settings.enableShortTerm,
          effective.settings.relearningStepsMinutes.length,
          controller,
        ),
      )
      .finally(() => {
        if (this.#active?.id === id) this.#active = null;
      });
    this.#active = { id, controller, promise };
    const run = this.getRun(id);
    if (run === null) throw new Error("OPTIMIZER_RUN_INSERT_FAILED");
    return run;
  }

  async #execute(
    id: string,
    scope: OptimizerScope,
    summary: TrainingSetSummary,
    enableShortTerm: boolean,
    numRelearningSteps: number,
    controller: AbortController,
  ): Promise<void> {
    let lastPersistedAtMs = Number.NEGATIVE_INFINITY;
    let lastProgress = 0;
    try {
      const result = await this.#train({
        examples: summary.examples,
        enableShortTerm,
        numRelearningSteps,
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
            error_code, created_at_ms, started_at_ms, finished_at_ms
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

  async whenIdle(): Promise<void> {
    await this.#active?.promise;
  }

  dispose(): void {
    this.#active?.controller.abort();
  }
}
