import type {
  OptimizerScope,
  StoredOptimizerReview,
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
}
