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
        inputSnapshot: {
          kind: "legacy-official",
          trainingConfig: {
            numEpochs: 5,
            batchSize: 512,
            seed: 2023,
            maxSeqLen: 256,
            learningRate: 0.04,
            gamma: 1,
          },
          settingsSource: null,
          enableShortTerm: null,
          numRelearningSteps: null,
        },
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
        preflight: vi.fn(() => ({
          rawReviewCount: 450,
          otherwiseEligibleExampleCount: 410,
          excludedByMaxSeqLenCount: 10,
          eligibleExampleCount: 400,
          minimumEligibleExamples: 400,
          sourceReviewCutoffMs: 5_000,
          canTrain: true,
        })),
        startRun: vi.fn(() => run),
        getRun: vi.fn((runId: string) =>
          runId === run.id ? run : null,
        ),
        cancelRun: vi.fn((runId: string) => runId === run.id),
        quiesceForSectionDeletion: async () => () => undefined,
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
        const preflight = await server.inject({
          method: "POST",
          url: "/api/v1/optimizer/preflight",
          headers,
          payload: {
            scope: { scopeType: "section", sectionId: run.sectionId },
            settings: { numEpochs: 7, batchSize: 256, maxSeqLen: 128 },
          },
        });
        expect(preflight.statusCode).toBe(200);
        expect(preflight.json()).toMatchObject({
          otherwiseEligibleExampleCount: 410,
          excludedByMaxSeqLenCount: 10,
          eligibleExampleCount: 400,
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

        service.startRun.mockImplementationOnce(() => {
          throw new Error("OPTIMIZER_SECTION_DELETION_IN_PROGRESS");
        });
        const deletionConflict = await server.inject({
          method: "POST",
          url: "/api/v1/optimizer/runs",
          headers,
          payload: {
            scopeType: "section",
            sectionId: run.sectionId,
          },
        });
        expect(deletionConflict.statusCode).toBe(409);
        expect(deletionConflict.json()).toEqual({
          code: "OPTIMIZER_SECTION_DELETION_IN_PROGRESS",
          messageKey: "optimizer.runConflict",
        });

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

  it("lists, previews, applies, and rolls back profiles with validated envelopes", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const profile = {
        id: "c8f65aa8-122b-41e1-985c-61cd3cbb3210",
        scopeType: "global" as const,
        sectionId: null,
        algorithmId: "FSRS-6",
        algorithmVersion: "6.0",
        adapterVersion: 1,
        eligibleExampleCount: 400,
        reviewCutoffMs: 5_000,
        status: "candidate" as const,
        createdAtMs: 6_000,
        packageVersion: "0.5.0",
        metricLogLoss: 0.2,
        metricRmseBins: 0.1,
      };
      const previousProfile = {
        ...profile,
        id: "official-fsrs6-v1",
        scopeType: "official" as const,
        status: "active" as const,
        createdAtMs: 0,
        packageVersion: null,
        metricLogLoss: null,
        metricRmseBins: null,
      };
      const revisionToken = "a".repeat(64);
      const workload = Array.from({ length: 30 }, (_, dayOffset) => ({
        dayOffset,
        count: 0,
      }));
      const preview = {
        profile,
        previousProfile,
        affectedItemCount: 2,
        reviewCount: 10,
        sourceMatches: true,
        revisionToken,
        dueShift: { earlier: 1, later: 1, unchanged: 0 },
        oldWorkload: workload,
        newWorkload: workload,
      };
      const application = {
        id: "d8f65aa8-122b-41e1-985c-61cd3cbb3210",
        profileId: profile.id,
        previousProfileId: previousProfile.id,
        scopeType: "global" as const,
        sectionId: null,
        sourceReviewCutoffMs: 5_000,
        backupFilename:
          "openrecall-automatic-7000-a.sqlite3",
        appliedAtMs: 7_000,
        affectedItemCount: 2,
      };
      const profiles = {
        listProfiles: vi.fn(() => [profile, previousProfile]),
        preview: vi.fn(() => preview),
        apply: vi.fn(async () => application),
        rollback: vi.fn(async () => application),
      };
      const optimizer = {
        getEligibility: vi.fn(),
        startRun: vi.fn(),
        getRun: vi.fn(() => null),
        cancelRun: vi.fn(() => false),
        quiesceForSectionDeletion: async () => () => undefined,
        whenIdle: async () => undefined,
        dispose: () => undefined,
      };
      const server = await buildServer({
        config,
        database: db,
        optimizerService: optimizer,
        profileApplicationService: profiles,
      });
      const headers = await mutationHeaders(server);

      try {
        const listed = await server.inject({
          method: "GET",
          url: "/api/v1/optimizer/profiles",
          headers: testRequestHeaders(),
        });
        expect(listed.statusCode).toBe(200);
        expect(listed.json()).toEqual([profile, previousProfile]);

        const viewed = await server.inject({
          method: "POST",
          url: `/api/v1/optimizer/profiles/${profile.id}/preview`,
          headers,
        });
        expect(viewed.statusCode).toBe(200);
        expect(viewed.json()).toEqual(preview);

        for (const action of ["apply", "rollback"] as const) {
          const response = await server.inject({
            method: "POST",
            url:
              `/api/v1/optimizer/profiles/${profile.id}/${action}`,
            headers,
            payload: { revisionToken },
          });
          expect(response.statusCode).toBe(200);
          expect(response.json()).toEqual(application);
          expect(profiles[action]).toHaveBeenCalledWith(
            profile.id,
            revisionToken,
          );
        }

        const invalid = await server.inject({
          method: "POST",
          url: `/api/v1/optimizer/profiles/${profile.id}/apply`,
          headers,
          payload: { revisionToken: "short" },
        });
        expect(invalid.statusCode).toBe(400);
        expect(profiles.apply).toHaveBeenCalledOnce();
      } finally {
        await server.close();
      }
    });
  });
});
