import {
  calculateStatisticsSummary,
  fromSchedulerDate,
  groupCurrentDueForecast,
  groupDailyActivity,
  type DailyActivityPoint,
  type StatisticsEvent,
  type StatisticsSummary,
  type StudyDayConfig,
  type WorkloadForecastPoint,
} from "@openrecall/domain";
import type Database from "better-sqlite3";

export interface StatisticsFilter {
  readonly fromStudyDay: string | null;
  readonly toStudyDay: string | null;
}

export interface StatisticsStateCounts {
  readonly total: number;
  readonly dueNow: number;
  readonly new: number;
  readonly learning: number;
  readonly review: number;
  readonly relearning: number;
}

export interface SectionProgressStatistics extends StatisticsStateCounts {
  readonly sectionId: string;
  readonly name: string;
}

export interface StudyStatistics {
  readonly summary: StatisticsSummary;
  readonly dailyActivity: readonly DailyActivityPoint[];
  readonly workloadForecast: readonly WorkloadForecastPoint[];
  readonly stateCounts: StatisticsStateCounts;
  readonly sections: readonly SectionProgressStatistics[];
}

interface LogRow {
  readonly learning_item_id: string;
  readonly rating: 1 | 2 | 3 | 4;
  readonly retrievability_before: number | null;
  readonly review_duration_ms: number | null;
  readonly rated_at_ms: number;
}

interface StateCountRow {
  readonly total: number;
  readonly due_now: number;
  readonly new_count: number;
  readonly learning_count: number;
  readonly review_count: number;
  readonly relearning_count: number;
}

interface SectionCountRow extends StateCountRow {
  readonly section_id: string;
  readonly name: string;
}

function dayStartMs(day: string, config: StudyDayConfig): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("STATISTICS_STUDY_DAY_INVALID");
  }
  const value = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== day) {
    throw new Error("STATISTICS_STUDY_DAY_INVALID");
  }
  return fromSchedulerDate(value, config);
}

function mapStateCounts(row: StateCountRow): StatisticsStateCounts {
  return {
    total: row.total,
    dueNow: row.due_now,
    new: row.new_count,
    learning: row.learning_count,
    review: row.review_count,
    relearning: row.relearning_count,
  };
}

export class StatisticsRepository {
  readonly #db: Database.Database;

  constructor(db: Database.Database) {
    this.#db = db;
  }

  getGlobalStatistics(
    filter: StatisticsFilter,
    nowMs: number,
    studyDay: StudyDayConfig,
  ): StudyStatistics {
    return this.#getStatistics(null, filter, nowMs, studyDay)!;
  }

  getSectionStatistics(
    sectionId: string,
    filter: StatisticsFilter,
    nowMs: number,
    studyDay: StudyDayConfig,
  ): StudyStatistics | null {
    const exists = this.#db
      .prepare<[string], number>("SELECT 1 FROM sections WHERE id = ?")
      .pluck()
      .get(sectionId);
    return exists === undefined
      ? null
      : this.#getStatistics(sectionId, filter, nowMs, studyDay);
  }

  #getStatistics(
    sectionId: string | null,
    filter: StatisticsFilter,
    nowMs: number,
    studyDay: StudyDayConfig,
  ): StudyStatistics {
    const fromMs =
      filter.fromStudyDay === null
        ? null
        : dayStartMs(filter.fromStudyDay, studyDay);
    const toMs =
      filter.toStudyDay === null
        ? null
        : dayStartMs(filter.toStudyDay, studyDay);
    const boundedFromMs = fromMs ?? 0;
    const boundedToMs = toMs ?? Number.MAX_SAFE_INTEGER;
    const rowColumns = `
      SELECT
        learning_item_id,
        rating,
        retrievability_before,
        review_duration_ms,
        rated_at_ms
      FROM review_logs
    `;
    const rows =
      sectionId === null
        ? this.#db
            .prepare<
              { readonly fromMs: number; readonly toMs: number },
              LogRow
            >(`
              ${rowColumns}
              WHERE rated_at_ms >= @fromMs
                AND rated_at_ms < @toMs
              ORDER BY rated_at_ms, id
            `)
            .all({ fromMs: boundedFromMs, toMs: boundedToMs })
        : this.#db
            .prepare<
              {
                readonly sectionId: string;
                readonly fromMs: number;
                readonly toMs: number;
              },
              LogRow
            >(`
              ${rowColumns}
              WHERE section_id = @sectionId
                AND rated_at_ms >= @fromMs
                AND rated_at_ms < @toMs
              ORDER BY rated_at_ms, id
            `)
            .all({
              sectionId,
              fromMs: boundedFromMs,
              toMs: boundedToMs,
            });
    const events: StatisticsEvent[] = rows.map((row) => ({
      learningItemId: row.learning_item_id,
      rating: row.rating,
      retrievability: row.retrievability_before,
      durationMs: row.review_duration_ms,
      ratedAtMs: row.rated_at_ms,
    }));

    const stateCounts = this.#db
      .prepare<
        { readonly sectionId: string | null; readonly nowMs: number },
        StateCountRow
      >(`
        SELECT
          count(*) AS total,
          coalesce(sum(states.due_at_ms <= @nowMs), 0) AS due_now,
          coalesce(sum(states.memory_state = 'new'), 0) AS new_count,
          coalesce(sum(states.memory_state = 'learning'), 0) AS learning_count,
          coalesce(sum(states.memory_state = 'review'), 0) AS review_count,
          coalesce(sum(states.memory_state = 'relearning'), 0) AS relearning_count
        FROM scheduler_states AS states
        JOIN learning_items AS items
          ON items.id = states.learning_item_id
          AND items.lifecycle = 'active'
        WHERE @sectionId IS NULL OR states.section_id = @sectionId
      `)
      .get({ sectionId, nowMs })!;
    const dueColumns = `
      SELECT states.learning_item_id, states.due_at_ms
      FROM scheduler_states AS states
      JOIN learning_items AS items
        ON items.id = states.learning_item_id
        AND items.lifecycle = 'active'
    `;
    const dueRows =
      sectionId === null
        ? this.#db
            .prepare<
              [],
              {
                readonly learning_item_id: string;
                readonly due_at_ms: number;
              }
            >(`
              ${dueColumns}
              ORDER BY states.due_at_ms, states.learning_item_id
            `)
            .all()
        : this.#db
            .prepare<
              [string],
              {
                readonly learning_item_id: string;
                readonly due_at_ms: number;
              }
            >(`
              ${dueColumns}
              WHERE states.section_id = ?
              ORDER BY states.due_at_ms, states.learning_item_id
            `)
            .all(sectionId);
    const dueStates = dueRows
      .map((row) => ({
        learningItemId: row.learning_item_id,
        dueAtMs: row.due_at_ms,
      }));
    const sectionRows = this.#db
      .prepare<{ readonly nowMs: number }, SectionCountRow>(`
        SELECT
          sections.id AS section_id,
          sections.name,
          count(items.id) AS total,
          coalesce(sum(states.due_at_ms <= @nowMs), 0) AS due_now,
          coalesce(sum(states.memory_state = 'new'), 0) AS new_count,
          coalesce(sum(states.memory_state = 'learning'), 0) AS learning_count,
          coalesce(sum(states.memory_state = 'review'), 0) AS review_count,
          coalesce(sum(states.memory_state = 'relearning'), 0) AS relearning_count
        FROM sections
        LEFT JOIN learning_items AS items
          ON items.section_id = sections.id
          AND items.lifecycle = 'active'
        LEFT JOIN scheduler_states AS states
          ON states.learning_item_id = items.id
        GROUP BY sections.id, sections.name
        ORDER BY sections.name, sections.id
      `)
      .all({ nowMs });

    return {
      summary: calculateStatisticsSummary(events),
      dailyActivity: groupDailyActivity(events, studyDay),
      workloadForecast: groupCurrentDueForecast(
        dueStates,
        nowMs,
        studyDay,
        30,
      ),
      stateCounts: mapStateCounts(stateCounts),
      sections: sectionRows.map((row) => ({
        sectionId: row.section_id,
        name: row.name,
        ...mapStateCounts(row),
      })),
    };
  }
}
