import { openDatabase } from "@openrecall/database";
import {
  TEST_AUTHORITY,
  TEST_ORIGIN,
  testRequestHeaders,
  withTempDatabase,
} from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { buildServer } from "../app.js";

const TEST_CONFIG = {
  authority: TEST_AUTHORITY,
  dataDirectory: "unused-with-injected-database",
  host: "127.0.0.1",
  locale: "en",
  port: 3_210,
  publicOrigin: TEST_ORIGIN,
} as const;

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
});
