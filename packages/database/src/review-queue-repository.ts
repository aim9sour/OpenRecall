import { randomUUID } from "node:crypto";
import type {
  ReviewSessionSnapshot,
  ReviewSessionStatus,
} from "@openrecall/domain";
import type Database from "better-sqlite3";

interface SessionRow {
  readonly id: string;
  readonly section_id: string;
  readonly status: ReviewSessionStatus;
  readonly revision: number;
}

interface SnapshotCountRow {
  readonly completed_appearances: number;
  readonly currently_remaining: number;
  readonly new_remaining: number;
  readonly total_appearances: number;
  readonly distinct_items: number;
}

interface SummaryRow {
  readonly session_id: string;
  readonly section_id: string;
  readonly completed_at_ms: number;
  readonly review_events: number;
  readonly unique_items: number;
  readonly again_count: number;
  readonly hard_count: number;
  readonly good_count: number;
  readonly easy_count: number;
  readonly elapsed_active_ms: number;
}

export interface MergeDueItemsResult {
  readonly added: number;
  readonly revision: number;
}

export interface ReviewSessionSummary {
  readonly sessionId: string;
  readonly sectionId: string;
  readonly completedAtMs: number;
  readonly reviewEvents: number;
  readonly uniqueItems: number;
  readonly repeatedWithinSession: number;
  readonly elapsedActiveMs: number;
  readonly ratingCounts: {
    readonly again: number;
    readonly hard: number;
    readonly good: number;
    readonly easy: number;
  };
}

export interface DueWakeTarget {
  readonly sessionId: string;
  readonly dueAtMs: number;
}

export class OpenReviewSessionError extends Error {
  readonly sessionId: string;
  readonly sectionId: string;

  constructor(session: SessionRow) {
    super("OPEN_REVIEW_SESSION_EXISTS");
    this.sessionId = session.id;
    this.sectionId = session.section_id;
  }
}

function validateIdentifier(value: string, errorCode: string): void {
  if (value.length === 0) {
    throw new RangeError(errorCode);
  }
}

function validateNow(nowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new RangeError("REVIEW_QUEUE_TIME_INVALID");
  }
}

export class ReviewQueueRepository {
  readonly #selectOpenSession;
  readonly #selectSession;
  readonly #insertSession;
  readonly #resumeSession;
  readonly #insertDueItems;
  readonly #selectCounts;
  readonly #selectElapsedActive;
  readonly #selectNearestFutureDue;
  readonly #selectNextDueWake;
  readonly #updateSessionAfterMerge;
  readonly #pauseOpenSession;
  readonly #finishOpenSession;
  readonly #removePendingEntries;
  readonly #selectSummary;
  readonly #startOrResume;
  readonly #merge;
  readonly #pause;
  readonly #resume;
  readonly #finish;

  constructor(db: Database.Database) {
    this.#selectOpenSession = db.prepare<[], SessionRow>(`
      SELECT id, section_id, status, revision
      FROM review_sessions
      WHERE status IN ('active', 'waiting', 'paused')
      LIMIT 1
    `);
    this.#selectSession = db.prepare<[string], SessionRow>(`
      SELECT id, section_id, status, revision
      FROM review_sessions
      WHERE id = ?
    `);
    const sectionExists = db.prepare<[string], number>(`
      SELECT 1
      FROM sections
      WHERE id = ?
    `);
    this.#insertSession = db.prepare<{
      readonly id: string;
      readonly sectionId: string;
      readonly nowMs: number;
    }>(`
      INSERT INTO review_sessions
        (id, section_id, status, started_at_ms, resumed_at_ms)
      VALUES
        (@id, @sectionId, 'active', @nowMs, @nowMs)
    `);
    this.#resumeSession = db.prepare<{
      readonly id: string;
      readonly nowMs: number;
    }>(`
      UPDATE review_sessions
      SET
        status = 'active',
        resumed_at_ms = @nowMs
      WHERE id = @id
        AND status = 'paused'
    `);
    this.#insertDueItems = db.prepare<{
      readonly sessionId: string;
      readonly sectionId: string;
      readonly nowMs: number;
    }>(`
      INSERT INTO session_queue_entries
        (
          id,
          session_id,
          learning_item_id,
          status,
          enqueued_due_at_ms,
          enqueued_at_ms
        )
      SELECT
        lower(
          hex(randomblob(4)) || '-' ||
          hex(randomblob(2)) || '-' ||
          '4' || substr(hex(randomblob(2)), 2) || '-' ||
          substr('89ab', (random() & 3) + 1, 1) ||
          substr(hex(randomblob(2)), 2) || '-' ||
          hex(randomblob(6))
        ),
        @sessionId,
        scheduler_states.learning_item_id,
        'queued',
        scheduler_states.due_at_ms,
        @nowMs
      FROM scheduler_states
      JOIN learning_items
        ON learning_items.id = scheduler_states.learning_item_id
        AND learning_items.lifecycle = 'active'
      WHERE scheduler_states.section_id = @sectionId
        AND scheduler_states.due_at_ms <= @nowMs
      ORDER BY scheduler_states.due_at_ms, scheduler_states.learning_item_id
      ON CONFLICT(session_id, learning_item_id)
        WHERE status IN ('queued', 'active')
        DO NOTHING
    `);
    this.#selectCounts = db.prepare<[string], SnapshotCountRow>(`
      SELECT
        count(*) FILTER (WHERE queue.status = 'completed')
          AS completed_appearances,
        count(*) FILTER (WHERE queue.status IN ('queued', 'active'))
          AS currently_remaining,
        count(*) FILTER (
          WHERE queue.status IN ('queued', 'active')
            AND scheduler_states.memory_state = 'new'
        ) AS new_remaining,
        count(*) FILTER (WHERE queue.status <> 'removed')
          AS total_appearances,
        count(DISTINCT queue.learning_item_id) FILTER (
          WHERE queue.status <> 'removed'
        ) AS distinct_items
      FROM session_queue_entries AS queue
      LEFT JOIN scheduler_states
        ON scheduler_states.learning_item_id = queue.learning_item_id
      WHERE queue.session_id = ?
    `);
    this.#selectElapsedActive = db.prepare<[string], number>(`
      SELECT coalesce(sum(review_duration_ms), 0)
      FROM review_logs
      WHERE session_id = ?
    `);
    this.#selectNearestFutureDue = db.prepare<
      { readonly sectionId: string; readonly nowMs: number },
      { readonly due_at_ms: number }
    >(`
      SELECT scheduler_states.due_at_ms
      FROM scheduler_states
      JOIN learning_items
        ON learning_items.id = scheduler_states.learning_item_id
        AND learning_items.lifecycle = 'active'
      WHERE scheduler_states.section_id = @sectionId
        AND scheduler_states.due_at_ms > @nowMs
      ORDER BY scheduler_states.due_at_ms, scheduler_states.learning_item_id
      LIMIT 1
    `);
    this.#selectNextDueWake = db.prepare<[], {
      readonly session_id: string;
      readonly due_at_ms: number;
    }>(`
      SELECT
        sessions.id AS session_id,
        min(scheduler_states.due_at_ms) AS due_at_ms
      FROM review_sessions AS sessions
      JOIN scheduler_states
        ON scheduler_states.section_id = sessions.section_id
      JOIN learning_items
        ON learning_items.id = scheduler_states.learning_item_id
        AND learning_items.lifecycle = 'active'
      WHERE sessions.status IN ('active', 'waiting')
        AND NOT EXISTS (
          SELECT 1
          FROM session_queue_entries AS queue
          WHERE queue.session_id = sessions.id
            AND queue.learning_item_id = scheduler_states.learning_item_id
            AND queue.status IN ('queued', 'active')
        )
      GROUP BY sessions.id
      ORDER BY due_at_ms, sessions.id
      LIMIT 1
    `);
    this.#updateSessionAfterMerge = db.prepare<{
      readonly id: string;
      readonly status: "active" | "waiting";
      readonly incrementRevision: number;
    }>(`
      UPDATE review_sessions
      SET
        status = @status,
        revision = revision + @incrementRevision
      WHERE id = @id
    `);
    this.#pauseOpenSession = db.prepare<{
      readonly id: string;
      readonly nowMs: number;
    }>(`
      UPDATE review_sessions
      SET
        status = 'paused',
        paused_at_ms = @nowMs,
        revision = revision + 1
      WHERE id = @id
        AND status IN ('active', 'waiting')
    `);
    this.#finishOpenSession = db.prepare<{
      readonly id: string;
      readonly nowMs: number;
    }>(`
      UPDATE review_sessions
      SET
        status = 'completed',
        completed_at_ms = @nowMs,
        revision = revision + 1
      WHERE id = @id
        AND status IN ('active', 'waiting', 'paused')
    `);
    this.#removePendingEntries = db.prepare<[string]>(`
      UPDATE session_queue_entries
      SET status = 'removed'
      WHERE session_id = ?
        AND status IN ('queued', 'active')
    `);
    this.#selectSummary = db.prepare<[string], SummaryRow>(`
      SELECT
        sessions.id AS session_id,
        sessions.section_id,
        sessions.completed_at_ms,
        count(logs.id) AS review_events,
        count(DISTINCT logs.learning_item_id) AS unique_items,
        count(logs.id) FILTER (WHERE logs.rating = 1) AS again_count,
        count(logs.id) FILTER (WHERE logs.rating = 2) AS hard_count,
        count(logs.id) FILTER (WHERE logs.rating = 3) AS good_count,
        count(logs.id) FILTER (WHERE logs.rating = 4) AS easy_count,
        coalesce(sum(logs.review_duration_ms), 0) AS elapsed_active_ms
      FROM review_sessions AS sessions
      LEFT JOIN review_logs AS logs
        ON logs.session_id = sessions.id
      WHERE sessions.id = ?
        AND sessions.status = 'completed'
      GROUP BY sessions.id
    `);

    this.#merge = db.transaction(
      (sessionId: string, nowMs: number): MergeDueItemsResult => {
        const session = this.#selectSession.get(sessionId);
        if (session === undefined) {
          throw new Error("REVIEW_SESSION_NOT_FOUND");
        }
        if (session.status === "paused" || session.status === "completed") {
          return { added: 0, revision: session.revision };
        }

        return this.#mergeWithinTransaction(session, nowMs, false);
      },
    );

    this.#startOrResume = db.transaction(
      (sectionId: string, nowMs: number): ReviewSessionSnapshot => {
        let session = this.#selectOpenSession.get();
        let resumed = false;

        if (session === undefined) {
          if (sectionExists.pluck().get(sectionId) === undefined) {
            throw new Error("REVIEW_SECTION_NOT_FOUND");
          }
          const id = randomUUID();
          this.#insertSession.run({ id, sectionId, nowMs });
          session = this.#selectSession.get(id);
          if (session === undefined) {
            throw new Error("REVIEW_SESSION_INSERT_FAILED");
          }
        } else if (session.section_id !== sectionId) {
          throw new OpenReviewSessionError(session);
        } else if (session.status === "paused") {
          this.#resumeSession.run({ id: session.id, nowMs });
          resumed = true;
          session = this.#selectSession.get(session.id);
          if (session === undefined) {
            throw new Error("REVIEW_SESSION_RESUME_FAILED");
          }
        }

        const merged = this.#mergeWithinTransaction(session, nowMs, resumed);
        const updated = this.#selectSession.get(session.id);
        if (updated === undefined) {
          throw new Error("REVIEW_SESSION_NOT_FOUND");
        }

        return this.#snapshot(updated, nowMs, merged.added);
      },
    );
    this.#pause = db.transaction(
      (sessionId: string, nowMs: number): ReviewSessionSnapshot => {
        let session = this.#selectSession.get(sessionId);
        if (session === undefined) {
          throw new Error("REVIEW_SESSION_NOT_FOUND");
        }
        if (session.status === "completed") {
          throw new Error("REVIEW_SESSION_COMPLETED");
        }
        if (session.status !== "paused") {
          if (
            this.#pauseOpenSession.run({ id: sessionId, nowMs }).changes !== 1
          ) {
            throw new Error("REVIEW_SESSION_PAUSE_FAILED");
          }
          session = this.#selectSession.get(sessionId);
          if (session === undefined) {
            throw new Error("REVIEW_SESSION_NOT_FOUND");
          }
        }
        return this.#snapshot(session, nowMs, 0);
      },
    );
    this.#resume = db.transaction(
      (sessionId: string, nowMs: number): ReviewSessionSnapshot => {
        let session = this.#selectSession.get(sessionId);
        if (session === undefined) {
          throw new Error("REVIEW_SESSION_NOT_FOUND");
        }
        if (session.status === "completed") {
          throw new Error("REVIEW_SESSION_COMPLETED");
        }
        let resumed = false;
        if (session.status === "paused") {
          if (this.#resumeSession.run({ id: sessionId, nowMs }).changes !== 1) {
            throw new Error("REVIEW_SESSION_RESUME_FAILED");
          }
          resumed = true;
          session = this.#selectSession.get(sessionId);
          if (session === undefined) {
            throw new Error("REVIEW_SESSION_NOT_FOUND");
          }
        }
        const merge = this.#mergeWithinTransaction(
          session,
          nowMs,
          resumed,
        );
        const updated = this.#selectSession.get(sessionId);
        if (updated === undefined) {
          throw new Error("REVIEW_SESSION_NOT_FOUND");
        }
        return this.#snapshot(updated, nowMs, merge.added);
      },
    );
    this.#finish = db.transaction(
      (sessionId: string, nowMs: number): ReviewSessionSummary => {
        const session = this.#selectSession.get(sessionId);
        if (session === undefined) {
          throw new Error("REVIEW_SESSION_NOT_FOUND");
        }
        if (session.status !== "completed") {
          if (
            this.#finishOpenSession.run({ id: sessionId, nowMs }).changes !== 1
          ) {
            throw new Error("REVIEW_SESSION_FINISH_FAILED");
          }
          this.#removePendingEntries.run(sessionId);
        }
        return this.#summary(sessionId);
      },
    );
  }

  #mergeWithinTransaction(
    session: SessionRow,
    nowMs: number,
    statusChangedBeforeMerge: boolean,
  ): MergeDueItemsResult {
    const added = this.#insertDueItems.run({
      sessionId: session.id,
      sectionId: session.section_id,
      nowMs,
    }).changes;
    const counts = this.#selectCounts.get(session.id);
    if (counts === undefined) {
      throw new Error("REVIEW_SESSION_COUNTS_FAILED");
    }
    const desiredStatus =
      counts.currently_remaining > 0 ? "active" : "waiting";
    const statusChanged =
      statusChangedBeforeMerge || session.status !== desiredStatus;
    const incrementRevision = added > 0 || statusChanged ? 1 : 0;

    this.#updateSessionAfterMerge.run({
      id: session.id,
      status: desiredStatus,
      incrementRevision,
    });

    return {
      added,
      revision: session.revision + incrementRevision,
    };
  }

  #snapshot(
    session: SessionRow,
    nowMs: number,
    newlyJoined: number,
  ): ReviewSessionSnapshot {
    const counts = this.#selectCounts.get(session.id);
    if (counts === undefined) {
      throw new Error("REVIEW_SESSION_COUNTS_FAILED");
    }
    const elapsedActiveMs = this.#selectElapsedActive.pluck().get(session.id);
    if (elapsedActiveMs === undefined) {
      throw new Error("REVIEW_SESSION_DURATION_FAILED");
    }

    return {
      id: session.id,
      sectionId: session.section_id,
      status: session.status,
      revision: session.revision,
      completedAppearances: counts.completed_appearances,
      currentlyRemaining: counts.currently_remaining,
      newRemaining: counts.new_remaining,
      repeatedWithinSession: Math.max(
        0,
        counts.total_appearances - counts.distinct_items,
      ),
      elapsedActiveMs,
      newlyJoined,
      nextDueAtMs: this.#nearestFutureDue(
        session.section_id,
        nowMs,
      ),
      remainingSnapshotAtMs: nowMs,
    };
  }

  #nearestFutureDue(sectionId: string, nowMs: number): number | null {
    return (
      this.#selectNearestFutureDue.get({ sectionId, nowMs })?.due_at_ms ??
      null
    );
  }

  #summary(sessionId: string): ReviewSessionSummary {
    const row = this.#selectSummary.get(sessionId);
    if (row === undefined) {
      throw new Error("REVIEW_SESSION_SUMMARY_NOT_FOUND");
    }
    return {
      sessionId: row.session_id,
      sectionId: row.section_id,
      completedAtMs: row.completed_at_ms,
      reviewEvents: row.review_events,
      uniqueItems: row.unique_items,
      repeatedWithinSession: Math.max(
        0,
        row.review_events - row.unique_items,
      ),
      elapsedActiveMs: row.elapsed_active_ms,
      ratingCounts: {
        again: row.again_count,
        hard: row.hard_count,
        good: row.good_count,
        easy: row.easy_count,
      },
    };
  }

  startOrResumeSession(
    sectionId: string,
    nowMs: number,
  ): ReviewSessionSnapshot {
    validateIdentifier(sectionId, "REVIEW_SECTION_ID_INVALID");
    validateNow(nowMs);
    return this.#startOrResume.immediate(sectionId, nowMs);
  }

  mergeDueItems(sessionId: string, nowMs: number): MergeDueItemsResult {
    validateIdentifier(sessionId, "REVIEW_SESSION_ID_INVALID");
    validateNow(nowMs);
    return this.#merge.immediate(sessionId, nowMs);
  }

  getNearestFutureDue(sectionId: string, nowMs: number): number | null {
    validateIdentifier(sectionId, "REVIEW_SECTION_ID_INVALID");
    validateNow(nowMs);
    return this.#nearestFutureDue(sectionId, nowMs);
  }

  findNextDue(nowMs: number): DueWakeTarget | null {
    validateNow(nowMs);
    const row = this.#selectNextDueWake.get();
    return row === undefined
      ? null
      : {
          sessionId: row.session_id,
          dueAtMs: row.due_at_ms,
        };
  }

  getSessionSnapshot(
    sessionId: string,
    nowMs: number,
    newlyJoined = 0,
  ): ReviewSessionSnapshot | undefined {
    validateIdentifier(sessionId, "REVIEW_SESSION_ID_INVALID");
    validateNow(nowMs);
    const session = this.#selectSession.get(sessionId);
    return session === undefined
      ? undefined
      : this.#snapshot(session, nowMs, newlyJoined);
  }

  pauseSession(
    sessionId: string,
    nowMs: number,
  ): ReviewSessionSnapshot {
    validateIdentifier(sessionId, "REVIEW_SESSION_ID_INVALID");
    validateNow(nowMs);
    return this.#pause.immediate(sessionId, nowMs);
  }

  resumeSession(
    sessionId: string,
    nowMs: number,
  ): ReviewSessionSnapshot {
    validateIdentifier(sessionId, "REVIEW_SESSION_ID_INVALID");
    validateNow(nowMs);
    return this.#resume.immediate(sessionId, nowMs);
  }

  finishSession(
    sessionId: string,
    nowMs: number,
  ): ReviewSessionSummary {
    validateIdentifier(sessionId, "REVIEW_SESSION_ID_INVALID");
    validateNow(nowMs);
    return this.#finish.immediate(sessionId, nowMs);
  }

  getSessionSummary(
    sessionId: string,
  ): ReviewSessionSummary | undefined {
    validateIdentifier(sessionId, "REVIEW_SESSION_ID_INVALID");
    const session = this.#selectSession.get(sessionId);
    if (session === undefined || session.status !== "completed") {
      return undefined;
    }
    return this.#summary(sessionId);
  }
}
