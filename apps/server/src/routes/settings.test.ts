import {
  CardImportRepository,
  CURRENT_DEFAULT_SCHEDULER_SETTINGS as DEFAULT_SCHEDULER_SETTINGS,
  CURRENT_SCHEDULER_SETTINGS_MANIFEST as FSRS6_MANIFEST,
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

describe("settings routes", () => {
  it("edits optimizer training choices by scope and exposes technical defaults", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const section = new SectionRepository(db).createSection({ name: "Biology", nowMs: 10 });
      const server = await buildServer({ config, database: db, nowMs: () => 2_000 });
      const headers = await mutationHeaders(server);
      try {
        const initial = await server.inject({
          method: "GET",
          url: `/api/v1/settings/optimizer?sectionId=${section.id}`,
          headers: testRequestHeaders(),
        });
        expect(initial.statusCode).toBe(200);
        expect(initial.json()).toMatchObject({
          defaults: { numEpochs: 5, batchSize: 512, maxSeqLen: 256 },
          savedOverride: null,
          effective: { source: { kind: "global" } },
        });
        const saved = await server.inject({
          method: "PUT",
          url: `/api/v1/settings/optimizer/sections/${section.id}`,
          headers,
          payload: { settings: { numEpochs: 7, batchSize: 256, maxSeqLen: 128 } },
        });
        expect(saved.statusCode, saved.body).toBe(200);
        expect(saved.json()).toMatchObject({
          savedOverride: { settings: { numEpochs: 7, batchSize: 256, maxSeqLen: 128 } },
          effective: { source: { kind: "section" } },
        });
        const invalid = await server.inject({
          method: "PUT",
          url: "/api/v1/settings/optimizer/global",
          headers,
          payload: {
            expectedUpdatedAtMs: 0,
            settings: { numEpochs: 100, batchSize: 512, maxSeqLen: 256 },
          },
        });
        expect(invalid.statusCode).toBe(400);
        const technical = await server.inject({
          method: "GET",
          url: `/api/v1/settings/technical?sectionId=${section.id}`,
          headers: testRequestHeaders(),
        });
        expect(technical.statusCode, technical.body).toBe(200);
        expect(technical.json()).toMatchObject({
          manifest: { upstreamVersion: "0.5.0", algorithmVersion: "6.0" },
          officialTrainingConfig: { seed: 2023, learningRate: 0.04, gamma: 1 },
          parameterSource: { kind: "official" },
          activeProfile: { metricLogLoss: null, metricRmseBins: null },
        });
      } finally {
        await server.close();
      }
    });
  });

  it("persists a global appearance preference with optimistic concurrency", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const server = await buildServer({
        config,
        database: db,
        nowMs: () => 1_500,
      });
      const headers = await mutationHeaders(server);

      try {
        const initial = await server.inject({
          method: "GET",
          url: "/api/v1/settings/appearance",
          headers: testRequestHeaders(),
        });
        expect(initial.statusCode).toBe(200);
        expect(initial.json()).toEqual({
          theme: "system",
          updatedAtMs: 0,
        });

        const saved = await server.inject({
          method: "PUT",
          url: "/api/v1/settings/appearance",
          headers,
          payload: {
            expectedUpdatedAtMs: 0,
            theme: "dark",
          },
        });
        expect(saved.statusCode).toBe(200);
        expect(saved.json()).toEqual({
          theme: "dark",
          updatedAtMs: 1_500,
        });

        const stale = await server.inject({
          method: "PUT",
          url: "/api/v1/settings/appearance",
          headers,
          payload: {
            expectedUpdatedAtMs: 0,
            theme: "light",
          },
        });
        expect(stale.statusCode).toBe(409);
        expect(stale.json()).toMatchObject({
          code: "SETTINGS_EDIT_CONFLICT",
        });
        expect(
          JSON.parse(
            String(
              db
                .prepare(
                  "SELECT json_value FROM application_settings WHERE key = 'appearance.theme'",
                )
                .pluck()
                .get(),
            ),
          ),
        ).toBe("dark");
      } finally {
        await server.close();
        expect(db.open).toBe(false);
      }
    });
  });

  it("returns the manifest, defaults, explicit override, and resolved sources", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const server = await buildServer({
        config,
        database: db,
        nowMs: () => 1_000,
      });

      try {
        const response = await server.inject({
          method: "GET",
          url: "/api/v1/settings",
          headers: testRequestHeaders(),
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          manifest: {
            algorithmId: "FSRS-6",
            algorithmVersion: "6.0",
            upstreamPackage: FSRS6_MANIFEST.upstreamPackage,
            adapterVersion: 1,
            controls: FSRS6_MANIFEST.controls,
          },
          defaults: DEFAULT_SCHEDULER_SETTINGS,
          selectedScope: { scopeType: "global", sectionId: null },
          savedOverride: {
            scopeType: "global",
            sectionId: null,
            settings: DEFAULT_SCHEDULER_SETTINGS,
            updatedAtMs: 0,
          },
          effective: {
            settings: DEFAULT_SCHEDULER_SETTINGS,
            settingsSource: {
              kind: "global",
              updatedAtMs: 0,
            },
            parameterSource: {
              kind: "official",
            },
          },
        });
        expect(response.body).not.toContain("weights");
      } finally {
        await server.close();
      }
    });
  });

  it("validates and canonically saves global settings with optimistic concurrency", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const server = await buildServer({
        config,
        database: db,
        nowMs: () => 1_000,
      });
      const headers = await mutationHeaders(server);
      const settings = {
        ...DEFAULT_SCHEDULER_SETTINGS,
        requestedRetention: 0.93,
      };

      try {
        const saved = await server.inject({
          method: "PUT",
          url: "/api/v1/settings/scheduler/global",
          headers,
          payload: { expectedUpdatedAtMs: 0, settings },
        });
        expect(saved.statusCode).toBe(200);
        expect(saved.json()).toMatchObject({
          savedOverride: {
            settings,
            adapterVersion: FSRS6_MANIFEST.adapterVersion,
            updatedAtMs: 1_000,
          },
          effective: {
            settings,
            settingsSource: { kind: "global", updatedAtMs: 1_000 },
          },
        });

        for (const invalidSettings of [
          { ...settings, requestedRetention: 0.79 },
          { ...settings, learningStepsMinutes: [10, 1] },
          { ...settings, unsupportedFutureProperty: true },
        ]) {
          const invalid = await server.inject({
            method: "PUT",
            url: "/api/v1/settings/scheduler/global",
            headers,
            payload: {
              expectedUpdatedAtMs: 1_000,
              settings: invalidSettings,
            },
          });
          expect(invalid.statusCode).toBe(400);
          expect(invalid.json()).toMatchObject({
            code: "VALIDATION_ERROR",
          });
        }

        const stale = await server.inject({
          method: "PUT",
          url: "/api/v1/settings/scheduler/global",
          headers,
          payload: { expectedUpdatedAtMs: 0, settings },
        });
        expect(stale.statusCode).toBe(409);
        expect(stale.json()).toEqual({
          code: "SETTINGS_EDIT_CONFLICT",
          messageKey: "settings.editConflict",
        });

        const persisted = db
          .prepare(
            "SELECT settings_json FROM scheduler_setting_scopes WHERE scope_type = 'global'",
          )
          .pluck()
          .get();
        expect(JSON.parse(String(persisted))).toEqual(settings);
      } finally {
        await server.close();
      }
    });
  });

  it("creates and resets only a section override while preserving inheritance", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const section = new SectionRepository(db).createSection({
        name: "Biology",
        nowMs: 10,
      });
      const server = await buildServer({
        config,
        database: db,
        nowMs: () => 2_000,
      });
      const headers = await mutationHeaders(server);
      const sectionSettings = {
        ...DEFAULT_SCHEDULER_SETTINGS,
        requestedRetention: 0.94,
      };

      try {
        const inherited = await server.inject({
          method: "GET",
          url: `/api/v1/settings?sectionId=${section.id}`,
          headers: testRequestHeaders(),
        });
        expect(inherited.json()).toMatchObject({
          selectedScope: { scopeType: "section", sectionId: section.id },
          savedOverride: null,
          effective: {
            settings: DEFAULT_SCHEDULER_SETTINGS,
            settingsSource: { kind: "global" },
          },
        });

        const created = await server.inject({
          method: "PUT",
          url: `/api/v1/settings/scheduler/sections/${section.id}`,
          headers,
          payload: {
            settings: sectionSettings,
          },
        });
        expect(created.statusCode, created.body).toBe(200);
        expect(created.json()).toMatchObject({
          savedOverride: {
            scopeType: "section",
            sectionId: section.id,
            settings: sectionSettings,
            updatedAtMs: 2_000,
          },
          effective: {
            settingsSource: { kind: "section" },
          },
        });

        const staleCreate = await server.inject({
          method: "PUT",
          url: `/api/v1/settings/scheduler/sections/${section.id}`,
          headers,
          payload: {
            settings: sectionSettings,
          },
        });
        expect(staleCreate.statusCode).toBe(409);

        const reset = await server.inject({
          method: "DELETE",
          url: `/api/v1/settings/scheduler/sections/${section.id}`,
          headers,
          payload: { expectedUpdatedAtMs: 2_000 },
        });
        expect(reset.statusCode).toBe(200);
        expect(reset.json()).toMatchObject({
          savedOverride: null,
          effective: {
            settings: DEFAULT_SCHEDULER_SETTINGS,
            settingsSource: { kind: "global" },
          },
        });
        expect(
          db
            .prepare(
              "SELECT count(*) FROM scheduler_setting_scopes WHERE scope_type = 'global'",
            )
            .pluck()
            .get(),
        ).toBe(1);
      } finally {
        await server.close();
      }
    });
  });

  it("uses the effective section setting for future ratings without replaying stored due dates", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const section = new SectionRepository(db).createSection({
        name: "Biology",
        nowMs: 10,
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
        100,
      ).importedItemIds[0]!;
      const originalDueAtMs = db
        .prepare(
          "SELECT due_at_ms FROM scheduler_states WHERE learning_item_id = ?",
        )
        .pluck()
        .get(itemId);
      let nowMs = 100;
      const server = await buildServer({
        config,
        database: db,
        nowMs: () => nowMs,
        studyDay: { timeZone: "UTC", boundaryMinutes: 0 },
      });
      const headers = await mutationHeaders(server);
      const sectionSettings = {
        ...DEFAULT_SCHEDULER_SETTINGS,
        requestedRetention: 0.95,
      };

      try {
        nowMs = 200;
        const saved = await server.inject({
          method: "PUT",
          url: `/api/v1/settings/scheduler/sections/${section.id}`,
          headers,
          payload: { settings: sectionSettings },
        });
        expect(saved.statusCode).toBe(200);
        expect(
          db
            .prepare(
              "SELECT due_at_ms FROM scheduler_states WHERE learning_item_id = ?",
            )
            .pluck()
            .get(itemId),
        ).toBe(originalDueAtMs);

        const started = await server.inject({
          method: "POST",
          url: "/api/v1/review-sessions",
          headers,
          payload: { sectionId: section.id },
        });
        const sessionId = started.json<{
          session: { id: string };
        }>().session.id;
        const next = await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${sessionId}/next`,
          headers,
        });
        const card = next.json<{
          card: {
            entryId: string;
            learningItemId: string;
            presentationId: string;
            stateRevision: number;
          };
        }>().card;
        nowMs = 300;
        await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${sessionId}/current/shown`,
          headers,
          payload: {
            entryId: card.entryId,
            presentationId: card.presentationId,
          },
        });
        nowMs = 400;
        await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${sessionId}/current/reveal`,
          headers,
          payload: { entryId: card.entryId },
        });
        nowMs = 500;
        const rated = await server.inject({
          method: "POST",
          url: `/api/v1/review-sessions/${sessionId}/current/rate`,
          headers,
          payload: {
            entryId: card.entryId,
            learningItemId: card.learningItemId,
            rating: 4,
            expectedStateRevision: card.stateRevision,
            idempotencyKey: "settings-future-rating",
          },
        });
        expect(rated.statusCode).toBe(200);
        const loggedSettings = db
          .prepare(
            "SELECT settings_json FROM review_logs WHERE learning_item_id = ?",
          )
          .pluck()
          .get(itemId);
        expect(JSON.parse(String(loggedSettings))).toEqual(sectionSettings);
      } finally {
        await server.close();
      }
    });
  });
});
