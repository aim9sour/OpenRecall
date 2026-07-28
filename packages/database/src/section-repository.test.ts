import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./open-database.js";
import {
  SectionNameError,
  SectionRepository,
} from "./section-repository.js";

describe("SectionRepository", () => {
  it("trims names, creates UUIDs, and returns empty statistics", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        const repository = new SectionRepository(db);
        const section = repository.createSection({
          name: "  Biology  ",
          nowMs: 1_000,
        });

        expect(section).toEqual({
          id: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          ),
          name: "Biology",
          createdAtMs: 1_000,
          updatedAtMs: 1_000,
        });
        expect(repository.listSections(1_000)).toEqual([
          {
            id: section.id,
            name: "Biology",
            createdAtMs: 1_000,
            counts: { total: 0, new: 0, dueNow: 0 },
            nextDueAtMs: null,
          },
        ]);
      } finally {
        db.close();
      }
    });
  });

  it.each(["", " \n\t ", "x".repeat(201)])(
    "rejects an invalid section name without writing a row",
    async (name) => {
      await withTempDatabase((databasePath) => {
        const db = openDatabase(databasePath);

        try {
          const repository = new SectionRepository(db);
          expect(() =>
            repository.createSection({ name, nowMs: 1_000 }),
          ).toThrow(SectionNameError);
          expect(repository.listSections(1_000)).toEqual([]);
        } finally {
          db.close();
        }
      });
    },
  );

  it("orders equal timestamps deterministically by id", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        const repository = new SectionRepository(db);
        const older = repository.createSection({ name: "Older", nowMs: 100 });
        const sameTimeA = repository.createSection({
          name: "Same A",
          nowMs: 200,
        });
        const sameTimeB = repository.createSection({
          name: "Same B",
          nowMs: 200,
        });

        const equalTimestampIds = [sameTimeA.id, sameTimeB.id].sort();
        expect(repository.listSections(500).map((section) => section.id)).toEqual(
          [...equalTimestampIds, older.id],
        );
      } finally {
        db.close();
      }
    });
  });
});
