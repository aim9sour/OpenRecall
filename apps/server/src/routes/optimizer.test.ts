import { openDatabase } from "@openrecall/database";
import {
  TEST_AUTHORITY,
  TEST_ORIGIN,
  testRequestHeaders,
  withTempDatabase,
} from "@openrecall/test-support";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../app.js";

const config = {
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

describe("optimizer routes", () => {
  it("exposes scoped eligibility, starts, reads, and cancels through stable envelopes", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      db.prepare(
        `
          INSERT INTO sections (id, name, created_at_ms, updated_at_ms)
          VALUES (
            'd9428888-122b-41e1-985c-61cd3cbb3210',
            'Biology', 0, 0
          )
        `,
      ).run();
      const run = {
        id: "a8f65aa8-122b-41e1-985c-61cd3cbb3210",
        scopeType: "section",
        sectionId: "d9428888-122b-41e1-985c-61cd3cbb3210",
        status: "running",
        rawReviewCount: 450,
        eligibleExampleCount: 400,
        sourceReviewCutoffMs: 5_000,
        packageVersion: "0.5.0",
        algorithmVersion: "6.0",
        progress: 0.2,
        resultProfileId: null,
        metricLogLoss: null,
        metricRmseBins: null,
        errorCode: null,
        createdAtMs: 1_000,
        startedAtMs: 1_000,
        finishedAtMs: null,
      } as const;
      const service = {
        getEligibility: vi.fn(() => ({
          scope: {
            scopeType: "section" as const,
            sectionId: run.sectionId,
          },
          rawReviewCount: 450,
          eligibleExampleCount: 400,
          minimumEligibleExamples: 400,
          sourceReviewCutoffMs: 5_000,
          canTrain: true,
          parameterSource: {
            kind: "official" as const,
            profileId: "official-fsrs6-v1",
            eligibleExampleCount: 0,
          },
          activeRun: null,
        })),
        startRun: vi.fn(() => run),
        getRun: vi.fn((runId: string) =>
          runId === run.id ? run : null,
        ),
        cancelRun: vi.fn((runId: string) => runId === run.id),
        whenIdle: async () => undefined,
        dispose: () => undefined,
      };
      const server = await buildServer({
        config,
        database: db,
        optimizerService: service,
      });
      const headers = await mutationHeaders(server);

      try {
        const query =
          "?scopeType=section&sectionId=d9428888-122b-41e1-985c-61cd3cbb3210";
        const eligibility = await server.inject({
          method: "GET",
          url: `/api/v1/optimizer/eligibility${query}`,
          headers: testRequestHeaders(),
        });
        expect(eligibility.statusCode).toBe(200);
        expect(eligibility.json()).toMatchObject({
          rawReviewCount: 450,
          eligibleExampleCount: 400,
          canTrain: true,
        });

        const started = await server.inject({
          method: "POST",
          url: "/api/v1/optimizer/runs",
          headers,
          payload: {
            scopeType: "section",
            sectionId: run.sectionId,
          },
        });
        expect(started.statusCode).toBe(202);
        expect(started.json()).toEqual(run);

        const read = await server.inject({
          method: "GET",
          url: `/api/v1/optimizer/runs/${run.id}`,
          headers: testRequestHeaders(),
        });
        expect(read.statusCode).toBe(200);
        const cancelled = await server.inject({
          method: "POST",
          url: `/api/v1/optimizer/runs/${run.id}/cancel`,
          headers,
        });
        expect(cancelled.statusCode).toBe(202);
        expect(service.cancelRun).toHaveBeenCalledWith(run.id);

        const missing = await server.inject({
          method: "GET",
          url: "/api/v1/optimizer/runs/b9f65aa8-122b-41e1-985c-61cd3cbb3210",
          headers: testRequestHeaders(),
        });
        expect(missing.statusCode).toBe(404);
        expect(missing.body).not.toMatch(/SQLITE|native/i);
      } finally {
        await server.close();
      }
    });
  });
});
