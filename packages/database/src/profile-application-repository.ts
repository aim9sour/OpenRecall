import type {
  ReplayItemHistory,
  ReplayLog,
  ReplayProfile,
  ReplaySchedulerState,
} from "@openrecall/domain";
import type Database from "better-sqlite3";
import { validateCurrentSchedulerSettings } from "./settings-repository.js";

export type ProfileScopeType = "official" | "global" | "section";
export type ProfileStatus = "candidate" | "active" | "superseded";

export interface StoredParameterProfile extends ReplayProfile {
  readonly scopeType: ProfileScopeType;
  readonly sectionId: string | null;
  readonly eligibleExampleCount: number;
  readonly reviewCutoffMs: number | null;
  readonly status: ProfileStatus;
  readonly createdAtMs: number;
  readonly packageVersion: string | null;
  readonly metricLogLoss: number | null;
  readonly metricRmseBins: number | null;
}

export interface CapturedApplicationItem {
  readonly learningItemId: string;
  readonly sectionId: string;
  readonly createdAtMs: number;
  readonly expectedRevision: number;
  readonly oldState: ReplaySchedulerState;
  readonly history: ReplayItemHistory;
}

export interface ProfileApplicationCapture {
  readonly target: StoredParameterProfile;
  readonly previous: StoredParameterProfile;
  readonly currentReviewCutoffMs: number | null;
  readonly items: readonly CapturedApplicationItem[];
}

export interface RebuiltSchedulerState {
  readonly learningItemId: string;
  readonly state: ReplaySchedulerState;
}

export interface ProfileApplicationRecord {
  readonly id: string;
  readonly profileId: string;
  readonly previousProfileId: string;
  readonly scopeType: "global" | "section";
  readonly sectionId: string | null;
  readonly sourceReviewCutoffMs: number | null;
  readonly backupFilename: string;
  readonly appliedAtMs: number;
  readonly affectedItemCount: number;
}

interface ProfileRow {
  readonly id: string;
  readonly scope_type: ProfileScopeType;
  readonly section_id: string | null;
  readonly algorithm_id: string;
  readonly algorithm_version: string;
  readonly adapter_version: number;
  readonly weights_json: string;
  readonly eligible_example_count: number;
  readonly review_cutoff_ms: number | null;
  readonly status: ProfileStatus;
  readonly created_at_ms: number;
  readonly package_version: string | null;
  readonly metric_log_loss: number | null;
  readonly metric_rmse_bins: number | null;
}

interface ItemRow {
  readonly learning_item_id: string;
  readonly section_id: string;
  readonly created_at_ms: number;
  readonly due_at_ms: number;
  readonly memory_state: ReplaySchedulerState["memoryState"];
  readonly step_index: number | null;
  readonly stability: number;
  readonly difficulty: number;
  readonly elapsed_days_at_last_review: number;
  readonly scheduled_days: number;
  readonly last_review_at_ms: number | null;
  readonly repetitions: number;
  readonly lapses: number;
  readonly revision: number;
}

interface LogRow {
  readonly id: string;
  readonly learning_item_id: string;
  readonly rating: number;
  readonly rated_at_ms: number;
  readonly time_zone: string;
  readonly boundary_minutes: number;
  readonly settings_json: string;
  readonly algorithm_id: string;
  readonly algorithm_version: string;
  readonly adapter_version: number;
}

function mapProfile(row: ProfileRow): StoredParameterProfile {
  let weights: unknown;
  try {
    weights = JSON.parse(row.weights_json);
  } catch {
    throw new Error("PARAMETER_PROFILE_PERSISTED_INVALID");
  }
  if (
    !Array.isArray(weights) ||
    weights.length === 0 ||
    weights.some(
      (weight) => typeof weight !== "number" || !Number.isFinite(weight),
    )
  ) {
    throw new Error("PARAMETER_PROFILE_PERSISTED_INVALID");
  }
  return {
    id: row.id,
    scopeType: row.scope_type,
    sectionId: row.section_id,
    algorithmId: row.algorithm_id,
    algorithmVersion: row.algorithm_version,
    adapterVersion: row.adapter_version,
    weights,
    eligibleExampleCount: row.eligible_example_count,
    reviewCutoffMs: row.review_cutoff_ms,
    status: row.status,
    createdAtMs: row.created_at_ms,
    packageVersion: row.package_version,
    metricLogLoss: row.metric_log_loss,
    metricRmseBins: row.metric_rmse_bins,
  };
}

function mapState(row: ItemRow): ReplaySchedulerState {
  return {
    schemaVersion: 1,
    dueAtMs: row.due_at_ms,
    memoryState: row.memory_state,
    stepIndex: row.step_index,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDaysAtLastReview: row.elapsed_days_at_last_review,
    scheduledDays: row.scheduled_days,
    lastReviewAtMs: row.last_review_at_ms,
    repetitions: row.repetitions,
    lapses: row.lapses,
    revision: row.revision,
  };
}

function mapLog(row: LogRow): ReplayLog {
  let settings: ReturnType<typeof validateCurrentSchedulerSettings>;
  try {
    settings = validateCurrentSchedulerSettings(
      JSON.parse(row.settings_json),
    );
  } catch {
    throw new Error("REPLAY_HISTORY_CORRUPT");
  }
  if (!Number.isInteger(row.rating) || row.rating < 1 || row.rating > 4) {
    throw new Error("REPLAY_HISTORY_CORRUPT");
  }
  return {
    id: row.id,
    rating: row.rating as ReplayLog["rating"],
    ratedAtMs: row.rated_at_ms,
    timeZone: row.time_zone,
    boundaryMinutes: row.boundary_minutes,
    settings,
    algorithmId: row.algorithm_id,
    algorithmVersion: row.algorithm_version,
    adapterVersion: row.adapter_version,
  };
}

function profileSelect(): string {
  return `
    SELECT
      profiles.id, profiles.scope_type, profiles.section_id,
      profiles.algorithm_id, profiles.algorithm_version,
      profiles.adapter_version, profiles.weights_json,
      profiles.eligible_example_count, profiles.review_cutoff_ms,
      profiles.status, profiles.created_at_ms,
      runs.package_version, runs.metric_log_loss, runs.metric_rmse_bins
    FROM parameter_profiles AS profiles
    LEFT JOIN optimizer_runs AS runs
      ON runs.result_profile_id = profiles.id
  `;
}

export class ProfileApplicationRepository {
  readonly #db: Database.Database;

  constructor(db: Database.Database) {
    this.#db = db;
  }

  getProfile(profileId: string): StoredParameterProfile | null {
    const row = this.#db
      .prepare<[string], ProfileRow>(
        `${profileSelect()} WHERE profiles.id = ?`,
      )
      .get(profileId);
    return row === undefined ? null : mapProfile(row);
  }

  listProfiles(): StoredParameterProfile[] {
    return this.#db
      .prepare<[], ProfileRow>(
        `${profileSelect()}
         ORDER BY profiles.created_at_ms DESC, profiles.id`,
      )
      .all()
      .map(mapProfile);
  }

  #previousFor(target: StoredParameterProfile): StoredParameterProfile {
    const row = this.#db
      .prepare<
        {
          readonly sectionId: string | null;
          readonly targetId: string;
        },
        ProfileRow
      >(
        `${profileSelect()}
         WHERE profiles.status = 'active'
           AND (
             (
               @sectionId IS NOT NULL
               AND profiles.scope_type = 'section'
               AND profiles.section_id = @sectionId
             )
             OR profiles.scope_type = 'global'
             OR profiles.scope_type = 'official'
           )
           AND profiles.id <> @targetId
         ORDER BY
           CASE profiles.scope_type
             WHEN 'section' THEN 1
             WHEN 'global' THEN 2
             ELSE 3
           END,
           profiles.created_at_ms DESC,
           profiles.id
         LIMIT 1`,
      )
      .get({
        sectionId:
          target.scopeType === "section" ? target.sectionId : null,
        targetId: target.id,
      });
    if (row === undefined) throw new Error("PROFILE_PREVIOUS_NOT_FOUND");
    return mapProfile(row);
  }

  #reviewCutoff(target: StoredParameterProfile): number | null {
    return (
      this.#db
        .prepare<
          { readonly sectionId: string | null },
          { readonly cutoff: number | null }
        >(
          `
            SELECT max(rated_at_ms) AS cutoff
            FROM review_logs
            WHERE @sectionId IS NULL OR section_id = @sectionId
          `,
        )
        .get({
          sectionId:
            target.scopeType === "section" ? target.sectionId : null,
        })?.cutoff ?? null
    );
  }

  capture(profileId: string): ProfileApplicationCapture {
    const target = this.getProfile(profileId);
    if (
      target === null ||
      target.scopeType === "official" ||
      target.sectionId === "" ||
      target.status === "active"
    ) {
      throw new Error("PROFILE_NOT_APPLICABLE");
    }
    const previous = this.#previousFor(target);
    const sectionId =
      target.scopeType === "section" ? target.sectionId : null;
    const rows = this.#db
      .prepare<
        { readonly sectionId: string | null },
        ItemRow
      >(
        `
          SELECT
            items.id AS learning_item_id,
            items.section_id,
            items.created_at_ms,
            states.due_at_ms,
            states.memory_state,
            states.step_index,
            states.stability,
            states.difficulty,
            states.elapsed_days_at_last_review,
            states.scheduled_days,
            states.last_review_at_ms,
            states.repetitions,
            states.lapses,
            states.revision
          FROM learning_items AS items
          JOIN scheduler_states AS states
            ON states.learning_item_id = items.id
          WHERE
            (
              @sectionId IS NOT NULL
              AND items.section_id = @sectionId
            )
            OR
            (
              @sectionId IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM parameter_profiles AS section_profiles
                WHERE section_profiles.scope_type = 'section'
                  AND section_profiles.section_id = items.section_id
                  AND section_profiles.status = 'active'
              )
            )
          ORDER BY items.id
        `,
      )
      .all({ sectionId });
    const itemIds = new Set(rows.map((row) => row.learning_item_id));
    const logsByItem = new Map<string, ReplayLog[]>();
    const logRows = this.#db
      .prepare<
        { readonly sectionId: string | null },
        LogRow
      >(
        `
          SELECT
            logs.id, logs.learning_item_id, logs.rating, logs.rated_at_ms,
            logs.time_zone, logs.boundary_minutes, logs.settings_json,
            logs.algorithm_id, logs.algorithm_version, logs.adapter_version
          FROM review_logs AS logs
          WHERE @sectionId IS NULL OR logs.section_id = @sectionId
          ORDER BY logs.learning_item_id, logs.rated_at_ms, logs.id
        `,
      )
      .all({ sectionId });
    for (const row of logRows) {
      if (!itemIds.has(row.learning_item_id)) continue;
      const logs = logsByItem.get(row.learning_item_id) ?? [];
      logs.push(mapLog(row));
      logsByItem.set(row.learning_item_id, logs);
    }

    return {
      target,
      previous,
      currentReviewCutoffMs: this.#reviewCutoff(target),
      items: rows.map((row) => ({
        learningItemId: row.learning_item_id,
        sectionId: row.section_id,
        createdAtMs: row.created_at_ms,
        expectedRevision: row.revision,
        oldState: mapState(row),
        history: {
          learningItemId: row.learning_item_id,
          createdAtMs: row.created_at_ms,
          logs: logsByItem.get(row.learning_item_id) ?? [],
        },
      })),
    };
  }

  apply(input: {
    readonly capture: ProfileApplicationCapture;
    readonly rebuiltStates: readonly RebuiltSchedulerState[];
    readonly backupFilename: string;
    readonly applicationId: string;
    readonly appliedAtMs: number;
  }): ProfileApplicationRecord {
    if (
      input.backupFilename.trim().length === 0 ||
      input.applicationId.trim().length === 0 ||
      !Number.isSafeInteger(input.appliedAtMs) ||
      input.appliedAtMs < 0
    ) {
      throw new Error("PROFILE_APPLICATION_INPUT_INVALID");
    }
    const expectedIds = new Set(
      input.capture.items.map((item) => item.learningItemId),
    );
    if (
      input.rebuiltStates.length !== expectedIds.size ||
      input.rebuiltStates.some(
        ({ learningItemId }) => !expectedIds.delete(learningItemId),
      ) ||
      expectedIds.size !== 0
    ) {
      throw new Error("PROFILE_APPLICATION_STATE_SET_INVALID");
    }

    const apply = this.#db.transaction(() => {
      const currentTarget = this.getProfile(input.capture.target.id);
      if (
        currentTarget === null ||
        currentTarget.status !== input.capture.target.status ||
        this.#reviewCutoff(currentTarget) !==
          input.capture.currentReviewCutoffMs ||
        currentTarget.reviewCutoffMs !==
          input.capture.currentReviewCutoffMs
      ) {
        throw new Error("PROFILE_APPLICATION_STALE");
      }
      for (const item of input.capture.items) {
        const revision = this.#db
          .prepare<[string], { readonly revision: number }>(
            "SELECT revision FROM scheduler_states WHERE learning_item_id = ?",
          )
          .get(item.learningItemId)?.revision;
        if (revision !== item.expectedRevision) {
          throw new Error("PROFILE_APPLICATION_STALE");
        }
      }

      this.#db.exec(`
        DROP TABLE IF EXISTS temp.profile_rebuilt_states;
        CREATE TEMP TABLE profile_rebuilt_states (
          learning_item_id TEXT PRIMARY KEY,
          due_at_ms INTEGER NOT NULL,
          memory_state TEXT NOT NULL,
          step_index INTEGER,
          stability REAL NOT NULL,
          difficulty REAL NOT NULL,
          elapsed_days_at_last_review REAL NOT NULL,
          scheduled_days REAL NOT NULL,
          last_review_at_ms INTEGER,
          repetitions INTEGER NOT NULL,
          lapses INTEGER NOT NULL,
          revision INTEGER NOT NULL
        ) STRICT;
      `);
      const insert = this.#db.prepare(`
        INSERT INTO temp.profile_rebuilt_states
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const rebuilt of input.rebuiltStates) {
        const state = rebuilt.state;
        insert.run(
          rebuilt.learningItemId,
          state.dueAtMs,
          state.memoryState,
          state.stepIndex,
          state.stability,
          state.difficulty,
          state.elapsedDaysAtLastReview,
          state.scheduledDays,
          state.lastReviewAtMs,
          state.repetitions,
          state.lapses,
          state.revision,
        );
      }
      const tempCount = Number(
        this.#db
          .prepare("SELECT count(*) FROM temp.profile_rebuilt_states")
          .pluck()
          .get(),
      );
      const missingItems = Number(
        this.#db
          .prepare(
            `
              SELECT count(*)
              FROM temp.profile_rebuilt_states AS rebuilt
              LEFT JOIN scheduler_states AS states
                ON states.learning_item_id = rebuilt.learning_item_id
              WHERE states.learning_item_id IS NULL
            `,
          )
          .pluck()
          .get(),
      );
      if (
        tempCount !== input.capture.items.length ||
        missingItems !== 0
      ) {
        throw new Error("PROFILE_APPLICATION_TEMP_INVALID");
      }

      const update = this.#db.prepare(`
        UPDATE scheduler_states
        SET
          due_at_ms = rebuilt.due_at_ms,
          memory_state = rebuilt.memory_state,
          step_index = rebuilt.step_index,
          stability = rebuilt.stability,
          difficulty = rebuilt.difficulty,
          elapsed_days_at_last_review =
            rebuilt.elapsed_days_at_last_review,
          scheduled_days = rebuilt.scheduled_days,
          last_review_at_ms = rebuilt.last_review_at_ms,
          repetitions = rebuilt.repetitions,
          lapses = rebuilt.lapses,
          revision = rebuilt.revision,
          algorithm_id = ?,
          algorithm_version = ?,
          adapter_version = ?,
          parameter_profile_id = ?
        FROM temp.profile_rebuilt_states AS rebuilt
        WHERE scheduler_states.learning_item_id =
          rebuilt.learning_item_id
      `);
      const result = update.run(
        currentTarget.algorithmId,
        currentTarget.algorithmVersion,
        currentTarget.adapterVersion,
        currentTarget.id,
      );
      if (result.changes !== input.capture.items.length) {
        throw new Error("PROFILE_APPLICATION_WRITE_INCOMPLETE");
      }

      this.#db
        .prepare(
          `
            UPDATE parameter_profiles
            SET status = 'superseded'
            WHERE status = 'active'
              AND scope_type = ?
              AND (
                (? IS NULL AND section_id IS NULL)
                OR section_id = ?
              )
          `,
        )
        .run(
          currentTarget.scopeType,
          currentTarget.sectionId,
          currentTarget.sectionId,
        );
      const activated = this.#db
        .prepare(
          "UPDATE parameter_profiles SET status = 'active' WHERE id = ?",
        )
        .run(currentTarget.id);
      if (activated.changes !== 1) {
        throw new Error("PROFILE_APPLICATION_ACTIVATION_FAILED");
      }
      this.#db
        .prepare(
          `
            INSERT INTO profile_applications
              (
                id, profile_id, previous_profile_id, scope_type,
                section_id, source_review_cutoff_ms, backup_filename,
                applied_at_ms
              )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          input.applicationId,
          currentTarget.id,
          input.capture.previous.id,
          currentTarget.scopeType,
          currentTarget.sectionId,
          currentTarget.reviewCutoffMs,
          input.backupFilename,
          input.appliedAtMs,
        );
    });

    try {
      apply.immediate();
    } finally {
      this.#db.exec("DROP TABLE IF EXISTS temp.profile_rebuilt_states");
    }
    return {
      id: input.applicationId,
      profileId: input.capture.target.id,
      previousProfileId: input.capture.previous.id,
      scopeType: input.capture.target.scopeType as "global" | "section",
      sectionId: input.capture.target.sectionId,
      sourceReviewCutoffMs: input.capture.target.reviewCutoffMs,
      backupFilename: input.backupFilename,
      appliedAtMs: input.appliedAtMs,
      affectedItemCount: input.rebuiltStates.length,
    };
  }
}
