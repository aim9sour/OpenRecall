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

describe("application locale preference routes", () => {
  it("initializes bootstrap from SQLite and saves with monotonic concurrency", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      let nowMs = 1_500;
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
        expect(bootstrap.json()).toMatchObject({
          locale: "en",
          localeUpdatedAtMs: 1_500,
        });
        expect(
          JSON.parse(
            db
              .prepare(
                "SELECT json_value FROM application_settings WHERE key = 'ui.locale'",
              )
              .pluck()
              .get() as string,
          ),
        ).toEqual({ version: 1, locale: "en" });

        const headers = await mutationHeaders(server);
        const saved = await server.inject({
          method: "PUT",
          url: "/api/v1/application-settings/locale",
          headers,
          payload: { locale: "ar", expectedUpdatedAtMs: 1_500 },
        });
        expect(saved.statusCode).toBe(200);
        expect(saved.json()).toEqual({
          locale: "ar",
          updatedAtMs: 1_501,
        });

        nowMs = 2_000;
        const stale = await server.inject({
          method: "PUT",
          url: "/api/v1/application-settings/locale",
          headers,
          payload: { locale: "en", expectedUpdatedAtMs: 1_500 },
        });
        expect(stale.statusCode).toBe(409);
        expect(stale.json()).toEqual({
          code: "APPLICATION_SETTING_CONFLICT",
          messageKey: "settings.language.conflict",
          current: { locale: "ar", updatedAtMs: 1_501 },
        });
      } finally {
        await server.close();
      }
    });
  });

  it("persists the saved database locale across a server restart", async () => {
    await withTempDatabase(async (databasePath) => {
      const firstDatabase = openDatabase(databasePath);
      const first = await buildServer({
        config: TEST_CONFIG,
        database: firstDatabase,
        nowMs: () => 1_000,
      });
      try {
        const headers = await mutationHeaders(first);
        const saved = await first.inject({
          method: "PUT",
          url: "/api/v1/application-settings/locale",
          headers,
          payload: { locale: "ar", expectedUpdatedAtMs: 1_000 },
        });
        expect(saved.statusCode).toBe(200);
      } finally {
        await first.close();
      }

      const reopenedDatabase = openDatabase(databasePath);
      const reopened = await buildServer({
        config: TEST_CONFIG,
        database: reopenedDatabase,
        nowMs: () => 9_000,
      });
      try {
        const bootstrap = await reopened.inject({
          method: "GET",
          url: "/api/v1/bootstrap",
          headers: testRequestHeaders(),
        });
        expect(bootstrap.json()).toMatchObject({
          locale: "ar",
          localeUpdatedAtMs: 1_001,
        });
      } finally {
        await reopened.close();
      }
    });
  });

  it("preserves an explicitly configured pseudo-locale but rejects it from the public mutation", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const server = await buildServer({
        config: { ...TEST_CONFIG, locale: "en-XA" },
        database: db,
        nowMs: () => 1_000,
      });
      try {
        const bootstrap = await server.inject({
          method: "GET",
          url: "/api/v1/bootstrap",
          headers: testRequestHeaders(),
        });
        expect(bootstrap.json()).toMatchObject({
          locale: "en-XA",
          localeUpdatedAtMs: 1_000,
        });
        const headers = await mutationHeaders(server);
        const response = await server.inject({
          method: "PUT",
          url: "/api/v1/application-settings/locale",
          headers,
          payload: { locale: "en-XA", expectedUpdatedAtMs: 1_000 },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({
          code: "VALIDATION_ERROR",
        });
      } finally {
        await server.close();
      }
    });
  });
});
