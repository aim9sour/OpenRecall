import {
  openDatabase,
  SectionRepository,
} from "@openrecall/database";
import {
  TEST_AUTHORITY,
  TEST_ORIGIN,
  testRequestHeaders,
  withTempDatabase,
} from "@openrecall/test-support";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../app.js";
import type { OptimizerRunServiceApi } from "../optimizer/optimizer-run-service.js";
import { ReviewEvents } from "../review/review-events.js";

const TEST_CONFIG = {
  authority: TEST_AUTHORITY,
  dataDirectory: "unused-with-injected-database",
  host: "127.0.0.1",
  locale: "en",
  port: 3_210,
  publicOrigin: TEST_ORIGIN,
} as const;

function optimizerStub(
  quiesceForSectionDeletion: OptimizerRunServiceApi["quiesceForSectionDeletion"],
): OptimizerRunServiceApi {
  return {
    getEligibility() {
      throw new Error("UNEXPECTED_OPTIMIZER_CALL");
    },
    startRun() {
      throw new Error("UNEXPECTED_OPTIMIZER_CALL");
    },
    getRun() {
      return null;
    },
    cancelRun() {
      return false;
    },
    quiesceForSectionDeletion,
    async whenIdle() {},
    dispose() {},
  };
}

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

describe("section routes", () => {
  it("creates, lists, and retrieves a learning section", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const server = await buildServer({
        config: TEST_CONFIG,
        database: db,
        nowMs: () => 1_234,
      });

      try {
        const bootstrap = await server.inject({
          method: "GET",
          url: "/api/v1/bootstrap",
          headers: testRequestHeaders(),
        });
        const { csrfToken } = bootstrap.json<{ csrfToken: string }>();
        const createdResponse = await server.inject({
          method: "POST",
          url: "/api/v1/sections",
          headers: testRequestHeaders({
            csrfToken,
            origin: TEST_ORIGIN,
          }),
          payload: { name: "  Biology  " },
        });

        expect(createdResponse.statusCode).toBe(201);
        const created = createdResponse.json<{
          id: string;
          name: string;
          createdAtMs: number;
          updatedAtMs: number;
        }>();
        expect(created).toEqual({
          id: expect.any(String),
          name: "Biology",
          createdAtMs: 1_234,
          updatedAtMs: 1_234,
        });

        const listResponse = await server.inject({
          method: "GET",
          url: "/api/v1/sections",
          headers: testRequestHeaders(),
        });
        expect(listResponse.statusCode).toBe(200);
        expect(listResponse.json()).toEqual([
          {
            id: created.id,
            name: "Biology",
            createdAtMs: 1_234,
            updatedAtMs: 1_234,
            counts: { total: 0, new: 0, dueNow: 0 },
            nextDueAtMs: null,
          },
        ]);

        const detailResponse = await server.inject({
          method: "GET",
          url: `/api/v1/sections/${created.id}`,
          headers: testRequestHeaders(),
        });
        expect(detailResponse.statusCode).toBe(200);
        expect(detailResponse.json()).toEqual(listResponse.json()[0]);
      } finally {
        await server.close();
      }
    });
  });

  it("renames a section and rejects stale, invalid, and missing edits", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      let nowMs = 1_000;
      const server = await buildServer({
        config: TEST_CONFIG,
        database: db,
        nowMs: () => nowMs,
      });
      try {
        const bootstrap = await server.inject({
          method: "GET",
          url: "/api/v1/bootstrap",
          headers: testRequestHeaders(),
        });
        const headers = testRequestHeaders({
          csrfToken: bootstrap.json<{ csrfToken: string }>().csrfToken,
          origin: TEST_ORIGIN,
        });
        const createdResponse = await server.inject({
          method: "POST",
          url: "/api/v1/sections",
          headers,
          payload: { name: "Biology" },
        });
        const created = createdResponse.json<{
          id: string;
          updatedAtMs: number;
        }>();

        const renamed = await server.inject({
          method: "PATCH",
          url: `/api/v1/sections/${created.id}`,
          headers,
          payload: {
            name: "  Human Biology  ",
            expectedUpdatedAtMs: created.updatedAtMs,
          },
        });
        expect(renamed.statusCode).toBe(200);
        expect(renamed.json()).toMatchObject({
          id: created.id,
          name: "Human Biology",
          updatedAtMs: 1_001,
        });

        nowMs = 2_000;
        const stale = await server.inject({
          method: "PATCH",
          url: `/api/v1/sections/${created.id}`,
          headers,
          payload: {
            name: "Stale",
            expectedUpdatedAtMs: created.updatedAtMs,
          },
        });
        expect(stale.statusCode).toBe(409);
        expect(stale.json()).toMatchObject({
          code: "SECTION_CONFLICT",
          messageKey: "section.rename.conflict",
          current: {
            id: created.id,
            name: "Human Biology",
            updatedAtMs: 1_001,
          },
        });

        const invalid = await server.inject({
          method: "PATCH",
          url: `/api/v1/sections/${created.id}`,
          headers,
          payload: {
            name: " \n\t ",
            expectedUpdatedAtMs: 1_001,
          },
        });
        expect(invalid.statusCode).toBe(400);
        expect(invalid.json()).toMatchObject({
          code: "VALIDATION_ERROR",
          fieldErrors: [
            { path: "/name", messageKey: "error.field.invalid" },
          ],
        });

        const missing = await server.inject({
          method: "PATCH",
          url: "/api/v1/sections/d9428888-122b-41e1-985c-61cd3cbb3210",
          headers,
          payload: { name: "Missing", expectedUpdatedAtMs: 1_000 },
        });
        expect(missing.statusCode).toBe(404);
        expect(missing.json()).toEqual({
          code: "SECTION_NOT_FOUND",
          messageKey: "error.sectionNotFound",
        });
      } finally {
        await server.close();
      }
    });
  });

  it("returns a localized validation envelope for a whitespace name", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const server = await buildServer({
        config: TEST_CONFIG,
        database: db,
      });

      try {
        const bootstrap = await server.inject({
          method: "GET",
          url: "/api/v1/bootstrap",
          headers: testRequestHeaders(),
        });
        const { csrfToken } = bootstrap.json<{ csrfToken: string }>();
        const response = await server.inject({
          method: "POST",
          url: "/api/v1/sections",
          headers: testRequestHeaders({
            csrfToken,
            origin: TEST_ORIGIN,
          }),
          payload: { name: " \n\t " },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({
          code: "VALIDATION_ERROR",
          messageKey: "error.validation",
          fieldErrors: [
            { path: "/name", messageKey: "error.field.invalid" },
          ],
        });
      } finally {
        await server.close();
      }
    });
  });

  it("returns a content-free 404 for a missing UUID", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const server = await buildServer({
        config: TEST_CONFIG,
        database: db,
      });

      try {
        const response = await server.inject({
          method: "GET",
          url: "/api/v1/sections/d9428888-122b-41e1-985c-61cd3cbb3210",
          headers: testRequestHeaders(),
        });

        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({
          code: "SECTION_NOT_FOUND",
          messageKey: "error.sectionNotFound",
        });
        expect(response.body).not.toContain("SQLITE");
      } finally {
        await server.close();
      }
    });
  });

  it("requires explicit deletion confirmation before invoking services", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const repository = new SectionRepository(db);
      const section = repository.createSection({ name: "Biology", nowMs: 1_000 });
      const quiesce = vi.fn(async () => () => undefined);
      const events = new ReviewEvents();
      const publish = vi.spyOn(events, "publish");
      let rearm!: ReturnType<typeof vi.fn>;
      const server = await buildServer({
        config: TEST_CONFIG,
        database: db,
        nowMs: () => 1_000,
        optimizerService: optimizerStub(quiesce),
        reviewEvents: events,
        onDueWakeReady(wake) {
          rearm = vi.spyOn(wake, "rearm");
        },
      });

      try {
        const headers = await mutationHeaders(server);
        for (const payload of [
          { expectedUpdatedAtMs: section.updatedAtMs },
          { confirmed: false, expectedUpdatedAtMs: section.updatedAtMs },
        ]) {
          const response = await server.inject({
            method: "DELETE",
            url: `/api/v1/sections/${section.id}`,
            headers,
            payload,
          });
          expect(response.statusCode).toBe(400);
          expect(response.json()).toEqual({
            code: "SECTION_DELETE_CONFIRMATION_REQUIRED",
            messageKey: "section.delete.confirmationRequired",
          });
        }
        expect(quiesce).not.toHaveBeenCalled();
        expect(rearm).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
        expect(repository.getSection(section.id, 1_000)).toBeDefined();
      } finally {
        await server.close();
      }
    });
  });

  it("returns not-found and stale conflicts without publishing deletion", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const repository = new SectionRepository(db);
      const section = repository.createSection({ name: "Biology", nowMs: 1_000 });
      const release = vi.fn();
      const quiesce = vi.fn(async () => release);
      const events = new ReviewEvents();
      const publish = vi.spyOn(events, "publish");
      let rearm!: ReturnType<typeof vi.fn>;
      const server = await buildServer({
        config: TEST_CONFIG,
        database: db,
        nowMs: () => 2_000,
        optimizerService: optimizerStub(quiesce),
        reviewEvents: events,
        onDueWakeReady(wake) {
          rearm = vi.spyOn(wake, "rearm");
        },
      });

      try {
        const headers = await mutationHeaders(server);
        const missing = await server.inject({
          method: "DELETE",
          url: "/api/v1/sections/d9428888-122b-41e1-985c-61cd3cbb3210",
          headers,
          payload: { confirmed: true, expectedUpdatedAtMs: 1_000 },
        });
        expect(missing.statusCode).toBe(404);

        const stale = await server.inject({
          method: "DELETE",
          url: `/api/v1/sections/${section.id}`,
          headers,
          payload: { confirmed: true, expectedUpdatedAtMs: 999 },
        });
        expect(stale.statusCode).toBe(409);
        expect(stale.json()).toMatchObject({
          code: "SECTION_CONFLICT",
          messageKey: "section.delete.conflict",
          current: { id: section.id, updatedAtMs: section.updatedAtMs },
        });
        expect(quiesce).toHaveBeenCalledTimes(2);
        expect(release).toHaveBeenCalledTimes(2);
        expect(rearm).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
      } finally {
        await server.close();
      }
    });
  });

  it.each(["active", "waiting", "paused"] as const)(
    "permanently deletes a section and its %s review session in the coordinated order",
    async (status) => {
      await withTempDatabase(async (databasePath) => {
        const db = openDatabase(databasePath);
        const repository = new SectionRepository(db);
        const section = repository.createSection({ name: "Biology", nowMs: 1_000 });
        db.prepare(
          "INSERT INTO review_sessions (id, section_id, status, started_at_ms) VALUES (?, ?, ?, ?)",
        ).run(`session-${status}`, section.id, status, 1_000);

        const order: string[] = [];
        const optimizer = optimizerStub(async () => {
          order.push("gate");
          return () => order.push("release");
        });
        const events = new ReviewEvents();
        vi.spyOn(events, "publish").mockImplementation((event) => {
          expect(repository.getSection(section.id, 2_000)).toBeUndefined();
          expect(event).toEqual({
            event: "section-deleted",
            data: { sectionId: section.id },
          });
          order.push("publish");
        });
        const server = await buildServer({
          config: TEST_CONFIG,
          database: db,
          nowMs: () => 2_000,
          optimizerService: optimizer,
          reviewEvents: events,
          onDueWakeReady(wake) {
            vi.spyOn(wake, "rearm").mockImplementation(() => {
              expect(repository.getSection(section.id, 2_000)).toBeUndefined();
              order.push("wake");
            });
          },
        });

        try {
          const response = await server.inject({
            method: "DELETE",
            url: `/api/v1/sections/${section.id}`,
            headers: await mutationHeaders(server),
            payload: {
              confirmed: true,
              expectedUpdatedAtMs: section.updatedAtMs,
            },
          });
          expect(response.statusCode).toBe(204);
          expect(response.body).toBe("");
          expect(order).toEqual(["gate", "wake", "publish", "release"]);
          expect(repository.getSection(section.id, 2_000)).toBeUndefined();
          expect(
            db.prepare("SELECT count(*) FROM review_sessions WHERE id = ?").pluck().get(`session-${status}`),
          ).toBe(0);
        } finally {
          await server.close();
        }
      });
    },
  );

  it("keeps data intact and releases the optimizer gate when SQLite deletion fails", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const repository = new SectionRepository(db);
      const section = repository.createSection({ name: "Biology", nowMs: 1_000 });
      db.prepare(
        "INSERT INTO review_sessions (id, section_id, status, started_at_ms) VALUES (?, ?, 'paused', ?)",
      ).run("session-failure", section.id, 1_000);
      db.exec(`
        CREATE TRIGGER fail_test_section_delete
        BEFORE DELETE ON sections
        BEGIN
          SELECT RAISE(ABORT, 'EXPECTED_SECTION_DELETE_FAILURE');
        END;
      `);
      const release = vi.fn();
      const events = new ReviewEvents();
      const publish = vi.spyOn(events, "publish");
      let rearm!: ReturnType<typeof vi.fn>;
      const server = await buildServer({
        config: TEST_CONFIG,
        database: db,
        optimizerService: optimizerStub(async () => release),
        reviewEvents: events,
        onDueWakeReady(wake) {
          rearm = vi.spyOn(wake, "rearm");
        },
      });

      try {
        const response = await server.inject({
          method: "DELETE",
          url: `/api/v1/sections/${section.id}`,
          headers: await mutationHeaders(server),
          payload: { confirmed: true, expectedUpdatedAtMs: section.updatedAtMs },
        });
        expect(response.statusCode).toBe(500);
        expect(release).toHaveBeenCalledOnce();
        expect(rearm).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
        expect(repository.getSection(section.id, 1_000)).toBeDefined();
        expect(
          db.prepare("SELECT count(*) FROM review_sessions WHERE id = 'session-failure'").pluck().get(),
        ).toBe(1);
      } finally {
        await server.close();
      }
    });
  });

  it("publishes deletion and releases the gate after a post-commit wake failure", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const repository = new SectionRepository(db);
      const section = repository.createSection({ name: "Biology", nowMs: 1_000 });
      const order: string[] = [];
      const events = new ReviewEvents();
      vi.spyOn(events, "publish").mockImplementation(() => order.push("publish"));
      const server = await buildServer({
        config: TEST_CONFIG,
        database: db,
        optimizerService: optimizerStub(async () => {
          order.push("gate");
          return () => order.push("release");
        }),
        reviewEvents: events,
        onDueWakeReady(wake) {
          vi.spyOn(wake, "rearm").mockImplementation(() => {
            order.push("wake");
            throw new Error("EXPECTED_WAKE_FAILURE");
          });
        },
      });

      try {
        const response = await server.inject({
          method: "DELETE",
          url: `/api/v1/sections/${section.id}`,
          headers: await mutationHeaders(server),
          payload: { confirmed: true, expectedUpdatedAtMs: section.updatedAtMs },
        });
        expect(response.statusCode).toBe(500);
        expect(order).toEqual(["gate", "wake", "publish", "release"]);
        expect(repository.getSection(section.id, 1_000)).toBeUndefined();
      } finally {
        await server.close();
      }
    });
  });
});
