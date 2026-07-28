import { randomUUID } from "node:crypto";
import {
  calculateReviewDuration,
  parseRatingResponse,
  serializeRatingResponse,
  studyDayDelta,
  type RatingResponse,
  type RevealedCardView,
  type StudyDayConfig,
} from "@openrecall/domain";
import {
  applyRating,
  DEFAULT_SCHEDULER_SETTINGS,
  type Rating,
  type SchedulerSettingsV1,
  type SchedulerStateV1,
} from "@openrecall/scheduler";
import type Database from "better-sqlite3";
import { ReviewQueueRepository } from "./review-queue-repository.js";

interface AppearanceRow {
  readonly session_id: string;
  readonly entry_id: string;
  readonly learning_item_id: string;
  readonly presentation_id: string;
  readonly shown_at_ms: number | null;
  readonly revealed_at_ms: number | null;
  readonly back: string;
  readonly notes: string | null;
}

interface RateAppearanceRow extends AppearanceRow {
  readonly section_id: string;
  readonly front: string;
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
}

interface ParameterProfileRow {
  readonly id: string;
  readonly algorithm_id: string;
  readonly algorithm_version: string;
  readonly adapter_version: number;
  readonly weights_json: string;
}

export interface EffectiveRatingSettings {
  readonly studyDay: StudyDayConfig;
  readonly settings: SchedulerSettingsV1;
}

export interface RatingTransactionOptions {
  readonly resolveSettings?: (
    sectionId: string,
    nowMs: number,
  ) => EffectiveRatingSettings;
}

export interface RateInput {
  readonly sessionId: string;
  readonly entryId: string;
  readonly learningItemId: string;
  readonly rating: Rating;
  readonly expectedStateRevision: number;
  readonly idempotencyKey: string;
  readonly nowMs: number;
}

function defaultEffectiveSettings(): EffectiveRatingSettings {
  return {
    studyDay: {
      timeZone: "UTC",
      boundaryMinutes: 0,
    },
    settings: {
      ...DEFAULT_SCHEDULER_SETTINGS,
      learningStepsMinutes: [
        ...DEFAULT_SCHEDULER_SETTINGS.learningStepsMinutes,
      ],
      relearningStepsMinutes: [
        ...DEFAULT_SCHEDULER_SETTINGS.relearningStepsMinutes,
      ],
    },
  };
}

function mapSchedulerState(row: RateAppearanceRow): SchedulerStateV1 {
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

function validateNow(nowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new RangeError("REVIEW_EVENT_TIME_INVALID");
  }
}

function validateId(value: string): void {
  if (value.length === 0) {
    throw new RangeError("REVIEW_EVENT_ID_INVALID");
  }
}

function toRevealedView(
  row: AppearanceRow,
  revealedAtMs: number,
): RevealedCardView {
  if (row.shown_at_ms === null) {
    throw new Error("REVIEW_CARD_NOT_SHOWN");
  }

  return {
    sessionId: row.session_id,
    entryId: row.entry_id,
    learningItemId: row.learning_item_id,
    presentationId: row.presentation_id,
    back: row.back,
    notes: row.notes,
    shownAtMs: row.shown_at_ms,
    revealedAtMs,
  };
}

export class RatingTransaction {
  readonly #markShown;
  readonly #markRevealed;
  readonly #rate;

  constructor(
    db: Database.Database,
    options: RatingTransactionOptions = {},
  ) {
    const resolveSettings =
      options.resolveSettings ?? defaultEffectiveSettings;
    const queueRepository = new ReviewQueueRepository(db);
    const selectAppearance = db.prepare<
      {
        readonly sessionId: string;
        readonly entryId: string;
      },
      AppearanceRow
    >(`
      SELECT
        queue.session_id,
        queue.id AS entry_id,
        queue.learning_item_id,
        queue.presentation_id,
        queue.shown_at_ms,
        queue.revealed_at_ms,
        presentations.back,
        presentations.notes
      FROM session_queue_entries AS queue
      JOIN presentations
        ON presentations.id = queue.presentation_id
        AND presentations.learning_item_id = queue.learning_item_id
      WHERE queue.session_id = @sessionId
        AND queue.id = @entryId
        AND queue.status = 'active'
    `);
    const setShown = db.prepare<{
      readonly sessionId: string;
      readonly entryId: string;
      readonly presentationId: string;
      readonly nowMs: number;
    }>(`
      UPDATE session_queue_entries
      SET shown_at_ms = @nowMs
      WHERE session_id = @sessionId
        AND id = @entryId
        AND status = 'active'
        AND presentation_id = @presentationId
        AND shown_at_ms IS NULL
    `);
    const incrementExposure = db.prepare<{
      readonly presentationId: string;
      readonly sessionId: string;
      readonly learningItemId: string;
      readonly nowMs: number;
    }>(`
      UPDATE presentation_exposures
      SET
        first_shown_at_ms = coalesce(first_shown_at_ms, @nowMs),
        last_shown_at_ms = @nowMs,
        show_count = show_count + 1,
        last_session_id = @sessionId,
        last_learning_item_id = @learningItemId
      WHERE presentation_id = @presentationId
    `);
    const setRevealed = db.prepare<{
      readonly sessionId: string;
      readonly entryId: string;
      readonly nowMs: number;
    }>(`
      UPDATE session_queue_entries
      SET revealed_at_ms = @nowMs
      WHERE session_id = @sessionId
        AND id = @entryId
        AND status = 'active'
        AND shown_at_ms IS NOT NULL
        AND revealed_at_ms IS NULL
    `);
    const selectStoredResponse = db.prepare<[string], string>(`
      SELECT response_json
      FROM rating_requests
      WHERE idempotency_key = ?
    `);
    const selectRateAppearance = db.prepare<
      {
        readonly sessionId: string;
        readonly entryId: string;
      },
      RateAppearanceRow
    >(`
      SELECT
        queue.session_id,
        queue.id AS entry_id,
        queue.learning_item_id,
        queue.presentation_id,
        queue.shown_at_ms,
        queue.revealed_at_ms,
        sessions.section_id,
        presentations.front,
        presentations.back,
        presentations.notes,
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
        states.parameter_profile_id
      FROM session_queue_entries AS queue
      JOIN review_sessions AS sessions
        ON sessions.id = queue.session_id
      JOIN presentations
        ON presentations.id = queue.presentation_id
        AND presentations.learning_item_id = queue.learning_item_id
      JOIN scheduler_states AS states
        ON states.learning_item_id = queue.learning_item_id
      WHERE queue.session_id = @sessionId
        AND queue.id = @entryId
        AND queue.status = 'active'
        AND sessions.status = 'active'
    `);
    const selectProfile = db.prepare<[string], ParameterProfileRow>(`
      SELECT
        id,
        algorithm_id,
        algorithm_version,
        adapter_version,
        weights_json
      FROM parameter_profiles
      WHERE status = 'active'
        AND (
          (scope_type = 'section' AND section_id = ?)
          OR scope_type IN ('global', 'official')
        )
      ORDER BY
        CASE scope_type
          WHEN 'section' THEN 1
          WHEN 'global' THEN 2
          ELSE 3
        END,
        created_at_ms DESC,
        id
      LIMIT 1
    `);
    const insertLog = db.prepare<{
      readonly id: string;
      readonly sessionId: string;
      readonly entryId: string;
      readonly learningItemId: string;
      readonly sectionId: string;
      readonly presentationId: string;
      readonly front: string;
      readonly back: string;
      readonly notes: string | null;
      readonly rating: Rating;
      readonly shownAtMs: number;
      readonly revealedAtMs: number;
      readonly ratedAtMs: number;
      readonly reviewDurationMs: number;
      readonly studyDayDelta: number;
      readonly priorStateJson: string;
      readonly resultStateJson: string;
      readonly algorithmId: string;
      readonly algorithmVersion: string;
      readonly adapterVersion: number;
      readonly parameterProfileId: string;
      readonly timeZone: string;
      readonly boundaryMinutes: number;
      readonly settingsJson: string;
      readonly retrievabilityBefore: number | null;
      readonly resultingDueAtMs: number;
    }>(`
      INSERT INTO review_logs
        (
          id, session_id, queue_entry_id, learning_item_id, section_id,
          presentation_id, front_snapshot, back_snapshot, notes_snapshot,
          rating, shown_at_ms, revealed_at_ms, rated_at_ms,
          review_duration_ms, study_day_delta, prior_state_json,
          result_state_json, algorithm_id, algorithm_version, adapter_version,
          parameter_profile_id, time_zone, boundary_minutes, settings_json,
          retrievability_before, resulting_due_at_ms
        )
      VALUES
        (
          @id, @sessionId, @entryId, @learningItemId, @sectionId,
          @presentationId, @front, @back, @notes,
          @rating, @shownAtMs, @revealedAtMs, @ratedAtMs,
          @reviewDurationMs, @studyDayDelta, @priorStateJson,
          @resultStateJson, @algorithmId, @algorithmVersion, @adapterVersion,
          @parameterProfileId, @timeZone, @boundaryMinutes, @settingsJson,
          @retrievabilityBefore, @resultingDueAtMs
        )
    `);
    const updateState = db.prepare<{
      readonly learningItemId: string;
      readonly expectedRevision: number;
      readonly dueAtMs: number;
      readonly memoryState: SchedulerStateV1["memoryState"];
      readonly stepIndex: number | null;
      readonly stability: number;
      readonly difficulty: number;
      readonly elapsedDaysAtLastReview: number;
      readonly scheduledDays: number;
      readonly lastReviewAtMs: number | null;
      readonly repetitions: number;
      readonly lapses: number;
      readonly revision: number;
      readonly algorithmId: string;
      readonly algorithmVersion: string;
      readonly adapterVersion: number;
      readonly parameterProfileId: string;
    }>(`
      UPDATE scheduler_states
      SET
        due_at_ms = @dueAtMs,
        memory_state = @memoryState,
        step_index = @stepIndex,
        stability = @stability,
        difficulty = @difficulty,
        elapsed_days_at_last_review = @elapsedDaysAtLastReview,
        scheduled_days = @scheduledDays,
        last_review_at_ms = @lastReviewAtMs,
        repetitions = @repetitions,
        lapses = @lapses,
        revision = @revision,
        algorithm_id = @algorithmId,
        algorithm_version = @algorithmVersion,
        adapter_version = @adapterVersion,
        parameter_profile_id = @parameterProfileId
      WHERE learning_item_id = @learningItemId
        AND revision = @expectedRevision
    `);
    const completeEntry = db.prepare<{
      readonly sessionId: string;
      readonly entryId: string;
      readonly nowMs: number;
    }>(`
      UPDATE session_queue_entries
      SET status = 'completed', completed_at_ms = @nowMs
      WHERE session_id = @sessionId
        AND id = @entryId
        AND status = 'active'
    `);
    const insertRatingRequest = db.prepare<{
      readonly idempotencyKey: string;
      readonly sessionId: string;
      readonly learningItemId: string;
      readonly expectedRevision: number;
      readonly responseJson: string;
      readonly nowMs: number;
    }>(`
      INSERT INTO rating_requests
        (
          idempotency_key, session_id, learning_item_id, expected_revision,
          response_json, created_at_ms
        )
      VALUES
        (
          @idempotencyKey, @sessionId, @learningItemId, @expectedRevision,
          @responseJson, @nowMs
        )
    `);

    this.#markShown = db.transaction(
      (
        sessionId: string,
        entryId: string,
        presentationId: string,
        nowMs: number,
      ): void => {
        const row = selectAppearance.get({ sessionId, entryId });
        if (row === undefined || row.presentation_id !== presentationId) {
          throw new Error("REVIEW_APPEARANCE_MISMATCH");
        }
        if (row.shown_at_ms !== null) {
          return;
        }

        const shown = setShown.run({
          sessionId,
          entryId,
          presentationId,
          nowMs,
        });
        if (shown.changes !== 1) {
          throw new Error("REVIEW_SHOWN_WRITE_FAILED");
        }
        const exposure = incrementExposure.run({
          presentationId,
          sessionId,
          learningItemId: row.learning_item_id,
          nowMs,
        });
        if (exposure.changes !== 1) {
          throw new Error("REVIEW_EXPOSURE_WRITE_FAILED");
        }
      },
    );

    this.#markRevealed = db.transaction(
      (
        sessionId: string,
        entryId: string,
        nowMs: number,
      ): RevealedCardView => {
        let row = selectAppearance.get({ sessionId, entryId });
        if (row === undefined) {
          throw new Error("REVIEW_APPEARANCE_MISMATCH");
        }
        if (row.shown_at_ms === null) {
          throw new Error("REVIEW_CARD_NOT_SHOWN");
        }

        if (row.revealed_at_ms === null) {
          const revealed = setRevealed.run({ sessionId, entryId, nowMs });
          if (revealed.changes !== 1) {
            throw new Error("REVIEW_REVEAL_WRITE_FAILED");
          }
          row = selectAppearance.get({ sessionId, entryId });
          if (row === undefined || row.revealed_at_ms === null) {
            throw new Error("REVIEW_REVEAL_READ_FAILED");
          }
        }

        return toRevealedView(row, row.revealed_at_ms);
      },
    );

    this.#rate = db.transaction((input: RateInput): RatingResponse => {
      const stored = selectStoredResponse.pluck().get(input.idempotencyKey);
      if (stored !== undefined) {
        return parseRatingResponse(stored);
      }

      const row = selectRateAppearance.get({
        sessionId: input.sessionId,
        entryId: input.entryId,
      });
      if (
        row === undefined ||
        row.learning_item_id !== input.learningItemId
      ) {
        throw new Error("REVIEW_APPEARANCE_MISMATCH");
      }
      if (row.revealed_at_ms === null || row.shown_at_ms === null) {
        throw new Error("REVIEW_CARD_NOT_REVEALED");
      }
      if (row.revision !== input.expectedStateRevision) {
        throw new Error("STALE_SCHEDULER_STATE");
      }
      if (input.nowMs < row.revealed_at_ms) {
        throw new RangeError("REVIEW_RATING_TIME_INVALID");
      }

      const priorState = mapSchedulerState(row);
      const effective = resolveSettings(row.section_id, input.nowMs);
      const profile = selectProfile.get(row.section_id);
      if (profile === undefined) {
        throw new Error("SCHEDULER_PROFILE_NOT_FOUND");
      }
      const parsedWeights: unknown = JSON.parse(profile.weights_json);
      if (!Array.isArray(parsedWeights)) {
        throw new Error("SCHEDULER_PROFILE_INVALID");
      }
      const outcome = applyRating(priorState, input.rating, {
        nowMs: input.nowMs,
        studyDay: effective.studyDay,
        settings: effective.settings,
        weights: parsedWeights as number[],
        parameterProfileId: profile.id,
      });
      const resultState = outcome.state;
      const delta =
        priorState.lastReviewAtMs === null
          ? 0
          : studyDayDelta(
              priorState.lastReviewAtMs,
              input.nowMs,
              effective.studyDay,
            );

      insertLog.run({
        id: randomUUID(),
        sessionId: input.sessionId,
        entryId: input.entryId,
        learningItemId: input.learningItemId,
        sectionId: row.section_id,
        presentationId: row.presentation_id,
        front: row.front,
        back: row.back,
        notes: row.notes,
        rating: input.rating,
        shownAtMs: row.shown_at_ms,
        revealedAtMs: row.revealed_at_ms,
        ratedAtMs: input.nowMs,
        reviewDurationMs: calculateReviewDuration(
          row.revealed_at_ms,
          input.nowMs,
        ),
        studyDayDelta: delta,
        priorStateJson: JSON.stringify(priorState),
        resultStateJson: JSON.stringify(resultState),
        algorithmId: profile.algorithm_id,
        algorithmVersion: profile.algorithm_version,
        adapterVersion: profile.adapter_version,
        parameterProfileId: profile.id,
        timeZone: effective.studyDay.timeZone,
        boundaryMinutes: effective.studyDay.boundaryMinutes,
        settingsJson: JSON.stringify(effective.settings),
        retrievabilityBefore: outcome.retrievabilityBefore,
        resultingDueAtMs: outcome.dueAtMs,
      });
      const stateUpdate = updateState.run({
        learningItemId: input.learningItemId,
        expectedRevision: input.expectedStateRevision,
        dueAtMs: resultState.dueAtMs,
        memoryState: resultState.memoryState,
        stepIndex: resultState.stepIndex,
        stability: resultState.stability,
        difficulty: resultState.difficulty,
        elapsedDaysAtLastReview: resultState.elapsedDaysAtLastReview,
        scheduledDays: resultState.scheduledDays,
        lastReviewAtMs: resultState.lastReviewAtMs,
        repetitions: resultState.repetitions,
        lapses: resultState.lapses,
        revision: resultState.revision,
        algorithmId: profile.algorithm_id,
        algorithmVersion: profile.algorithm_version,
        adapterVersion: profile.adapter_version,
        parameterProfileId: profile.id,
      });
      if (stateUpdate.changes !== 1) {
        throw new Error("STALE_SCHEDULER_STATE");
      }
      if (
        completeEntry.run({
          sessionId: input.sessionId,
          entryId: input.entryId,
          nowMs: input.nowMs,
        }).changes !== 1
      ) {
        throw new Error("REVIEW_ENTRY_COMPLETION_FAILED");
      }

      const merge = queueRepository.mergeDueItems(
        input.sessionId,
        input.nowMs,
      );
      const response: RatingResponse = {
        sessionId: input.sessionId,
        entryId: input.entryId,
        learningItemId: input.learningItemId,
        rating: input.rating,
        stateRevision: resultState.revision,
        dueAtMs: resultState.dueAtMs,
        newlyJoined: merge.added,
        sessionRevision: merge.revision,
      };
      const responseJson = serializeRatingResponse(response);
      insertRatingRequest.run({
        idempotencyKey: input.idempotencyKey,
        sessionId: input.sessionId,
        learningItemId: input.learningItemId,
        expectedRevision: input.expectedStateRevision,
        responseJson,
        nowMs: input.nowMs,
      });

      return parseRatingResponse(responseJson);
    });
  }

  markShown(
    sessionId: string,
    entryId: string,
    presentationId: string,
    nowMs: number,
  ): void {
    validateId(sessionId);
    validateId(entryId);
    validateId(presentationId);
    validateNow(nowMs);
    this.#markShown.immediate(sessionId, entryId, presentationId, nowMs);
  }

  markRevealed(
    sessionId: string,
    entryId: string,
    nowMs: number,
  ): RevealedCardView {
    validateId(sessionId);
    validateId(entryId);
    validateNow(nowMs);
    return this.#markRevealed.immediate(sessionId, entryId, nowMs);
  }

  rate(input: RateInput): RatingResponse {
    validateId(input.sessionId);
    validateId(input.entryId);
    validateId(input.learningItemId);
    validateId(input.idempotencyKey);
    validateNow(input.nowMs);
    if (
      !Number.isInteger(input.expectedStateRevision) ||
      input.expectedStateRevision < 0
    ) {
      throw new RangeError("SCHEDULER_REVISION_INVALID");
    }
    if (![1, 2, 3, 4].includes(input.rating)) {
      throw new RangeError("REVIEW_RATING_INVALID");
    }

    return this.#rate.immediate(input);
  }
}
