import type {
  OptimizerScope,
  StoredOptimizerReview,
  StoredStepReview,
} from "@openrecall/optimizer";
import type Database from "better-sqlite3";

interface ReviewRow {
  readonly review_log_id: string;
  readonly learning_item_id: string;
  readonly section_id: string;
  readonly rating: number;
  readonly delta_days: number;
  readonly rated_at_ms: number;
}

interface EligibilityRow {
  readonly raw_review_count: number;
  readonly eligible_example_count: number;
  readonly source_review_cutoff_ms: number | null;
  readonly invalid_rating_count: number;
  readonly invalid_delta_count: number;
}

interface StepReviewRow {
  readonly review_log_id: string;
  readonly learning_item_id: string;
  readonly section_id: string;
  readonly rating: number;
  readonly rated_at_ms: number;
  readonly review_duration_ms: number | null;
  readonly prior_state_json: string;
}

export interface OptimizerEligibilityCounts {
  readonly rawReviewCount: number;
  readonly eligibleExampleCount: number;
  readonly sourceReviewCutoffMs: number | null;
}

function mapRow(row: ReviewRow): StoredOptimizerReview {
  if (!Number.isInteger(row.rating) || row.rating < 1 || row.rating > 4) {
    throw new Error("OPTIMIZER_REVIEW_RATING_INVALID");
  }
  if (!Number.isInteger(row.delta_days) || row.delta_days < 0) {
    throw new Error("OPTIMIZER_REVIEW_DELTA_INVALID");
  }
  if (!Number.isSafeInteger(row.rated_at_ms) || row.rated_at_ms < 0) {
    throw new Error("OPTIMIZER_REVIEW_TIME_INVALID");
  }
  return {
    reviewLogId: row.review_log_id,
    learningItemId: row.learning_item_id,
    sectionId: row.section_id,
    rating: row.rating as StoredOptimizerReview["rating"],
    deltaDays: row.delta_days,
    ratedAtMs: row.rated_at_ms,
  };
}

export class OptimizerDataRepository {
  readonly #db: Database.Database;

  constructor(db: Database.Database) {
    this.#db = db;
  }

  listReviewHistory(scope: OptimizerScope): StoredOptimizerReview[] {
    if (
      scope.scopeType === "section" &&
      scope.sectionId.trim().length === 0
    ) {
      throw new Error("OPTIMIZER_SCOPE_INVALID");
    }
    return this.#db
      .prepare<
        { readonly sectionId: string | null },
        ReviewRow
      >(
        `
          SELECT
            id AS review_log_id,
            learning_item_id,
            section_id,
            rating,
            study_day_delta AS delta_days,
            rated_at_ms
          FROM review_logs
          WHERE @sectionId IS NULL OR section_id = @sectionId
          ORDER BY learning_item_id, rated_at_ms, id
        `,
      )
      .all({
        sectionId:
          scope.scopeType === "section" ? scope.sectionId : null,
      })
      .map(mapRow);
  }

  listStepReviewHistory(scope: OptimizerScope): StoredStepReview[] {
    if (
      scope.scopeType === "section" &&
      scope.sectionId.trim().length === 0
    ) {
      throw new Error("OPTIMIZER_SCOPE_INVALID");
    }
    return this.#db
      .prepare<
        { readonly sectionId: string | null },
        StepReviewRow
      >(
        `
          SELECT
            id AS review_log_id,
            learning_item_id,
            section_id,
            rating,
            rated_at_ms,
            review_duration_ms,
            prior_state_json
          FROM review_logs
          WHERE @sectionId IS NULL OR section_id = @sectionId
          ORDER BY learning_item_id, rated_at_ms, id
        `,
      )
      .all({
        sectionId:
          scope.scopeType === "section" ? scope.sectionId : null,
      })
      .map((row) => ({
        reviewLogId: row.review_log_id,
        learningItemId: row.learning_item_id,
        sectionId: row.section_id,
        rating: row.rating,
        ratedAtMs: row.rated_at_ms,
        reviewDurationMs: row.review_duration_ms,
        priorStateJson: row.prior_state_json,
      }));
  }

  getEligibilityCounts(
    scope: OptimizerScope,
  ): OptimizerEligibilityCounts {
    if (
      scope.scopeType === "section" &&
      scope.sectionId.trim().length === 0
    ) {
      throw new Error("OPTIMIZER_SCOPE_INVALID");
    }
    const row = this.#db
      .prepare<
        { readonly sectionId: string | null },
        EligibilityRow
      >(
        `
          WITH ordered AS (
            SELECT
              rating,
              study_day_delta,
              rated_at_ms,
              row_number() OVER (
                PARTITION BY learning_item_id
                ORDER BY rated_at_ms, id
              ) AS review_ordinal
            FROM review_logs
            WHERE @sectionId IS NULL OR section_id = @sectionId
          )
          SELECT
            count(*) AS raw_review_count,
            coalesce(
              sum(
                CASE
                  WHEN review_ordinal > 1 AND study_day_delta > 0
                    THEN 1
                  ELSE 0
                END
              ),
              0
            ) AS eligible_example_count,
            max(rated_at_ms) AS source_review_cutoff_ms,
            coalesce(
              sum(CASE WHEN rating NOT BETWEEN 1 AND 4 THEN 1 ELSE 0 END),
              0
            ) AS invalid_rating_count,
            coalesce(
              sum(CASE WHEN study_day_delta < 0 THEN 1 ELSE 0 END),
              0
            ) AS invalid_delta_count
          FROM ordered
        `,
      )
      .get({
        sectionId:
          scope.scopeType === "section" ? scope.sectionId : null,
      });
    if (row === undefined) {
      throw new Error("OPTIMIZER_ELIGIBILITY_QUERY_FAILED");
    }
    if (row.invalid_rating_count > 0) {
      throw new Error("OPTIMIZER_REVIEW_RATING_INVALID");
    }
    if (row.invalid_delta_count > 0) {
      throw new Error("OPTIMIZER_REVIEW_DELTA_INVALID");
    }
    return {
      rawReviewCount: row.raw_review_count,
      eligibleExampleCount: row.eligible_example_count,
      sourceReviewCutoffMs: row.source_review_cutoff_ms,
    };
  }
}
