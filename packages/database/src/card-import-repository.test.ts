import type { AcceptedImportItem } from "@openrecall/domain";
import { duplicateKey } from "@openrecall/domain";
import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { CardImportRepository } from "./card-import-repository.js";
import { openDatabase } from "./open-database.js";
import { SectionRepository } from "./section-repository.js";

const item: AcceptedImportItem = {
  sourceIndex: 0,
  front: "Primary question",
  back: "Primary answer",
  notes: null,
  variants: [
    { front: "Variant one", back: "Answer one", notes: "Hint" },
    { front: "Variant two", back: "Answer two", notes: null },
  ],
};

describe("CardImportRepository", () => {
  it("stores one learning item with ordered presentations and zero exposures", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        const section = new SectionRepository(db).createSection({
          name: "Biology",
          nowMs: 1_000,
        });
        const repository = new CardImportRepository(db);
        const result = repository.commitImport(section.id, [item], 2_000);

        expect(result.importedItemIds).toHaveLength(1);
        expect(repository.getDuplicateKeys(section.id)).toEqual(
          new Set([duplicateKey(item.front, item.back)]),
        );
        expect(
          db
            .prepare(
              "SELECT id, section_id, lifecycle FROM learning_items ORDER BY id",
            )
            .all(),
        ).toEqual([
          {
            id: result.importedItemIds[0],
            section_id: section.id,
            lifecycle: "active",
          },
        ]);
        expect(
          db
            .prepare(
              `
                SELECT kind, ordinal, front, back, notes
                FROM presentations
                ORDER BY ordinal
              `,
            )
            .all(),
        ).toEqual([
          {
            kind: "primary",
            ordinal: 0,
            front: "Primary question",
            back: "Primary answer",
            notes: null,
          },
          {
            kind: "variant",
            ordinal: 1,
            front: "Variant one",
            back: "Answer one",
            notes: "Hint",
          },
          {
            kind: "variant",
            ordinal: 2,
            front: "Variant two",
            back: "Answer two",
            notes: null,
          },
        ]);
        expect(
          db
            .prepare(
              `
                SELECT show_count, first_shown_at_ms, last_shown_at_ms
                FROM presentation_exposures
                ORDER BY presentation_id
              `,
            )
            .all(),
        ).toEqual([
          {
            show_count: 0,
            first_shown_at_ms: null,
            last_shown_at_ms: null,
          },
          {
            show_count: 0,
            first_shown_at_ms: null,
            last_shown_at_ms: null,
          },
          {
            show_count: 0,
            first_shown_at_ms: null,
            last_shown_at_ms: null,
          },
        ]);
      } finally {
        db.close();
      }
    });
  });

  it("rolls back the whole batch when a later item cannot be stored", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);

      try {
        const section = new SectionRepository(db).createSection({
          name: "Biology",
          nowMs: 1_000,
        });
        const invalidSecond: AcceptedImportItem = {
          ...item,
          sourceIndex: 1,
          front: "",
          variants: [],
        };
        const repository = new CardImportRepository(db);

        expect(() =>
          repository.commitImport(section.id, [item, invalidSecond], 2_000),
        ).toThrow();
        expect(
          db.prepare("SELECT count(*) FROM learning_items").pluck().get(),
        ).toBe(0);
        expect(
          db.prepare("SELECT count(*) FROM presentations").pluck().get(),
        ).toBe(0);
      } finally {
        db.close();
      }
    });
  });
});
