import {
  CardImportRepository,
  CardRepository,
  ReviewQueueRepository,
  SectionRepository,
  openDatabase,
} from "@openrecall/database";
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

async function mutationHeaders(server: Awaited<ReturnType<typeof buildServer>>) {
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

describe("card management API", () => {
  it("lists bounded searchable lifecycle pages without normalized internals", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const section = new SectionRepository(db).createSection({
        name: "Biology",
        nowMs: 100,
      });
      const ids = new CardImportRepository(db).commitImport(
        section.id,
        [
          {
            sourceIndex: 0,
            front: "First",
            back: "One",
            notes: null,
            variants: [],
          },
          {
            sourceIndex: 1,
            front: "Second",
            back: "Two",
            notes: null,
            variants: [
              { front: "Mitochondria variant", back: "Power", notes: null },
            ],
          },
        ],
        1_000,
      ).importedItemIds;
      const cards = new CardRepository(db);
      cards.trashItem({
        itemId: ids[0]!,
        expectedUpdatedAtMs: 1_000,
        nowMs: 2_000,
      });
      const server = await buildServer({ config, database: db, nowMs: () => 3_000 });

      try {
        const active = await server.inject({
          method: "GET",
          url: `/api/v1/sections/${section.id}/cards?query=mitochondria&limit=1`,
          headers: testRequestHeaders(),
        });
        expect(active.statusCode).toBe(200);
        expect(active.json<{ items: unknown[] }>().items).toHaveLength(1);
        expect(active.body).not.toMatch(/normalized_front|normalized_back/);

        const trash = await server.inject({
          method: "GET",
          url: `/api/v1/sections/${section.id}/cards?lifecycle=trashed`,
          headers: testRequestHeaders(),
        });
        expect(trash.json<{ items: Array<{ id: string }> }>().items[0]?.id).toBe(
          ids[0],
        );
        const tooLarge = await server.inject({
          method: "GET",
          url: `/api/v1/sections/${section.id}/cards?limit=101`,
          headers: testRequestHeaders(),
        });
        expect(tooLarge.statusCode).toBe(400);
      } finally {
        await server.close();
      }
    });
  });

  it("edits with validation and optimistic conflict responses", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const section = new SectionRepository(db).createSection({
        name: "Biology",
        nowMs: 100,
      });
      const itemId = new CardImportRepository(db).commitImport(
        section.id,
        [
          {
            sourceIndex: 0,
            front: "Question",
            back: "Answer",
            notes: null,
            variants: [],
          },
        ],
        1_000,
      ).importedItemIds[0]!;
      let nowMs = 2_000;
      const server = await buildServer({ config, database: db, nowMs: () => nowMs });
      const headers = await mutationHeaders(server);

      try {
        const invalid = await server.inject({
          method: "PUT",
          url: `/api/v1/cards/${itemId}`,
          headers,
          payload: {
            expectedUpdatedAtMs: 1_000,
            presentations: [{ front: "<b>Question</b>", back: "Answer" }],
          },
        });
        expect(invalid.statusCode).toBe(400);
        expect(invalid.json<{ fieldErrors: Array<{ path: string }> }>().fieldErrors)
          .toEqual(expect.arrayContaining([
            expect.objectContaining({ path: "presentations[0].front" }),
          ]));

        const updated = await server.inject({
          method: "PUT",
          url: `/api/v1/cards/${itemId}`,
          headers,
          payload: {
            expectedUpdatedAtMs: 1_000,
            presentations: [
              { front: "Edited", back: "Answer", notes: "" },
              { front: "Variant", back: "Alternative" },
            ],
          },
        });
        expect(updated.statusCode).toBe(200);
        expect(updated.json()).toMatchObject({
          id: itemId,
          updatedAtMs: 2_000,
          presentations: [
            { kind: "primary", front: "Edited", notes: null },
            { kind: "variant", front: "Variant", notes: null },
          ],
        });

        nowMs = 3_000;
        const stale = await server.inject({
          method: "PUT",
          url: `/api/v1/cards/${itemId}`,
          headers,
          payload: {
            expectedUpdatedAtMs: 1_000,
            presentations: [{ front: "Stale", back: "Answer" }],
          },
        });
        expect(stale.statusCode).toBe(409);
        expect(stale.json()).toMatchObject({ code: "CARD_EDIT_CONFLICT" });
      } finally {
        await server.close();
      }
    });
  });

  it("trashes queue work, restores it, and requires explicit permanent confirmation", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const section = new SectionRepository(db).createSection({
        name: "Biology",
        nowMs: 100,
      });
      const itemId = new CardImportRepository(db).commitImport(
        section.id,
        [
          {
            sourceIndex: 0,
            front: "Question",
            back: "Answer",
            notes: null,
            variants: [],
          },
        ],
        1_000,
      ).importedItemIds[0]!;
      new ReviewQueueRepository(db).startOrResumeSession(section.id, 1_000);
      let nowMs = 2_000;
      const server = await buildServer({ config, database: db, nowMs: () => nowMs });
      const headers = await mutationHeaders(server);

      try {
        const trashed = await server.inject({
          method: "POST",
          url: `/api/v1/cards/${itemId}/trash`,
          headers,
          payload: { expectedUpdatedAtMs: 1_000 },
        });
        expect(trashed.statusCode).toBe(200);
        expect(trashed.json()).toMatchObject({ lifecycle: "trashed" });
        expect(
          db
            .prepare(
              "SELECT status FROM session_queue_entries WHERE learning_item_id = ?",
            )
            .pluck()
            .get(itemId),
        ).toBe("removed");

        nowMs = 3_000;
        const restored = await server.inject({
          method: "POST",
          url: `/api/v1/cards/${itemId}/restore`,
          headers,
          payload: { expectedUpdatedAtMs: 2_000 },
        });
        expect(restored.json()).toMatchObject({ lifecycle: "active" });

        const mismatch = await server.inject({
          method: "DELETE",
          url: `/api/v1/cards/${itemId}/permanent`,
          headers,
          payload: {
            confirmationItemId: "d9428888-122b-41e1-985c-61cd3cbb3210",
            expectedUpdatedAtMs: 3_000,
          },
        });
        expect(mismatch.statusCode).toBe(409);
        expect(mismatch.json()).toMatchObject({
          code: "PERMANENT_DELETE_CONFIRMATION_MISMATCH",
        });

        const removed = await server.inject({
          method: "DELETE",
          url: `/api/v1/cards/${itemId}/permanent`,
          headers,
          payload: {
            confirmationItemId: itemId,
            expectedUpdatedAtMs: 3_000,
          },
        });
        expect(removed.statusCode).toBe(204);
        const missing = await server.inject({
          method: "GET",
          url: `/api/v1/cards/${itemId}`,
          headers: testRequestHeaders(),
        });
        expect(missing.statusCode).toBe(404);
      } finally {
        await server.close();
      }
    });
  });
});
