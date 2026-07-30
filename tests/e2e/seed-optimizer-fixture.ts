import {
  CURRENT_DEFAULT_SCHEDULER_SETTINGS,
  OFFICIAL_PARAMETER_PROFILE_ID,
  SCHEDULER_ADAPTER_VERSION,
  SCHEDULER_ALGORITHM_ID,
  SCHEDULER_ALGORITHM_VERSION,
  type openDatabase,
} from "../../packages/database/src/index.js";

type ApplicationDatabase = ReturnType<typeof openDatabase>;

export const OPTIMIZER_FIXTURE_SECTION_ID =
  "00000000-0000-4000-8000-000000000100";
export const OPTIMIZER_FIXTURE_SECTION_NAME =
  "Optimizer durability fixture";
export const OPTIMIZER_FIXTURE_ACTIVE_PROFILE_ID =
  "fixture-global-profile";

const SESSION_ID = "00000000-0000-4000-8000-000000000200";
const ITEM_COUNT = 120;
const REVIEWS_PER_ITEM = 5;
const DAY_MS = 86_400_000;
const CREATED_AT_MS = Date.UTC(2023, 0, 1, 12);

export function seedOptimizerFixture(
  db: ApplicationDatabase,
): void {
  const officialWeights = db
    .prepare<
      [string],
      { readonly weights_json: string }
    >(
      "SELECT weights_json FROM parameter_profiles WHERE id = ?",
    )
    .get(OFFICIAL_PARAMETER_PROFILE_ID)?.weights_json;
  if (officialWeights === undefined) {
    throw new Error("E2E_OFFICIAL_PROFILE_MISSING");
  }

  const settingsJson = JSON.stringify(
    CURRENT_DEFAULT_SCHEDULER_SETTINGS,
  );
  const insertItem = db.prepare(`
    INSERT INTO learning_items
      (id, section_id, lifecycle, created_at_ms, updated_at_ms)
    VALUES (?, ?, 'active', ?, ?)
  `);
  const insertPresentation = db.prepare(`
    INSERT INTO presentations
      (
        id, learning_item_id, kind, ordinal, front, back, notes,
        normalized_front, normalized_back, lifecycle
      )
    VALUES (?, ?, 'primary', 0, ?, ?, NULL, ?, ?, 'active')
  `);
  const insertExposure = db.prepare(`
    INSERT INTO presentation_exposures
      (
        presentation_id, first_shown_at_ms, last_shown_at_ms,
        show_count, last_session_id, last_learning_item_id
      )
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertQueueEntry = db.prepare(`
    INSERT INTO session_queue_entries
      (
        id, session_id, learning_item_id, status,
        enqueued_due_at_ms, enqueued_at_ms, activated_at_ms,
        presentation_id, shown_at_ms, revealed_at_ms, completed_at_ms
      )
    VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertState = db.prepare(`
    INSERT INTO scheduler_states
      (
        learning_item_id, section_id, due_at_ms, memory_state,
        step_index, stability, difficulty,
        elapsed_days_at_last_review, scheduled_days,
        last_review_at_ms, repetitions, lapses, revision,
        algorithm_id, algorithm_version, adapter_version,
        parameter_profile_id
      )
    VALUES
      (?, ?, ?, 'review', NULL, 10, 5, 1, 30, ?, ?, 0, ?,
       ?, ?, ?, ?)
  `);
  const insertLog = db.prepare(`
    INSERT INTO review_logs
      (
        id, session_id, queue_entry_id, learning_item_id,
        section_id, presentation_id, front_snapshot, back_snapshot,
        notes_snapshot, rating, shown_at_ms, revealed_at_ms,
        rated_at_ms, review_duration_ms, study_day_delta,
        prior_state_json, result_state_json, algorithm_id,
        algorithm_version, adapter_version, parameter_profile_id,
        time_zone, boundary_minutes, settings_json,
        retrievability_before, resulting_due_at_ms
      )
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 2000, ?,
       ?, ?, ?, ?, ?, ?, 'UTC', 240, ?, 0.8, ?)
  `);

  db.transaction(() => {
    db.prepare(
      `
        INSERT INTO sections
          (id, name, created_at_ms, updated_at_ms)
        VALUES (?, ?, ?, ?)
      `,
    ).run(
      OPTIMIZER_FIXTURE_SECTION_ID,
      OPTIMIZER_FIXTURE_SECTION_NAME,
      CREATED_AT_MS,
      CREATED_AT_MS,
    );
    db.prepare(
      `
        INSERT INTO review_sessions
          (
            id, singleton, section_id, status, started_at_ms,
            resumed_at_ms, paused_at_ms, completed_at_ms, revision
          )
        VALUES (?, 1, ?, 'completed', ?, NULL, NULL, ?, 0)
      `,
    ).run(
      SESSION_ID,
      OPTIMIZER_FIXTURE_SECTION_ID,
      CREATED_AT_MS,
      CREATED_AT_MS + 365 * DAY_MS,
    );
    db.prepare(
      `
        INSERT INTO parameter_profiles
          (
            id, scope_type, section_id, algorithm_id,
            algorithm_version, adapter_version, weights_json,
            eligible_example_count, review_cutoff_ms, status,
            created_at_ms
          )
        VALUES (?, 'global', NULL, ?, ?, ?, ?, 480, NULL, 'active', ?)
      `,
    ).run(
      OPTIMIZER_FIXTURE_ACTIVE_PROFILE_ID,
      SCHEDULER_ALGORITHM_ID,
      SCHEDULER_ALGORITHM_VERSION,
      SCHEDULER_ADAPTER_VERSION,
      officialWeights,
      CREATED_AT_MS,
    );

    let reviewCutoffMs = 0;
    for (let itemIndex = 0; itemIndex < ITEM_COUNT; itemIndex += 1) {
      const identifierSuffix = itemIndex.toString().padStart(12, "0");
      const itemId = `10000000-0000-4000-8000-${identifierSuffix}`;
      const presentationId =
        `20000000-0000-4000-8000-${identifierSuffix}`;
      const queueEntryId =
        `30000000-0000-4000-8000-${identifierSuffix}`;
      const front = `Fixture question ${itemIndex + 1}`;
      const back = `Fixture answer ${itemIndex + 1}`;
      insertItem.run(
        itemId,
        OPTIMIZER_FIXTURE_SECTION_ID,
        CREATED_AT_MS,
        CREATED_AT_MS,
      );
      insertPresentation.run(
        presentationId,
        itemId,
        front,
        back,
        front.toLocaleLowerCase("en-US"),
        back.toLocaleLowerCase("en-US"),
      );
      insertQueueEntry.run(
        queueEntryId,
        SESSION_ID,
        itemId,
        CREATED_AT_MS,
        CREATED_AT_MS,
        CREATED_AT_MS,
        presentationId,
        CREATED_AT_MS,
        CREATED_AT_MS,
        CREATED_AT_MS + 365 * DAY_MS,
      );

      let ratedAtMs = CREATED_AT_MS;
      for (
        let reviewIndex = 0;
        reviewIndex < REVIEWS_PER_ITEM;
        reviewIndex += 1
      ) {
        const deltaDays =
          reviewIndex === 0
            ? 0
            : reviewIndex === 1
              ? ((itemIndex % 4) + 1) * 2
              : ((itemIndex + reviewIndex) % 29) + 1;
        ratedAtMs += deltaDays * DAY_MS;
        const shownAtMs = ratedAtMs - 4_000;
        const revealedAtMs = ratedAtMs - 2_000;
        const rating = ((itemIndex + reviewIndex) % 4) + 1;
        const stateJson = JSON.stringify({
          schemaVersion: 1,
          revision: reviewIndex,
        });
        insertLog.run(
          `fixture-log-${itemIndex}-${reviewIndex}`,
          SESSION_ID,
          queueEntryId,
          itemId,
          OPTIMIZER_FIXTURE_SECTION_ID,
          presentationId,
          front,
          back,
          rating,
          shownAtMs,
          revealedAtMs,
          ratedAtMs,
          deltaDays,
          stateJson,
          JSON.stringify({
            schemaVersion: 1,
            revision: reviewIndex + 1,
          }),
          SCHEDULER_ALGORITHM_ID,
          SCHEDULER_ALGORITHM_VERSION,
          SCHEDULER_ADAPTER_VERSION,
          OPTIMIZER_FIXTURE_ACTIVE_PROFILE_ID,
          settingsJson,
          ratedAtMs + 30 * DAY_MS,
        );
      }
      insertExposure.run(
        presentationId,
        CREATED_AT_MS,
        ratedAtMs,
        REVIEWS_PER_ITEM,
        SESSION_ID,
        itemId,
      );
      insertState.run(
        itemId,
        OPTIMIZER_FIXTURE_SECTION_ID,
        ratedAtMs + 30 * DAY_MS,
        ratedAtMs,
        REVIEWS_PER_ITEM,
        REVIEWS_PER_ITEM,
        SCHEDULER_ALGORITHM_ID,
        SCHEDULER_ALGORITHM_VERSION,
        SCHEDULER_ADAPTER_VERSION,
        OPTIMIZER_FIXTURE_ACTIVE_PROFILE_ID,
      );
      reviewCutoffMs = Math.max(reviewCutoffMs, ratedAtMs);
    }

    db.prepare(
      `
        UPDATE parameter_profiles
        SET review_cutoff_ms = ?
        WHERE id = ?
      `,
    ).run(reviewCutoffMs, OPTIMIZER_FIXTURE_ACTIVE_PROFILE_ID);
  })();
}
