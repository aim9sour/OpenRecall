import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
import type { RestoreServiceApi } from "./restore.js";

function multipart(
  boundary: string,
  parts: readonly (
    | { readonly name: string; readonly value: string }
    | {
        readonly name: string;
        readonly filename: string;
        readonly content: Buffer;
      }
  )[],
): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if ("filename" in part) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            "Content-Type: application/vnd.sqlite3\r\n\r\n",
        ),
        part.content,
        Buffer.from("\r\n"),
      );
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`,
        ),
      );
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

async function mutationHeaders(
  server: Awaited<ReturnType<typeof buildServer>>,
  boundary: string,
) {
  const bootstrap = await server.inject({
    method: "GET",
    url: "/api/v1/bootstrap",
    headers: testRequestHeaders(),
  });
  return {
    ...testRequestHeaders({
      csrfToken: bootstrap.json<{ csrfToken: string }>().csrfToken,
      origin: TEST_ORIGIN,
    }),
    "content-type": `multipart/form-data; boundary=${boundary}`,
  };
}

describe("restore route", () => {
  it("reopens every live service against the restored database and advances the revision", async () => {
    await withTempDatabase(async (databasePath) => {
      const directory = dirname(databasePath);
      const sourcePath = join(directory, "source.sqlite3");
      const source = openDatabase(sourcePath);
      new SectionRepository(source).createSection({
        name: "Restored section",
        nowMs: 1_000,
      });
      source
        .prepare(
          `
            INSERT INTO optimizer_runs
              (
                id, scope_type, section_id, status, raw_review_count,
                eligible_example_count, source_review_cutoff_ms,
                package_version, algorithm_version, progress,
                created_at_ms, started_at_ms
              )
            VALUES
              (
                'd9428888-122b-41e1-985c-61cd3cbb3210',
                'global', NULL, 'running',
                500, 400, 10, '0.5.0', '6.0', 0.4, 100, 100
              )
          `,
        )
        .run();
      source.close();

      const live = openDatabase(databasePath);
      new SectionRepository(live).createSection({
        name: "Old section",
        nowMs: 500,
      });
      const server = await buildServer({
        config: {
          authority: TEST_AUTHORITY,
          dataDirectory: directory,
          host: "127.0.0.1",
          locale: "en",
          port: 3_210,
          publicOrigin: TEST_ORIGIN,
        },
        database: live,
        nowMs: () => 2_000,
      });

      try {
        const boundary = "full-restore-boundary";
        const response = await server.inject({
          method: "POST",
          url: "/api/v1/restore",
          headers: await mutationHeaders(server, boundary),
          payload: multipart(boundary, [
            { name: "expectedCurrentRevision", value: "1" },
            {
              name: "database",
              filename: "source.sqlite3",
              content: await readFile(sourcePath),
            },
          ]),
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          databaseRevision: 2,
          restoredUserVersion: 5,
          preRestoreBackupFilename: expect.stringMatching(
            /^openrecall-automatic-/,
          ),
        });

        const listed = await server.inject({
          method: "GET",
          url: "/api/v1/sections",
          headers: testRequestHeaders(),
        });
        expect(listed.statusCode).toBe(200);
        expect(listed.json()).toEqual([
          expect.objectContaining({ name: "Restored section" }),
        ]);

        const recoveredRun = await server.inject({
          method: "GET",
          url: "/api/v1/optimizer/runs/d9428888-122b-41e1-985c-61cd3cbb3210",
          headers: testRequestHeaders(),
        });
        expect(recoveredRun.statusCode).toBe(200);
        expect(recoveredRun.json()).toMatchObject({
          status: "failed",
          errorCode: "OPTIMIZER_PROCESS_INTERRUPTED",
          finishedAtMs: 2_000,
        });

        const headers = await mutationHeaders(
          server,
          "unused-json-boundary",
        );
        const created = await server.inject({
          method: "POST",
          url: "/api/v1/sections",
          headers: {
            ...headers,
            "content-type": "application/json",
          },
          payload: { name: "Created after restore" },
        });
        expect(created.statusCode).toBe(201);

        const bootstrap = await server.inject({
          method: "GET",
          url: "/api/v1/bootstrap",
          headers: testRequestHeaders(),
        });
        expect(
          bootstrap.json<{ databaseRevision: number }>()
            .databaseRevision,
        ).toBe(2);
      } finally {
        await server.close();
      }
    });
  });

  it("streams exactly one upload to an owned random path, ignores a traversal filename, and removes staging", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const expectedBytes = Buffer.from("SQLite format 3\u0000payload");
      let observedPath = "";
      const restore: RestoreServiceApi = {
        restoreFromUpload: vi.fn(async (path, revision) => {
          observedPath = path;
          expect(revision).toBe(1);
          expect(await readFile(path)).toEqual(expectedBytes);
          return {
            databaseRevision: 2,
            restoredUserVersion: 5,
            preRestoreBackupFilename:
              "openrecall-automatic-9000-safe.sqlite3",
          };
        }),
      };
      const boundary = "openrecall-boundary";
      const server = await buildServer({
        config: {
          authority: TEST_AUTHORITY,
          dataDirectory: dirname(databasePath),
          host: "127.0.0.1",
          locale: "en",
          port: 3_210,
          publicOrigin: TEST_ORIGIN,
        },
        database: db,
        restoreService: restore,
      });
      try {
        const response = await server.inject({
          method: "POST",
          url: "/api/v1/restore",
          headers: await mutationHeaders(server, boundary),
          payload: multipart(boundary, [
            { name: "expectedCurrentRevision", value: "1" },
            {
              name: "database",
              filename: "../../outside.sqlite3",
              content: expectedBytes,
            },
          ]),
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
          databaseRevision: 2,
          restoredUserVersion: 5,
          preRestoreBackupFilename:
            "openrecall-automatic-9000-safe.sqlite3",
        });
        expect(observedPath).toMatch(
          /restore-uploads[\\/]restore-upload-[0-9a-f-]{36}\.sqlite3$/,
        );
        expect(observedPath).not.toContain("outside");
        await expect(readFile(observedPath)).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await server.close();
      }
    });
  });

  it("rejects missing, multiple, and oversized files with stable content-free errors", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const restore: RestoreServiceApi = {
        restoreFromUpload: vi.fn(),
      };
      const boundary = "bounded-upload";
      const server = await buildServer({
        config: {
          authority: TEST_AUTHORITY,
          dataDirectory: dirname(databasePath),
          host: "127.0.0.1",
          locale: "en",
          port: 3_210,
          publicOrigin: TEST_ORIGIN,
        },
        database: db,
        restoreService: restore,
        restoreMaxUploadBytes: 16,
      });
      try {
        const headers = await mutationHeaders(server, boundary);
        for (const parts of [
          [{ name: "expectedCurrentRevision", value: "1" }],
          [
            { name: "expectedCurrentRevision", value: "1" },
            {
              name: "database",
              filename: "one.sqlite3",
              content: Buffer.from("one"),
            },
            {
              name: "database",
              filename: "two.sqlite3",
              content: Buffer.from("two"),
            },
          ],
          [
            { name: "expectedCurrentRevision", value: "1" },
            {
              name: "database",
              filename: "large.sqlite3",
              content: Buffer.alloc(17),
            },
          ],
        ] as const) {
          const response = await server.inject({
            method: "POST",
            url: "/api/v1/restore",
            headers,
            payload: multipart(boundary, parts),
          });
          expect([400, 413]).toContain(response.statusCode);
          expect(response.body).not.toMatch(
            /outside|sqlite format|node_modules|[A-Z]:\\/i,
          );
        }
        expect(restore.restoreFromUpload).not.toHaveBeenCalled();
      } finally {
        await server.close();
      }
    });
  });
});
