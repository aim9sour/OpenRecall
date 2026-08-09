import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./open-database.js";
import {
  SectionConflictError,
  SectionNameError,
  SectionNotFoundError,
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
            updatedAtMs: 1_000,
            counts: { total: 0, new: 0, dueNow: 0 },
            nextDueAtMs: null,
          },
        ]);
      } finally {
        db.close();
      }
    });
  });

  it("counts only active items by scheduler state and due time", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        const repository = new SectionRepository(db);
        const section = repository.createSection({
          name: "Biology",
          nowMs: 1_000,
        });
        const rows = [
          ["new-due", "active", 2_000, "new"],
          ["review-due", "active", 2_000, "review"],
          ["review-future", "active", 3_000, "review"],
          ["trashed-due", "trashed", 1_000, "review"],
        ] as const;

        for (const [id, lifecycle, dueAtMs, memoryState] of rows) {
          db.prepare(`
            INSERT INTO learning_items
              (id, section_id, lifecycle, created_at_ms, updated_at_ms)
            VALUES (?, ?, ?, 1000, 1000)
          `).run(id, section.id, lifecycle);
          db.prepare(`
            INSERT INTO scheduler_states
              (
                learning_item_id, section_id, due_at_ms, memory_state,
                step_index, stability, difficulty,
                elapsed_days_at_last_review, scheduled_days,
                last_review_at_ms, repetitions, lapses, revision,
                algorithm_id, algorithm_version, adapter_version,
                parameter_profile_id
              )
            VALUES
              (
                ?, ?, ?, ?, NULL, 0, 0, 0, 0, NULL, 0, 0, 0,
                'FSRS-6', '6.0', 1, 'official-fsrs6-v1'
              )
          `).run(id, section.id, dueAtMs, memoryState);
        }

        expect(repository.listSections(2_000)[0]).toMatchObject({
          counts: { total: 3, new: 1, dueNow: 2 },
          nextDueAtMs: 3_000,
        });
        expect(repository.getSection(section.id, 3_000)).toMatchObject({
          counts: { total: 3, new: 1, dueNow: 3 },
          nextDueAtMs: null,
        });
      } finally {
        db.close();
      }
    });
  });

  it("renames atomically with trimmed code-point names and monotonic revisions", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        const repository = new SectionRepository(db);
        const section = repository.createSection({
          name: "Biology",
          nowMs: 1_000,
        });

        const renamed = repository.renameSection({
          sectionId: section.id,
          name: "  Human Biology  ",
          expectedUpdatedAtMs: 1_000,
          nowMs: 1_000,
        });
        expect(renamed).toMatchObject({
          id: section.id,
          name: "Human Biology",
          updatedAtMs: 1_001,
        });

        const twoHundredCodePoints = "😀".repeat(200);
        const sameClock = repository.renameSection({
          sectionId: section.id,
          name: twoHundredCodePoints,
          expectedUpdatedAtMs: 1_001,
          nowMs: 1_000,
        });
        expect(sameClock).toMatchObject({
          name: twoHundredCodePoints,
          updatedAtMs: 1_002,
        });

        const noOpName = repository.renameSection({
          sectionId: section.id,
          name: twoHundredCodePoints,
          expectedUpdatedAtMs: 1_002,
          nowMs: 1_000,
        });
        expect(noOpName.updatedAtMs).toBe(1_003);
      } finally {
        db.close();
      }
    });
  });

  it("rejects invalid, missing, and stale renames without changing the section", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        const repository = new SectionRepository(db);
        const section = repository.createSection({
          name: "Biology",
          nowMs: 1_000,
        });

        expect(() =>
          repository.renameSection({
            sectionId: section.id,
            name: "😀".repeat(201),
            expectedUpdatedAtMs: 1_000,
            nowMs: 2_000,
          }),
        ).toThrow(SectionNameError);
        expect(() =>
          repository.renameSection({
            sectionId: "d9428888-122b-41e1-985c-61cd3cbb3210",
            name: "Missing",
            expectedUpdatedAtMs: 1_000,
            nowMs: 2_000,
          }),
        ).toThrow(SectionNotFoundError);

        repository.renameSection({
          sectionId: section.id,
          name: "Current",
          expectedUpdatedAtMs: 1_000,
          nowMs: 2_000,
        });
        expect(() =>
          repository.renameSection({
            sectionId: section.id,
            name: "Stale",
            expectedUpdatedAtMs: 1_000,
            nowMs: 3_000,
          }),
        ).toThrow(SectionConflictError);
        expect(repository.getSection(section.id, 3_000)).toMatchObject({
          name: "Current",
          updatedAtMs: 2_000,
        });
      } finally {
        db.close();
      }
    });
  });

  it("deletes a current section through database cascades", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        const repository = new SectionRepository(db);
        const section = repository.createSection({
          name: "Biology",
          nowMs: 1_000,
        });
        db.prepare(
          `
            INSERT INTO learning_items
              (id, section_id, lifecycle, created_at_ms, updated_at_ms)
            VALUES ('item-1', ?, 'active', 1000, 1000)
          `,
        ).run(section.id);

        repository.deleteSection({
          sectionId: section.id,
          expectedUpdatedAtMs: section.updatedAtMs,
        });

        expect(repository.getSection(section.id, 2_000)).toBeUndefined();
        expect(
          db.prepare("SELECT count(*) FROM learning_items").pluck().get(),
        ).toBe(0);
      } finally {
        db.close();
      }
    });
  });

  it("rejects missing and stale section deletion", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        const repository = new SectionRepository(db);
        const section = repository.createSection({
          name: "Biology",
          nowMs: 1_000,
        });
        repository.renameSection({
          sectionId: section.id,
          name: "Current",
          expectedUpdatedAtMs: 1_000,
          nowMs: 2_000,
        });

        expect(() =>
          repository.deleteSection({
            sectionId: section.id,
            expectedUpdatedAtMs: 1_000,
          }),
        ).toThrow(SectionConflictError);
        expect(() =>
          repository.deleteSection({
            sectionId: "d9428888-122b-41e1-985c-61cd3cbb3210",
            expectedUpdatedAtMs: 1_000,
          }),
        ).toThrow(SectionNotFoundError);
        expect(repository.getSection(section.id, 2_000)).toMatchObject({
          name: "Current",
          updatedAtMs: 2_000,
        });
      } finally {
        db.close();
      }
    });
  });

  it("rolls back every cascade when section deletion fails", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        const repository = new SectionRepository(db);
        const section = repository.createSection({
          name: "Biology",
          nowMs: 1_000,
        });
        db.prepare(
          `
            INSERT INTO learning_items
              (id, section_id, lifecycle, created_at_ms, updated_at_ms)
            VALUES ('item-1', ?, 'active', 1000, 1000)
          `,
        ).run(section.id);
        db.exec(`
          CREATE TRIGGER fail_section_delete
          BEFORE DELETE ON sections
          BEGIN
            SELECT RAISE(ABORT, 'EXPECTED_SECTION_DELETE_FAILURE');
          END;
        `);

        expect(() =>
          repository.deleteSection({
            sectionId: section.id,
            expectedUpdatedAtMs: section.updatedAtMs,
          }),
        ).toThrow("EXPECTED_SECTION_DELETE_FAILURE");
        expect(repository.getSection(section.id, 2_000)).toBeDefined();
        expect(
          db.prepare("SELECT count(*) FROM learning_items").pluck().get(),
        ).toBe(1);
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
