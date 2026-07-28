import type { openDatabase } from "./open-database.js";

export const SECTION_ONE = "section-1";
export const SECTION_TWO = "section-2";
export const ITEM_ONE = "item-1";

export function seedStatisticsFixture(
  db: ReturnType<typeof openDatabase>,
): void {
  const t1 = Date.parse("2025-01-15T01:59:00Z");
  const t2 = Date.parse("2025-01-15T02:00:00Z");
  const t3 = Date.parse("2025-01-16T06:00:00Z");
  const t4 = Date.parse("2025-01-17T06:00:00Z");
  db.exec(`
    INSERT INTO sections
      (id, name, created_at_ms, updated_at_ms)
    VALUES
      ('${SECTION_ONE}', 'Biology', 0, 0),
      ('${SECTION_TWO}', 'Chemistry', 0, 0);

    INSERT INTO learning_items
      (id, section_id, lifecycle, created_at_ms, updated_at_ms, trashed_at_ms)
    VALUES
      ('${ITEM_ONE}', '${SECTION_ONE}', 'active', 0, 0, NULL),
      ('item-2', '${SECTION_ONE}', 'active', 0, 0, NULL),
      ('item-3', '${SECTION_TWO}', 'trashed', 0, 0, 100),
      ('item-4', '${SECTION_TWO}', 'active', 0, 0, NULL);

    INSERT INTO presentations
      (
        id, learning_item_id, kind, ordinal, front, back, notes,
        normalized_front, normalized_back, lifecycle
      )
    VALUES
      ('p1', '${ITEM_ONE}', 'primary', 0, 'Q1', 'A1', NULL, 'Q1', 'A1', 'active'),
      ('p1v', '${ITEM_ONE}', 'variant', 1, 'Q1 alt', 'A1', 'Hint', 'Q1 alt', 'A1', 'active'),
      ('p2', 'item-2', 'primary', 0, 'Q2', 'A2', NULL, 'Q2', 'A2', 'active'),
      ('p3', 'item-3', 'primary', 0, 'Q3', 'A3', NULL, 'Q3', 'A3', 'active'),
      ('p4', 'item-4', 'primary', 0, 'Q4', 'A4', NULL, 'Q4', 'A4', 'active');

    INSERT INTO presentation_exposures
      (
        presentation_id, first_shown_at_ms, last_shown_at_ms, show_count,
        last_session_id, last_learning_item_id
      )
    VALUES
      ('p1', ${t1}, ${t2}, 2, 'session-1', '${ITEM_ONE}'),
      ('p1v', ${t3}, ${t3}, 1, 'session-1', '${ITEM_ONE}'),
      ('p2', ${t3}, ${t3}, 1, 'session-1', 'item-2'),
      ('p3', ${t4}, ${t4}, 1, 'session-2', 'item-3'),
      ('p4', NULL, NULL, 0, NULL, NULL);

    INSERT INTO scheduler_states
      (
        learning_item_id, section_id, due_at_ms, memory_state, step_index,
        stability, difficulty, elapsed_days_at_last_review, scheduled_days,
        last_review_at_ms, repetitions, lapses, revision, algorithm_id,
        algorithm_version, adapter_version, parameter_profile_id
      )
    VALUES
      (
        '${ITEM_ONE}', '${SECTION_ONE}', ${Date.parse("2025-01-20T04:00:00Z")},
        'review', NULL, 10, 5, 1, 5, ${t2}, 2, 1, 2,
        'FSRS-6', '6.0', 1, 'official-fsrs6-v1'
      ),
      (
        'item-2', '${SECTION_ONE}', ${Date.parse("2025-01-17T00:00:00Z")},
        'learning', 0, 1, 6, 0, 0, ${t3}, 1, 0, 1,
        'FSRS-6', '6.0', 1, 'official-fsrs6-v1'
      ),
      (
        'item-3', '${SECTION_TWO}', ${Date.parse("2025-01-25T00:00:00Z")},
        'relearning', 0, 2, 7, 1, 1, ${t4}, 4, 2, 4,
        'FSRS-6', '6.0', 1, 'official-fsrs6-v1'
      ),
      (
        'item-4', '${SECTION_TWO}', ${Date.parse("2025-01-18T00:00:00Z")},
        'new', NULL, 0, 0, 0, 0, NULL, 0, 0, 0,
        'FSRS-6', '6.0', 1, 'official-fsrs6-v1'
      );

    INSERT INTO review_sessions
      (
        id, section_id, status, started_at_ms, completed_at_ms, revision
      )
    VALUES
      ('session-1', '${SECTION_ONE}', 'completed', ${t1 - 1000}, ${t3}, 3),
      ('session-2', '${SECTION_TWO}', 'completed', ${t4 - 1000}, ${t4}, 1);

    INSERT INTO session_queue_entries
      (
        id, session_id, learning_item_id, status, enqueued_due_at_ms,
        enqueued_at_ms, activated_at_ms, presentation_id, shown_at_ms,
        revealed_at_ms, completed_at_ms
      )
    VALUES
      ('q1', 'session-1', '${ITEM_ONE}', 'completed', ${t1}, ${t1}, ${t1}, 'p1', ${t1}, ${t1}, ${t1}),
      ('q2', 'session-1', '${ITEM_ONE}', 'completed', ${t2}, ${t2}, ${t2}, 'p1v', ${t2}, ${t2}, ${t2}),
      ('q3', 'session-1', 'item-2', 'completed', ${t3}, ${t3}, ${t3}, 'p2', ${t3}, ${t3}, ${t3}),
      ('q4', 'session-2', 'item-3', 'completed', ${t4}, ${t4}, ${t4}, 'p3', ${t4}, ${t4}, ${t4});
  `);

  const insertLog = db.prepare(`
    INSERT INTO review_logs
      (
        id, session_id, queue_entry_id, learning_item_id, section_id,
        presentation_id, front_snapshot, back_snapshot, notes_snapshot,
        rating, shown_at_ms, revealed_at_ms, rated_at_ms, review_duration_ms,
        study_day_delta, prior_state_json, result_state_json, algorithm_id,
        algorithm_version, adapter_version, parameter_profile_id, time_zone,
        boundary_minutes, settings_json, retrievability_before,
        resulting_due_at_ms
      )
    VALUES
      (
        @id, @sessionId, @queueEntryId, @learningItemId, @sectionId,
        @presentationId, @front, @back, @notes, @rating, @ratedAtMs,
        @ratedAtMs, @ratedAtMs, @durationMs, 1, '{}', '{}', 'FSRS-6',
        '6.0', 1, 'official-fsrs6-v1', 'Africa/Cairo', 240, '{}',
        @retrievability, @resultingDueAtMs
      )
  `);
  [
    {
      id: "l1",
      sessionId: "session-1",
      queueEntryId: "q1",
      learningItemId: ITEM_ONE,
      sectionId: SECTION_ONE,
      presentationId: "p1",
      front: "Q1 old",
      back: "A1 old",
      notes: null,
      rating: 1,
      ratedAtMs: t1,
      durationMs: 100,
      retrievability: 0.2,
      resultingDueAtMs: t2,
    },
    {
      id: "l2",
      sessionId: "session-1",
      queueEntryId: "q2",
      learningItemId: ITEM_ONE,
      sectionId: SECTION_ONE,
      presentationId: "p1v",
      front: "Q1 alt",
      back: "A1",
      notes: "Hint",
      rating: 3,
      ratedAtMs: t2,
      durationMs: null,
      retrievability: null,
      resultingDueAtMs: t3,
    },
    {
      id: "l3",
      sessionId: "session-1",
      queueEntryId: "q3",
      learningItemId: "item-2",
      sectionId: SECTION_ONE,
      presentationId: "p2",
      front: "Q2",
      back: "A2",
      notes: null,
      rating: 4,
      ratedAtMs: t3,
      durationMs: 300,
      retrievability: 0.8,
      resultingDueAtMs: t4,
    },
    {
      id: "l4",
      sessionId: "session-2",
      queueEntryId: "q4",
      learningItemId: "item-3",
      sectionId: SECTION_TWO,
      presentationId: "p3",
      front: "Q3",
      back: "A3",
      notes: null,
      rating: 2,
      ratedAtMs: t4,
      durationMs: 200,
      retrievability: 0.6,
      resultingDueAtMs: t4,
    },
  ].forEach((row) => insertLog.run(row));
}
