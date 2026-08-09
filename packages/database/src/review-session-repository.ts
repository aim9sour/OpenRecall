import {
  cryptoRandomIndex,
  selectPresentation,
  type PresentationCandidate,
  type RandomIndex,
} from "@openrecall/domain";
import type Database from "better-sqlite3";

export interface ReviewCardView {
  readonly sessionId: string;
  readonly entryId: string;
  readonly learningItemId: string;
  readonly presentationId: string;
  readonly front: string;
  readonly stateRevision: number;
}

export type ReviewCurrentCardView =
  | ({ readonly kind: "question" } & ReviewCardView)
  | ({
      readonly kind: "answer";
      readonly back: string;
      readonly notes: string | null;
    } & ReviewCardView);

interface QueuedEntryRow {
  readonly id: string;
  readonly learning_item_id: string;
  readonly state_revision: number;
}

interface ActiveViewRow {
  readonly session_id: string;
  readonly entry_id: string;
  readonly learning_item_id: string;
  readonly presentation_id: string;
  readonly front: string;
  readonly back: string;
  readonly notes: string | null;
  readonly revealed_at_ms: number | null;
  readonly state_revision: number;
}

interface PresentationRow {
  readonly id: string;
  readonly front: string;
  readonly last_shown_at_ms: number | null;
  readonly show_count: number;
}

export const REVIEW_SESSION_SELECT_REPEATED_QUEUED_SQL = `
  WITH completed_items AS MATERIALIZED (
    SELECT DISTINCT learning_item_id
    FROM session_queue_entries
    WHERE session_id = ?
      AND status = 'completed'
  )
  SELECT
    queue.id,
    queue.learning_item_id,
    coalesce(scheduler_states.revision, 0) AS state_revision
  FROM session_queue_entries AS queue
  JOIN completed_items
    ON completed_items.learning_item_id = queue.learning_item_id
  JOIN review_sessions
    ON review_sessions.id = queue.session_id
    AND review_sessions.status = 'active'
  JOIN learning_items
    ON learning_items.id = queue.learning_item_id
    AND learning_items.lifecycle = 'active'
  LEFT JOIN scheduler_states
    ON scheduler_states.learning_item_id = queue.learning_item_id
  WHERE queue.session_id = ?
    AND queue.status = 'queued'
  ORDER BY queue.enqueued_due_at_ms, queue.id
  LIMIT 1
`;

function mapActiveView(row: ActiveViewRow): ReviewCardView {
  return {
    sessionId: row.session_id,
    entryId: row.entry_id,
    learningItemId: row.learning_item_id,
    presentationId: row.presentation_id,
    front: row.front,
    stateRevision: row.state_revision,
  };
}

function validateClaimInput(sessionId: string, nowMs: number): void {
  if (sessionId.length === 0) {
    throw new RangeError("REVIEW_SESSION_ID_INVALID");
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new RangeError("REVIEW_CLAIM_TIME_INVALID");
  }
}

export class ReviewSessionRepository {
  readonly #claimNext;
  readonly #selectCurrent: (
    sessionId: string,
  ) => ActiveViewRow | undefined;

  constructor(db: Database.Database) {
    const removeInvalidEntries = db.prepare<[string]>(`
      UPDATE session_queue_entries
      SET status = 'removed'
      WHERE session_id = ?
        AND status IN ('queued', 'active')
        AND (
          NOT EXISTS (
            SELECT 1
            FROM learning_items
            WHERE learning_items.id = session_queue_entries.learning_item_id
              AND learning_items.lifecycle = 'active'
          )
          OR (
            status = 'queued'
            AND NOT EXISTS (
              SELECT 1
              FROM presentations
              JOIN presentation_exposures
                ON presentation_exposures.presentation_id = presentations.id
              WHERE presentations.learning_item_id =
                session_queue_entries.learning_item_id
                AND presentations.lifecycle = 'active'
            )
          )
          OR (
            status = 'active'
            AND NOT EXISTS (
              SELECT 1
              FROM presentations
              WHERE presentations.id =
                session_queue_entries.presentation_id
                AND presentations.learning_item_id =
                  session_queue_entries.learning_item_id
                AND presentations.lifecycle = 'active'
            )
          )
        )
    `);
    const selectActive = db.prepare<[string], ActiveViewRow>(`
      SELECT
        queue.session_id,
        queue.id AS entry_id,
        queue.learning_item_id,
        queue.presentation_id,
        queue.revealed_at_ms,
        presentations.front,
        presentations.back,
        presentations.notes,
        coalesce(scheduler_states.revision, 0) AS state_revision
      FROM session_queue_entries AS queue
      JOIN presentations
        ON presentations.id = queue.presentation_id
        AND presentations.learning_item_id = queue.learning_item_id
      LEFT JOIN scheduler_states
        ON scheduler_states.learning_item_id = queue.learning_item_id
      WHERE queue.session_id = ?
        AND queue.status = 'active'
      ORDER BY queue.activated_at_ms, queue.id
      LIMIT 1
    `);
    const selectRepeatedQueued = db.prepare<
      [string, string],
      QueuedEntryRow
    >(REVIEW_SESSION_SELECT_REPEATED_QUEUED_SQL);
    const selectQueued = db.prepare<[string], QueuedEntryRow>(`
      SELECT
        queue.id,
        queue.learning_item_id,
        coalesce(scheduler_states.revision, 0) AS state_revision
      FROM session_queue_entries AS queue
      JOIN review_sessions
        ON review_sessions.id = queue.session_id
        AND review_sessions.status = 'active'
      JOIN learning_items
        ON learning_items.id = queue.learning_item_id
        AND learning_items.lifecycle = 'active'
      LEFT JOIN scheduler_states
        ON scheduler_states.learning_item_id = queue.learning_item_id
      WHERE queue.session_id = ?
        AND queue.status = 'queued'
      ORDER BY queue.enqueued_due_at_ms, queue.id
      LIMIT 1
    `);
    const selectPresentations = db.prepare<[string], PresentationRow>(`
      SELECT
        presentations.id,
        presentations.front,
        exposures.last_shown_at_ms,
        exposures.show_count
      FROM presentations
      JOIN presentation_exposures AS exposures
        ON exposures.presentation_id = presentations.id
      WHERE presentations.learning_item_id = ?
        AND presentations.lifecycle = 'active'
      ORDER BY presentations.ordinal, presentations.id
    `);
    const activateEntry = db.prepare<{
      readonly entryId: string;
      readonly nowMs: number;
      readonly presentationId: string;
    }>(`
      UPDATE session_queue_entries
      SET
        status = 'active',
        activated_at_ms = @nowMs,
        presentation_id = @presentationId
      WHERE id = @entryId
        AND status = 'queued'
    `);
    this.#selectCurrent = (sessionId) => selectActive.get(sessionId);

    this.#claimNext = db.transaction(
      (
        sessionId: string,
        nowMs: number,
        randomIndex: RandomIndex,
      ): ReviewCardView | null => {
        removeInvalidEntries.run(sessionId);

        const existing = selectActive.get(sessionId);
        if (existing !== undefined) {
          return mapActiveView(existing);
        }

        const queued =
          selectRepeatedQueued.get(sessionId, sessionId) ??
          selectQueued.get(sessionId);
        if (queued === undefined) {
          return null;
        }

        const presentationRows = selectPresentations.all(
          queued.learning_item_id,
        );
        const candidates: PresentationCandidate[] = presentationRows.map(
          (presentation) => ({
            id: presentation.id,
            lastShownAtMs: presentation.last_shown_at_ms,
            showCount: presentation.show_count,
          }),
        );
        const presentationId = selectPresentation(candidates, randomIndex);
        const presentation = presentationRows.find(
          (candidate) => candidate.id === presentationId,
        );
        if (presentation === undefined) {
          throw new Error("REVIEW_PRESENTATION_SELECTION_FAILED");
        }

        const activation = activateEntry.run({
          entryId: queued.id,
          nowMs,
          presentationId,
        });
        if (activation.changes !== 1) {
          throw new Error("REVIEW_ENTRY_ACTIVATION_FAILED");
        }

        return {
          sessionId,
          entryId: queued.id,
          learningItemId: queued.learning_item_id,
          presentationId,
          front: presentation.front,
          stateRevision: queued.state_revision,
        };
      },
    );
  }

  claimNext(
    sessionId: string,
    nowMs: number,
    randomIndex: RandomIndex = cryptoRandomIndex,
  ): ReviewCardView | null {
    validateClaimInput(sessionId, nowMs);
    return this.#claimNext.immediate(sessionId, nowMs, randomIndex);
  }

  getCurrent(sessionId: string): ReviewCurrentCardView | null {
    if (sessionId.length === 0) {
      throw new RangeError("REVIEW_SESSION_ID_INVALID");
    }
    const row = this.#selectCurrent(sessionId);
    if (row === undefined) {
      return null;
    }
    const card = mapActiveView(row);
    return row.revealed_at_ms === null
      ? { kind: "question", ...card }
      : {
          kind: "answer",
          ...card,
          back: row.back,
          notes: row.notes,
        };
  }
}
