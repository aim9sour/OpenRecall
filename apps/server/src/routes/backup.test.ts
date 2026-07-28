import { readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  APPLICATION_ID,
  openDatabase,
  SCHEMA_VERSION,
} from "@openrecall/database";
import {
  TEST_AUTHORITY,
  TEST_ORIGIN,
  testRequestHeaders,
  withTempDatabase,
} from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { buildServer } from "../app.js";

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

describe("manual backup route", () => {
  it("streams one validated SQLite attachment with no-store and removes the server temporary copy", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      db.prepare(
        `
          INSERT INTO sections (id, name, created_at_ms, updated_at_ms)
          VALUES ('section-a', 'Private section', 1, 1)
        `,
      ).run();
      const dataDirectory = dirname(databasePath);
      const server = await buildServer({
        config: {
          authority: TEST_AUTHORITY,
          dataDirectory,
          host: "127.0.0.1",
          locale: "en",
          port: 3_210,
          publicOrigin: TEST_ORIGIN,
        },
        database: db,
        nowMs: () => 8_000,
      });
      const headers = await mutationHeaders(server);

      try {
        const response = await server.inject({
          method: "POST",
          url: "/api/v1/backup",
          headers,
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.headers["content-type"]).toContain(
          "application/vnd.sqlite3",
        );
        expect(response.headers["content-disposition"]).toMatch(
          /^attachment; filename="openrecall-manual-8000-[0-9a-f-]{36}\.sqlite3"$/,
        );
        expect(response.rawPayload.subarray(0, 16).toString("utf8")).toBe(
          "SQLite format 3\u0000",
        );

        const downloaded = join(dataDirectory, "downloaded.sqlite3");
        await writeFile(downloaded, response.rawPayload);
        const copy = openDatabase(downloaded);
        try {
          expect(copy.pragma("application_id", { simple: true })).toBe(
            APPLICATION_ID,
          );
          expect(copy.pragma("user_version", { simple: true })).toBe(
            SCHEMA_VERSION,
          );
          expect(
            copy.prepare(
              "SELECT name FROM sections WHERE id = 'section-a'",
            ).pluck().get(),
          ).toBe("Private section");
        } finally {
          copy.close();
        }

        expect(await readdir(join(dataDirectory, "backups"))).toEqual([]);
      } finally {
        await server.close();
      }
    });
  });
});
