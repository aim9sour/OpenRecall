import {
  DEFAULT_SCHEDULER_SETTINGS,
  getRetrievability,
  type SchedulerStateV1,
} from "@openrecall/scheduler";
import type Database from "better-sqlite3";

export interface CardHistoryItem {
  readonly id: string;
  readonly presentationId: string;
  readonly frontSnapshot: string;
  readonly backSnapshot: string;
  readonly notesSnapshot: string | null;
  readonly rating: 1 | 2 | 3 | 4;
  readonly shownAtMs: number;
  readonly revealedAtMs: number;
  readonly ratedAtMs: number;
  readonly durationMs: number | null;
  readonly retrievabilityBefore: number | null;
  readonly resultingDueAtMs: number;
}

export interface CardStatistics {
  readonly itemId: string;
  readonly sectionId: string;
  readonly lifecycle: "active" | "trashed";
  readonly currentState: {
    readonly dueAtMs: number;
    readonly memoryState: SchedulerStateV1["memoryState"];
    readonly stepIndex: number | null;
    readonly stability: number;
    readonly difficulty: number;
    readonly repetitions: number;
    readonly lapses: number;
    readonly revision: number;
    readonly retrievability: number | null;
    readonly algorithmId: string;
    readonly algorithmVersion: string;
    readonly adapterVersion: number;
    readonly parameterProfileId: string;
  } | null;
  readonly lastReview: {
    readonly rating: 1 | 2 | 3 | 4;
    readonly ratedAtMs: number;
  } | null;
  readonly presentations: readonly {
    readonly presentationId: string;
    readonly lifecycle: "active" | "retired";
    readonly showCount: number;
    readonly firstShownAtMs: number | null;
    readonly lastShownAtMs: number | null;
  }[];
  readonly history: {
    readonly items: readonly CardHistoryItem[];
    readonly nextCursor: string | null;
  };
}

interface ItemRow {
  readonly id: string;
  readonly section_id: string;
  readonly lifecycle: "active" | "trashed";
}

interface StateRow {
  readonly due_at_ms: number;
  readonly memory_state: SchedulerStateV1["memoryState"];
  readonly step_index: number | null;
  readonly stability: number;
  readonly difficulty: number;
  readonly elapsed_days_at_last_review: number;
  readonly scheduled_days: number;
  readonly last_review_at_ms: number | null;
  readonly repetitions: number;
  readonly lapses: number;
  readonly revision: number;
  readonly algorithm_id: string;
  readonly algorithm_version: string;
  readonly adapter_version: number;
  readonly parameter_profile_id: string;
  readonly weights_json: string;
}

interface LastReviewRow {
  readonly rating: 1 | 2 | 3 | 4;
  readonly rated_at_ms: number;
  readonly time_zone: string;
  readonly boundary_minutes: number;
}

interface HistoryRow {
  readonly id: string;
  readonly presentation_id: string;
  readonly front_snapshot: string;
  readonly back_snapshot: string;
  readonly notes_snapshot: string | null;
  readonly rating: 1 | 2 | 3 | 4;
  readonly shown_at_ms: number;
  readonly revealed_at_ms: number;
  readonly rated_at_ms: number;
  readonly review_duration_ms: number | null;
  readonly retrievability_before: number | null;
  readonly resulting_due_at_ms: number;
}

interface HistoryCursor {
  readonly ratedAtMs: number;
  readonly id: string;
}

function decodeCursor(cursor: string | null): HistoryCursor | null {
  if (cursor === null) return null;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      typeof value !== "object" ||
      value === null ||
      !("ratedAtMs" in value) ||
      typeof value.ratedAtMs !== "number" ||
      !Number.isSafeInteger(value.ratedAtMs) ||
      !("id" in value) ||
      typeof value.id !== "string" ||
      value.id.length === 0
    ) {
      throw new Error("INVALID");
    }
    return { ratedAtMs: value.ratedAtMs, id: value.id };
  } catch {
    throw new Error("CARD_HISTORY_CURSOR_INVALID");
  }
}

function encodeCursor(row: HistoryRow): string {
  return Buffer.from(
    JSON.stringify({ ratedAtMs: row.rated_at_ms, id: row.id }),
  ).toString("base64url");
}

function mapHistory(row: HistoryRow): CardHistoryItem {
  return {
    id: row.id,
    presentationId: row.presentation_id,
    frontSnapshot: row.front_snapshot,
    backSnapshot: row.back_snapshot,
    notesSnapshot: row.notes_snapshot,
    rating: row.rating,
    shownAtMs: row.shown_at_ms,
    revealedAtMs: row.revealed_at_ms,
    ratedAtMs: row.rated_at_ms,
    durationMs: row.review_duration_ms,
    retrievabilityBefore: row.retrievability_before,
    resultingDueAtMs: row.resulting_due_at_ms,
  };
}

export class CardStatisticsRepository {
  readonly #db: Database.Database;

  constructor(db: Database.Database) {
    this.#db = db;
  }

  getCardStatistics(
    itemId: string,
    nowMs: number,
    cursor: string | null = null,
    limit = 25,
  ): CardStatistics | null {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("CARD_HISTORY_LIMIT_INVALID");
    }
    const decodedCursor = decodeCursor(cursor);
    const item = this.#db
      .prepare<[string], ItemRow>(
        "SELECT id, section_id, lifecycle FROM learning_items WHERE id = ?",
      )
      .get(itemId);
    if (item === undefined) return null;

    const state = this.#db
      .prepare<[string], StateRow>(`
        SELECT
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
          states.revision,
          states.algorithm_id,
          states.algorithm_version,
          states.adapter_version,
          states.parameter_profile_id,
          profiles.weights_json
        FROM scheduler_states AS states
        JOIN parameter_profiles AS profiles
          ON profiles.id = states.parameter_profile_id
        WHERE states.learning_item_id = ?
      `)
      .get(itemId);
    const lastReview = this.#db
      .prepare<[string], LastReviewRow>(`
        SELECT rating, rated_at_ms, time_zone, boundary_minutes
        FROM review_logs
        WHERE learning_item_id = ?
        ORDER BY rated_at_ms DESC, id DESC
        LIMIT 1
      `)
      .get(itemId);
    const currentState =
      state === undefined
        ? null
        : (() => {
            const schedulerState: SchedulerStateV1 = {
              schemaVersion: 1,
              dueAtMs: state.due_at_ms,
              memoryState: state.memory_state,
              stepIndex: state.step_index,
              stability: state.stability,
              difficulty: state.difficulty,
              elapsedDaysAtLastReview:
                state.elapsed_days_at_last_review,
              scheduledDays: state.scheduled_days,
              lastReviewAtMs: state.last_review_at_ms,
              repetitions: state.repetitions,
              lapses: state.lapses,
              revision: state.revision,
            };
            const retrievability = getRetrievability(
              schedulerState,
              nowMs,
              {
                nowMs,
                studyDay: {
                  timeZone: lastReview?.time_zone ?? "UTC",
                  boundaryMinutes: lastReview?.boundary_minutes ?? 0,
                },
                settings: DEFAULT_SCHEDULER_SETTINGS,
                weights: JSON.parse(state.weights_json) as number[],
                parameterProfileId: state.parameter_profile_id,
              },
            );
            return {
              dueAtMs: state.due_at_ms,
              memoryState: state.memory_state,
              stepIndex: state.step_index,
              stability: state.stability,
              difficulty: state.difficulty,
              repetitions: state.repetitions,
              lapses: state.lapses,
              revision: state.revision,
              retrievability,
              algorithmId: state.algorithm_id,
              algorithmVersion: state.algorithm_version,
              adapterVersion: state.adapter_version,
              parameterProfileId: state.parameter_profile_id,
            };
          })();
    const presentations = this.#db
      .prepare<
        [string],
        {
          readonly presentation_id: string;
          readonly lifecycle: "active" | "retired";
          readonly show_count: number;
          readonly first_shown_at_ms: number | null;
          readonly last_shown_at_ms: number | null;
        }
      >(`
        SELECT
          presentations.id AS presentation_id,
          presentations.lifecycle,
          exposures.show_count,
          exposures.first_shown_at_ms,
          exposures.last_shown_at_ms
        FROM presentations
        JOIN presentation_exposures AS exposures
          ON exposures.presentation_id = presentations.id
        WHERE presentations.learning_item_id = ?
        ORDER BY presentations.lifecycle, presentations.ordinal, presentations.id
      `)
      .all(itemId)
      .map((row) => ({
        presentationId: row.presentation_id,
        lifecycle: row.lifecycle,
        showCount: row.show_count,
        firstShownAtMs: row.first_shown_at_ms,
        lastShownAtMs: row.last_shown_at_ms,
      }));
    const historyRows = this.#db
      .prepare<
        {
          readonly itemId: string;
          readonly cursorRatedAtMs: number | null;
          readonly cursorId: string | null;
          readonly limit: number;
        },
        HistoryRow
      >(`
        SELECT
          id,
          presentation_id,
          front_snapshot,
          back_snapshot,
          notes_snapshot,
          rating,
          shown_at_ms,
          revealed_at_ms,
          rated_at_ms,
          review_duration_ms,
          retrievability_before,
          resulting_due_at_ms
        FROM review_logs
        WHERE learning_item_id = @itemId
          AND (
            @cursorRatedAtMs IS NULL
            OR rated_at_ms < @cursorRatedAtMs
            OR (rated_at_ms = @cursorRatedAtMs AND id < @cursorId)
          )
        ORDER BY rated_at_ms DESC, id DESC
        LIMIT @limit
      `)
      .all({
        itemId,
        cursorRatedAtMs: decodedCursor?.ratedAtMs ?? null,
        cursorId: decodedCursor?.id ?? null,
        limit: limit + 1,
      });
    const hasMore = historyRows.length > limit;
    const pageRows = hasMore ? historyRows.slice(0, limit) : historyRows;

    return {
      itemId,
      sectionId: item.section_id,
      lifecycle: item.lifecycle,
      currentState,
      lastReview:
        lastReview === undefined
          ? null
          : {
              rating: lastReview.rating,
              ratedAtMs: lastReview.rated_at_ms,
            },
      presentations,
      history: {
        items: pageRows.map(mapHistory),
        nextCursor:
          hasMore && pageRows.length > 0
            ? encodeCursor(pageRows[pageRows.length - 1]!)
            : null,
      },
    };
  }
}
