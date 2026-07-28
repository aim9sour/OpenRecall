import { openDatabase } from "@openrecall/database";
import {
  ITEM_ONE,
  SECTION_ONE,
  TEST_AUTHORITY,
  seedStatisticsFixture,
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
  publicOrigin: "http://127.0.0.1:3210",
} as const;
const nowMs = Date.parse("2025-01-17T12:00:00Z");

describe("statistics API", () => {
  it("returns scoped nullable metrics and exact exclusion counters without card content", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      seedStatisticsFixture(db);
      const server = await buildServer({
        config,
        database: db,
        nowMs: () => nowMs,
        studyDay: { timeZone: "Africa/Cairo", boundaryMinutes: 240 },
      });
      try {
        const global = await server.inject({
          method: "GET",
          url: "/api/v1/statistics",
          headers: testRequestHeaders(),
        });
        expect(global.statusCode).toBe(200);
        expect(global.json()).toMatchObject({
          summary: {
            reviewEvents: 4,
            uniqueItems: 3,
            actualRecall: 0.75,
            retrievabilityExcluded: 1,
            durationExcluded: 1,
          },
          metrics: expect.arrayContaining([
            { labelKey: "statistics.metric.reviewEvents", value: 4 },
            { labelKey: "statistics.metric.actualRecall", value: 0.75 },
          ]),
        });
        expect(global.body).not.toMatch(/Q1|A1|frontSnapshot|backSnapshot/);

        const section = await server.inject({
          method: "GET",
          url: `/api/v1/sections/${SECTION_ONE}/statistics`,
          headers: testRequestHeaders(),
        });
        expect(section.statusCode).toBe(200);
        expect(section.json()).toMatchObject({
          summary: { reviewEvents: 3, uniqueItems: 2 },
        });

        const empty = await server.inject({
          method: "GET",
          url: "/api/v1/statistics?fromStudyDay=2026-01-01&toStudyDay=2026-01-02",
          headers: testRequestHeaders(),
        });
        expect(empty.json()).toMatchObject({
          summary: {
            reviewEvents: 0,
            actualRecall: null,
            meanPredictedRetrievability: null,
          },
        });
      } finally {
        await server.close();
      }
    });
  });

  it("rejects reversed, invalid, and longer-than-five-year ranges", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      seedStatisticsFixture(db);
      const server = await buildServer({
        config,
        database: db,
        nowMs: () => nowMs,
        studyDay: { timeZone: "UTC", boundaryMinutes: 0 },
      });
      try {
        for (const query of [
          "fromStudyDay=2025-02-01&toStudyDay=2025-01-01",
          "fromStudyDay=2025-02-30&toStudyDay=2025-03-01",
          "fromStudyDay=2010-01-01&toStudyDay=2020-01-02",
        ]) {
          const response = await server.inject({
            method: "GET",
            url: `/api/v1/statistics?${query}`,
            headers: testRequestHeaders(),
          });
          expect(response.statusCode).toBe(400);
          expect(response.json()).toMatchObject({
            code: "STATISTICS_RANGE_INVALID",
          });
        }
      } finally {
        await server.close();
      }
    });
  });

  it("returns missing scopes and bounded per-card history pages", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      seedStatisticsFixture(db);
      const server = await buildServer({
        config,
        database: db,
        nowMs: () => nowMs,
        studyDay: { timeZone: "Africa/Cairo", boundaryMinutes: 240 },
      });
      try {
        const missingSection = await server.inject({
          method: "GET",
          url: "/api/v1/sections/f9428888-122b-41e1-985c-61cd3cbb3210/statistics",
          headers: testRequestHeaders(),
        });
        expect(missingSection.statusCode).toBe(404);

        const first = await server.inject({
          method: "GET",
          url: `/api/v1/cards/${ITEM_ONE}/statistics?limit=1`,
          headers: testRequestHeaders(),
        });
        expect(first.statusCode).toBe(200);
        const firstBody = first.json<{
          history: { items: Array<{ id: string }>; nextCursor: string };
        }>();
        expect(firstBody.history.items).toEqual([{ id: "l2", presentationId: "p1v", frontSnapshot: "Q1 alt", backSnapshot: "A1", notesSnapshot: "Hint", rating: 3, shownAtMs: Date.parse("2025-01-15T02:00:00Z"), revealedAtMs: Date.parse("2025-01-15T02:00:00Z"), ratedAtMs: Date.parse("2025-01-15T02:00:00Z"), durationMs: null, retrievabilityBefore: null, resultingDueAtMs: Date.parse("2025-01-16T06:00:00Z") }]);

        const second = await server.inject({
          method: "GET",
          url: `/api/v1/cards/${ITEM_ONE}/statistics?limit=1&cursor=${encodeURIComponent(firstBody.history.nextCursor)}`,
          headers: testRequestHeaders(),
        });
        expect(second.json<{ history: { items: Array<{ id: string }> } }>().history.items[0]?.id).toBe("l1");

        const unbounded = await server.inject({
          method: "GET",
          url: `/api/v1/cards/${ITEM_ONE}/statistics?limit=101`,
          headers: testRequestHeaders(),
        });
        expect(unbounded.statusCode).toBe(400);
      } finally {
        await server.close();
      }
    });
  });
});
