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

describe("card import routes", () => {
  it("previews and atomically commits one item with its variants", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const server = await buildServer({ config, database: db, nowMs: () => 500 });
      const headers = await mutationHeaders(server);

      try {
        const section = await server.inject({
          method: "POST",
          url: "/api/v1/sections",
          headers,
          payload: { name: "Biology" },
        });
        const sectionId = section.json<{ id: string }>().id;
        const content = {
          front: "Question",
          back: "Answer",
          variants: [
            { front: "Alternative 1", back: "Answer 1" },
            { front: "Alternative 2", back: "Answer 2", notes: null },
          ],
        };
        const preview = await server.inject({
          method: "POST",
          url: `/api/v1/sections/${sectionId}/import/preview`,
          headers,
          payload: { previewId: "preview-1", content },
        });

        expect(preview.statusCode).toBe(200);
        const previewBody = preview.json<{
          digest: string;
          valid: number;
          rows: Array<{ status: string }>;
        }>();
        expect(previewBody.valid).toBe(1);
        expect(previewBody.rows[0]?.status).toBe("valid");
        expect(previewBody.digest).toMatch(/^[a-f0-9]{64}$/);

        const tampered = await server.inject({
          method: "POST",
          url: `/api/v1/sections/${sectionId}/import/commit`,
          headers,
          payload: {
            previewId: "preview-1",
            content,
            digest: "b".repeat(64),
            selectedIndexes: [0],
          },
        });
        expect(tampered.statusCode).toBe(409);
        expect(db.prepare("SELECT count(*) FROM learning_items").pluck().get()).toBe(0);

        const commit = await server.inject({
          method: "POST",
          url: `/api/v1/sections/${sectionId}/import/commit`,
          headers,
          payload: {
            previewId: "preview-1",
            content,
            digest: previewBody.digest,
            selectedIndexes: [0],
          },
        });
        expect(commit.statusCode).toBe(201);
        expect(commit.json<{ importedItemIds: string[] }>().importedItemIds).toHaveLength(1);
        expect(db.prepare("SELECT count(*) FROM learning_items").pluck().get()).toBe(1);
        expect(db.prepare("SELECT count(*) FROM presentations").pluck().get()).toBe(3);
      } finally {
        await server.close();
      }
    });
  });

  it("rejects tampered previews and missing sections without SQL details", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const server = await buildServer({ config, database: db });
      const headers = await mutationHeaders(server);

      try {
        const missing = await server.inject({
          method: "POST",
          url: "/api/v1/sections/d9428888-122b-41e1-985c-61cd3cbb3210/import/preview",
          headers,
          payload: { previewId: "x", content: { front: "Q", back: "A" } },
        });
        expect(missing.statusCode).toBe(404);
        expect(missing.body).not.toContain("SQLITE");
      } finally {
        await server.close();
      }
    });
  });
});
