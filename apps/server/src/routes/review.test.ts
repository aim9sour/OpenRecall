import { openDatabase } from "@openrecall/database";
import {
  TEST_AUTHORITY,
  TEST_ORIGIN,
  testRequestHeaders,
  withTempDatabase,
} from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { buildServer } from "../app.js";

const config = {
  authority: TEST_AUTHORITY,
  dataDirectory: "unused-with-injected-database",
  host: "127.0.0.1",
  locale: "en",
  port: 3_210,
  publicOrigin: TEST_ORIGIN,
} as const;

const SECTION_ID = "d9428888-122b-41e1-985c-61cd3cbb3210";
const ITEM_ID = "a8f65aa8-122b-41e1-985c-61cd3cbb3210";
const PRESENTATION_ID = "b9f65aa8-122b-41e1-985c-61cd3cbb3210";
const SECOND_ITEM_ID = "c8f65aa8-122b-41e1-985c-61cd3cbb3210";
const SECOND_PRESENTATION_ID = "d8f65aa8-122b-41e1-985c-61cd3cbb3210";
const THIRD_ITEM_ID = "e8f65aa8-122b-41e1-985c-61cd3cbb3210";
const THIRD_PRESENTATION_ID = "f8f65aa8-122b-41e1-985c-61cd3cbb3210";

function insertDueCard(db: ReturnType<typeof openDatabase>): void {
  db.exec(`
    INSERT INTO sections
      (id, name, created_at_ms, updated_at_ms)
    VALUES
      ('${SECTION_ID}', 'Biology', 0, 0);

    INSERT INTO learning_items
      (id, section_id, lifecycle, created_at_ms, updated_at_ms)
    VALUES
      ('${ITEM_ID}', '${SECTION_ID}', 'active', 0, 0);

    INSERT INTO presentations
      (
        id, learning_item_id, kind, ordinal, front, back, notes,
        normalized_front, normalized_back
      )
    VALUES
      (
        '${PRESENTATION_ID}', '${ITEM_ID}', 'primary', 0,
        'PRIVATE QUESTION', 'PRIVATE ANSWER', 'PRIVATE NOTES',
        'private question', 'private answer'
      );

    INSERT INTO presentation_exposures
      (presentation_id, show_count)
    VALUES
      ('${PRESENTATION_ID}', 0);

    INSERT INTO scheduler_states
      (
        learning_item_id, section_id, due_at_ms, memory_state, step_index,
        stability, difficulty, elapsed_days_at_last_review, scheduled_days,
        last_review_at_ms, repetitions, lapses, revision, algorithm_id,
        algorithm_version, adapter_version, parameter_profile_id
      )
    VALUES
      (
        '${ITEM_ID}', '${SECTION_ID}', 1000, 'new', NULL,
        0, 0, 0, 0, NULL, 0, 0, 0, 'FSRS-6',
        '6.0', 1, 'official-fsrs6-v1'
      );
  `);
}

function insertAdditionalDueCard(
  db: ReturnType<typeof openDatabase>,
  itemId: string,
  presentationId: string,
  front: string,
): void {
  db.prepare(
    `
      INSERT INTO learning_items
        (id, section_id, lifecycle, created_at_ms, updated_at_ms)
      VALUES
        (@itemId, @sectionId, 'active', 0, 0)
    `,
  ).run({ itemId, sectionId: SECTION_ID });
  db.prepare(
    `
      INSERT INTO presentations
        (
          id, learning_item_id, kind, ordinal, front, back, notes,
          normalized_front, normalized_back
        )
      VALUES
        (
          @presentationId, @itemId, 'primary', 0, @front,
          @back, NULL, @normalizedFront, @normalizedBack
        )
    `,
  ).run({
    presentationId,
    itemId,
    front,
    back: `${front} answer`,
    normalizedFront: front.toLocaleLowerCase("en"),
    normalizedBack: `${front.toLocaleLowerCase("en")} answer`,
  });
  db.prepare(
    `
      INSERT INTO presentation_exposures
        (presentation_id, show_count)
      VALUES
        (@presentationId, 0)
    `,
  ).run({ presentationId });
  db.prepare(
    `
      INSERT INTO scheduler_states
        (
          learning_item_id, section_id, due_at_ms, memory_state, step_index,
          stability, difficulty, elapsed_days_at_last_review, scheduled_days,
          last_review_at_ms, repetitions, lapses, revision, algorithm_id,
          algorithm_version, adapter_version, parameter_profile_id
        )
      VALUES
        (
          @itemId, @sectionId, 1000, 'new', NULL,
          0, 0, 0, 0, NULL, 0, 0, 0, 'FSRS-6',
          '6.0', 1, 'official-fsrs6-v1'
        )
    `,
  ).run({ itemId, sectionId: SECTION_ID });
}

async function mutationHeaders(
  server: Awaited<ReturnType<typeof buildServer>>,
) {
  const bootstrap = await server.inject({
    method: "GET",
    url: "/api/v1/bootstrap",
    headers: testRequestHeaders(),
  });
  return testRequestHeaders({
    csrfToken: bootstrap.json<{ csrfToken: string }>().csrfToken,
    origin: TEST_ORIGIN,
  });
}

describe("review session API", () => {
  it("runs start, claim, shown, reveal, rate, wait, pause, resume, and finish", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      insertDueCard(db);
      let nowMs = 1_000;
      const server = await buildServer({
        config,
        database: db,
        nowMs: () => nowMs,
      });
      const headers = await mutationHeaders(server);

      try {
        const started = await server.inject({
          method: "POST",
          url: "/api/v1/review-sessions",
          headers,
          payload: { sectionId: SECTION_ID },
        });
        expect(started.statusCode).toBe(201);
        const question = started.json<{
          kind: string;
          session: { id: string; currentlyRemaining: number };
          card: {
            entryId: string;
            learningItemId: string;
            presentationId: string;
            stateRevision: number;
          };
        }>();
        expect(question).toMatchObject({
          kind: "question",
          session: { currentlyRemaining: 1 },
          card: {
            learningItemId: ITEM_ID,
            presentationId: PRESENTATION_ID,
            front: "PRIVATE QUESTION",
            stateRevision: 0,
          },
        });
        expect(started.body).not.toContain("PRIVATE ANSWER");
        expect(started.body).not.toContain("PRIVATE NOTES");
        const sessionId = question.session.id;

        const revealTooSoon = await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${sessionId}/current/reveal`,
          headers,
          payload: { entryId: question.card.entryId },
        });
        expect(revealTooSoon.statusCode).toBe(409);
        expect(revealTooSoon.body).not.toMatch(
          /PRIVATE QUESTION|PRIVATE ANSWER|PRIVATE NOTES/,
        );

        nowMs = 1_100;
        const shown = await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${sessionId}/current/shown`,
          headers,
          payload: {
            entryId: question.card.entryId,
            presentationId: question.card.presentationId,
          },
        });
        expect(shown.statusCode).toBe(204);

        nowMs = 1_200;
        const reveal = await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${sessionId}/current/reveal`,
          headers,
          payload: { entryId: question.card.entryId },
        });
        expect(reveal.statusCode).toBe(200);
        expect(reveal.json()).toMatchObject({
          kind: "answer",
          card: {
            front: "PRIVATE QUESTION",
            back: "PRIVATE ANSWER",
            notes: "PRIVATE NOTES",
          },
          outcomes: [
            { rating: 1 },
            { rating: 2 },
            { rating: 3 },
            { rating: 4 },
          ],
        });

        const pausedAnswer = await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${sessionId}/pause`,
          headers,
        });
        expect(pausedAnswer.json()).toMatchObject({
          kind: "answer",
          session: { status: "paused" },
          outcomes: [{ rating: 1 }, { rating: 2 }, { rating: 3 }, { rating: 4 }],
        });
        const blockedWhilePaused = await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${sessionId}/current/rate`,
          headers,
          payload: {
            entryId: question.card.entryId,
            learningItemId: question.card.learningItemId,
            rating: 3,
            expectedStateRevision: question.card.stateRevision,
            idempotencyKey: "blocked-rating-request",
          },
        });
        expect(blockedWhilePaused.statusCode).toBe(409);
        const resumedAnswer = await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${sessionId}/resume`,
          headers,
        });
        expect(resumedAnswer.json()).toMatchObject({
          kind: "answer",
          session: { status: "active" },
        });

        nowMs = 1_300;
        const rated = await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${sessionId}/current/rate`,
          headers,
          payload: {
            entryId: question.card.entryId,
            learningItemId: question.card.learningItemId,
            rating: 3,
            expectedStateRevision: question.card.stateRevision,
            idempotencyKey: "rating-request-1",
          },
        });
        expect(rated.statusCode).toBe(200);
        expect(rated.json()).toMatchObject({
          kind: "waiting",
          session: {
            completedAppearances: 1,
            currentlyRemaining: 0,
          },
        });

        const paused = await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${sessionId}/pause`,
          headers,
        });
        expect(paused.json()).toMatchObject({
          kind: "waiting",
          session: { status: "paused" },
        });

        const resumed = await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${sessionId}/resume`,
          headers,
        });
        expect(resumed.json()).toMatchObject({
          kind: "waiting",
          session: { status: "waiting" },
        });

        const finished = await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${sessionId}/finish`,
          headers,
        });
        expect(finished.statusCode).toBe(200);
        expect(finished.json()).toMatchObject({
          kind: "completed",
          summary: {
            sessionId,
            reviewEvents: 1,
            uniqueItems: 1,
            ratingCounts: { again: 0, hard: 0, good: 1, easy: 0 },
          },
        });
      } finally {
        await server.close();
      }
    });
  });

  it("claims a due learning repetition before the original backlog", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      insertDueCard(db);
      insertAdditionalDueCard(
        db,
        SECOND_ITEM_ID,
        SECOND_PRESENTATION_ID,
        "SECOND QUESTION",
      );
      insertAdditionalDueCard(
        db,
        THIRD_ITEM_ID,
        THIRD_PRESENTATION_ID,
        "THIRD QUESTION",
      );
      db.prepare(
        `
          UPDATE scheduler_states
          SET due_at_ms = CASE learning_item_id
            WHEN @firstItemId THEN 800
            WHEN @secondItemId THEN 900
            WHEN @thirdItemId THEN 1000
          END
          WHERE learning_item_id IN (
            @firstItemId,
            @secondItemId,
            @thirdItemId
          )
        `,
      ).run({
        firstItemId: ITEM_ID,
        secondItemId: SECOND_ITEM_ID,
        thirdItemId: THIRD_ITEM_ID,
      });
      let nowMs = 1000;
      const server = await buildServer({
        config,
        database: db,
        nowMs: () => nowMs,
      });
      const headers = await mutationHeaders(server);

      try {
        const started = await server.inject({
          method: "POST",
          url: "/api/v1/review-sessions",
          headers,
          payload: { sectionId: SECTION_ID },
        });
        const first = started.json<{
          session: { id: string };
          card: {
            entryId: string;
            learningItemId: string;
            presentationId: string;
            stateRevision: number;
          };
        }>();
        expect(first.card.learningItemId).toBe(ITEM_ID);

        nowMs = 1100;
        await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${first.session.id}/current/shown`,
          headers,
          payload: {
            entryId: first.card.entryId,
            presentationId: first.card.presentationId,
          },
        });
        nowMs = 1200;
        await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${first.session.id}/current/reveal`,
          headers,
          payload: { entryId: first.card.entryId },
        });
        nowMs = 1300;
        const ratedFirst = await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${first.session.id}/current/rate`,
          headers,
          payload: {
            entryId: first.card.entryId,
            learningItemId: first.card.learningItemId,
            rating: 1,
            expectedStateRevision: first.card.stateRevision,
            idempotencyKey: "repeat-priority-first",
          },
        });
        const second = ratedFirst.json<{
          card: {
            entryId: string;
            learningItemId: string;
            presentationId: string;
            stateRevision: number;
          };
          session: { nextDueAtMs: number };
        }>();
        expect(second.card.learningItemId).toBe(SECOND_ITEM_ID);

        nowMs = 1400;
        await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${first.session.id}/current/shown`,
          headers,
          payload: {
            entryId: second.card.entryId,
            presentationId: second.card.presentationId,
          },
        });
        nowMs = 1500;
        await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${first.session.id}/current/reveal`,
          headers,
          payload: { entryId: second.card.entryId },
        });
        nowMs = second.session.nextDueAtMs;
        const afterSecondRating = await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${first.session.id}/current/rate`,
          headers,
          payload: {
            entryId: second.card.entryId,
            learningItemId: second.card.learningItemId,
            rating: 3,
            expectedStateRevision: second.card.stateRevision,
            idempotencyKey: "repeat-priority-second",
          },
        });

        expect(afterSecondRating.statusCode).toBe(200);
        expect(afterSecondRating.json()).toMatchObject({
          kind: "question",
          card: { learningItemId: ITEM_ID },
          session: { repeatedWithinSession: 1 },
        });
        expect(afterSecondRating.json()).not.toMatchObject({
          card: { learningItemId: THIRD_ITEM_ID },
        });
      } finally {
        await server.close();
      }
    });
  });

  it("returns safe missing-section and open-session conflicts", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      insertDueCard(db);
      db.prepare(
        `
          INSERT INTO sections (id, name, created_at_ms, updated_at_ms)
          VALUES ('c7f65aa8-122b-41e1-985c-61cd3cbb3210', 'Chemistry', 0, 0)
        `,
      ).run();
      const server = await buildServer({
        config,
        database: db,
        nowMs: () => 1_000,
      });
      const headers = await mutationHeaders(server);

      try {
        const missing = await server.inject({
          method: "POST",
          url: "/api/v1/review-sessions",
          headers,
          payload: {
            sectionId: "e7f65aa8-122b-41e1-985c-61cd3cbb3210",
          },
        });
        expect(missing.statusCode).toBe(404);
        expect(missing.body).not.toMatch(/SQLITE|PRIVATE QUESTION/i);

        const first = await server.inject({
          method: "POST",
          url: "/api/v1/review-sessions",
          headers,
          payload: { sectionId: SECTION_ID },
        });
        const firstSessionId = first.json<{
          session: { id: string };
        }>().session.id;
        const conflict = await server.inject({
          method: "POST",
          url: "/api/v1/review-sessions",
          headers,
          payload: {
            sectionId: "c7f65aa8-122b-41e1-985c-61cd3cbb3210",
          },
        });

        expect(conflict.statusCode).toBe(409);
        expect(conflict.json()).toEqual({
          code: "OPEN_REVIEW_SESSION_EXISTS",
          messageKey: "review.openSessionExists",
          sessionId: firstSessionId,
          sectionId: SECTION_ID,
        });
        expect(conflict.body).not.toMatch(
          /PRIVATE QUESTION|PRIVATE ANSWER|PRIVATE NOTES/,
        );
      } finally {
        await server.close();
      }
    });
  });
});
