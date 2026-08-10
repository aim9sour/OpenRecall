import { createHash } from "node:crypto";
import {
  StepRecommendationInputSnapshotSchema,
  StepRecommendationResultSchema,
  StepRecommendationRunSchema,
  type OptimizerScope,
  type StepApplicationSteps,
  type StepRecommendationInputSnapshot,
  type StepRecommendationPart,
  type StepRecommendationResult,
  type StepRecommendationRun,
} from "@openrecall/contracts";
import type Database from "better-sqlite3";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";

interface RunRow {
  readonly id: string;
  readonly scope_type: "global" | "section";
  readonly section_id: string | null;
  readonly status: StepRecommendationRun["status"];
  readonly source_review_cutoff_ms: number | null;
  readonly source_fingerprint: string;
  readonly revision_token: string;
  readonly input_snapshot_json: string;
  readonly result_json: string | null;
  readonly error_code: string | null;
  readonly applied_parts_json: string | null;
  readonly prior_steps_json: string | null;
  readonly applied_steps_json: string | null;
  readonly applied_at_ms: number | null;
  readonly restored_at_ms: number | null;
  readonly created_at_ms: number;
  readonly started_at_ms: number | null;
  readonly finished_at_ms: number | null;
}

export interface InsertStepRecommendationRun {
  readonly id: string;
  readonly scope: OptimizerScope;
  readonly inputSnapshot: StepRecommendationInputSnapshot;
  readonly sourceReviewCutoffMs: number | null;
  readonly sourceFingerprint: string;
  readonly createdAtMs: number;
  readonly startedAtMs: number;
}

export interface RecordStepApplication {
  readonly runId: string;
  readonly expectedRevisionToken: string;
  readonly parts: readonly StepRecommendationPart[];
  readonly priorSteps: StepApplicationSteps;
  readonly appliedSteps: StepApplicationSteps;
  readonly appliedAtMs: number;
}

function parseJson<T>(schema: TSchema, text: string): T {
  try {
    const value: unknown = JSON.parse(text);
    if (!Value.Check(schema, value)) throw new Error();
    return value as T;
  } catch {
    throw new Error("STEP_RECOMMENDATION_PERSISTED_INVALID");
  }
}

function hashTuple(values: readonly unknown[]): string {
  const hash = createHash("sha256");
  for (const value of values) {
    const text = value === null ? "<null>" : JSON.stringify(value);
    hash.update(String(Buffer.byteLength(text))).update(":").update(text).update(";");
  }
  return hash.digest("hex");
}

function revisionToken(
  id: string,
  lifecycle: string,
  fingerprint: string,
  snapshot: StepRecommendationInputSnapshot,
): string {
  return hashTuple([
    id, lifecycle, fingerprint, snapshot.selectedScopeRevisionMs,
    snapshot.effectiveSettingsSource.kind,
    snapshot.effectiveSettingsSource.updatedAtMs,
    snapshot.parameterProfileId,
  ]);
}

function mapRow(row: RunRow | undefined): StepRecommendationRun | null {
  if (row === undefined) return null;
  const inputSnapshot = parseJson<StepRecommendationInputSnapshot>(
    StepRecommendationInputSnapshotSchema,
    row.input_snapshot_json,
  );
  const run: StepRecommendationRun = {
    id: row.id,
    scope: row.scope_type === "global"
      ? { scopeType: "global", sectionId: null }
      : { scopeType: "section", sectionId: row.section_id ?? "" },
    status: row.status,
    sourceReviewCutoffMs: row.source_review_cutoff_ms,
    sourceFingerprint: row.source_fingerprint,
    revisionToken: row.revision_token,
    inputSnapshot,
    result: row.result_json === null
      ? null
      : parseJson<StepRecommendationResult>(StepRecommendationResultSchema, row.result_json),
    errorCode: row.error_code,
    appliedParts: row.applied_parts_json === null ? null : JSON.parse(row.applied_parts_json) as StepRecommendationPart[],
    priorSteps: row.prior_steps_json === null ? null : JSON.parse(row.prior_steps_json) as StepApplicationSteps,
    appliedSteps: row.applied_steps_json === null ? null : JSON.parse(row.applied_steps_json) as StepApplicationSteps,
    appliedAtMs: row.applied_at_ms,
    restoredAtMs: row.restored_at_ms,
    createdAtMs: row.created_at_ms,
    startedAtMs: row.started_at_ms,
    finishedAtMs: row.finished_at_ms,
  };
  if (!Value.Check(StepRecommendationRunSchema, run)) {
    throw new Error("STEP_RECOMMENDATION_PERSISTED_INVALID");
  }
  return run;
}

export class StepRecommendationRepository {
  readonly #db: Database.Database;
  constructor(db: Database.Database) { this.#db = db; }

  insertRunning(input: InsertStepRecommendationRun): StepRecommendationRun {
    if (!Value.Check(StepRecommendationInputSnapshotSchema, input.inputSnapshot)) {
      throw new Error("STEP_RECOMMENDATION_INPUT_INVALID");
    }
    const token = revisionToken(input.id, "running:0", input.sourceFingerprint, input.inputSnapshot);
    this.#db.prepare(`
      INSERT INTO step_recommendation_runs (
        id, scope_type, section_id, status, source_review_cutoff_ms,
        source_fingerprint, revision_token, input_snapshot_json,
        created_at_ms, started_at_ms
      ) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)
    `).run(
      input.id, input.scope.scopeType, input.scope.sectionId,
      input.sourceReviewCutoffMs, input.sourceFingerprint, token,
      JSON.stringify(input.inputSnapshot), input.createdAtMs, input.startedAtMs,
    );
    return this.getRequired(input.id);
  }

  get(runId: string): StepRecommendationRun | null {
    return mapRow(this.#db.prepare<[string], RunRow>(`
      SELECT * FROM step_recommendation_runs WHERE id = ?
    `).get(runId));
  }

  markSucceeded(runId: string, result: StepRecommendationResult, finishedAtMs: number): void {
    if (!Value.Check(StepRecommendationResultSchema, result)) {
      throw new Error("STEP_RECOMMENDATION_RESULT_INVALID");
    }
    this.#mark(runId, "succeeded", finishedAtMs, result, null);
  }

  markFailed(runId: string, errorCode: string, finishedAtMs: number): void {
    this.#mark(runId, "failed", finishedAtMs, null, errorCode);
  }

  markCancelled(runId: string, finishedAtMs: number): void {
    this.#mark(runId, "cancelled", finishedAtMs, null, null);
  }

  recoverInterrupted(finishedAtMs: number): number {
    return this.#db.transaction(() => {
      const ids = this.#db.prepare<[], { id: string }>(`
        SELECT id FROM step_recommendation_runs
        WHERE status IN ('queued','running') ORDER BY created_at_ms, id
      `).all();
      for (const { id } of ids) {
        this.#mark(id, "failed", finishedAtMs, null, "STEP_RECOMMENDATION_INTERRUPTED");
      }
      return ids.length;
    })();
  }

  recordApplication(input: RecordStepApplication): StepRecommendationRun {
    return this.#db.transaction(() => {
      const current = this.getRequired(input.runId);
      if (
        current.status !== "succeeded" ||
        current.revisionToken !== input.expectedRevisionToken ||
        current.appliedAtMs !== null
      ) throw new Error("STEP_RECOMMENDATION_CONFLICT");
      const token = revisionToken(
        current.id,
        `applied:${input.appliedAtMs}:${input.parts.join(",")}`,
        current.sourceFingerprint,
        current.inputSnapshot,
      );
      const update = this.#db.prepare(`
        UPDATE step_recommendation_runs SET
          revision_token = ?, applied_parts_json = ?, prior_steps_json = ?,
          applied_steps_json = ?, applied_at_ms = ?
        WHERE id = ? AND revision_token = ? AND applied_at_ms IS NULL
      `).run(
        token, JSON.stringify(input.parts), JSON.stringify(input.priorSteps),
        JSON.stringify(input.appliedSteps), input.appliedAtMs,
        input.runId, input.expectedRevisionToken,
      );
      if (update.changes !== 1) throw new Error("STEP_RECOMMENDATION_CONFLICT");
      return this.getRequired(input.runId);
    })();
  }

  recordRestore(input: {
    readonly runId: string;
    readonly expectedRevisionToken: string;
    readonly restoredAtMs: number;
  }): StepRecommendationRun {
    return this.#db.transaction(() => {
      const current = this.getRequired(input.runId);
      if (
        current.revisionToken !== input.expectedRevisionToken ||
        current.appliedAtMs === null ||
        current.restoredAtMs !== null
      ) throw new Error("STEP_RECOMMENDATION_CONFLICT");
      const token = revisionToken(
        current.id, `restored:${input.restoredAtMs}`,
        current.sourceFingerprint, current.inputSnapshot,
      );
      const update = this.#db.prepare(`
        UPDATE step_recommendation_runs SET revision_token = ?, restored_at_ms = ?
        WHERE id = ? AND revision_token = ? AND restored_at_ms IS NULL
      `).run(token, input.restoredAtMs, input.runId, input.expectedRevisionToken);
      if (update.changes !== 1) throw new Error("STEP_RECOMMENDATION_CONFLICT");
      return this.getRequired(input.runId);
    })();
  }

  #mark(
    runId: string,
    status: "succeeded" | "failed" | "cancelled",
    finishedAtMs: number,
    result: StepRecommendationResult | null,
    errorCode: string | null,
  ): void {
    this.#db.transaction(() => {
      const current = this.getRequired(runId);
      if (current.status !== "running" && current.status !== "queued") {
        throw new Error("STEP_RECOMMENDATION_CONFLICT");
      }
      const token = revisionToken(
        current.id, `${status}:${finishedAtMs}`,
        current.sourceFingerprint, current.inputSnapshot,
      );
      const update = this.#db.prepare(`
        UPDATE step_recommendation_runs SET
          status = ?, revision_token = ?, result_json = ?, error_code = ?, finished_at_ms = ?
        WHERE id = ? AND revision_token = ? AND status IN ('queued','running')
      `).run(
        status, token, result === null ? null : JSON.stringify(result),
        errorCode, finishedAtMs, runId, current.revisionToken,
      );
      if (update.changes !== 1) throw new Error("STEP_RECOMMENDATION_CONFLICT");
    })();
  }

  private getRequired(runId: string): StepRecommendationRun {
    const run = this.get(runId);
    if (run === null) throw new Error("STEP_RECOMMENDATION_NOT_FOUND");
    return run;
  }
}
