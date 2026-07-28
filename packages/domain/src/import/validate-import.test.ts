import { describe, expect, it } from "vitest";
import { containsMarkup } from "./detect-markup.js";
import { duplicateKey } from "./normalize.js";
import { validateImportJson } from "./validate-import.js";

describe("validateImportJson", () => {
  it("accepts one object, optional notes, and any number of variants", () => {
    const variants = Array.from({ length: 40 }, (_, index) => ({
      front: `Question ${index}`,
      back: `Answer ${index}`,
      notes: index % 2 === 0 ? null : "Hint",
    }));
    const result = validateImportJson(
      {
        front: "Question\r\nline",
        back: "Answer",
        variants,
      },
      new Set(),
    );

    expect(result).toMatchObject({
      total: 1,
      valid: 1,
      duplicate: 0,
      invalid: 0,
      rows: [{ index: 0, status: "valid", issues: [], warnings: [] }],
    });
    expect(result.acceptedItems[0]?.front).toBe("Question\nline");
    expect(result.acceptedItems[0]?.notes).toBeNull();
    expect(result.acceptedItems[0]?.variants).toHaveLength(40);
  });

  it("reports exact nested paths and unknown-field warnings", () => {
    const result = validateImportJson(
      [
        { front: "Good", back: "Answer" },
        { front: "Also good", back: "Answer" },
        {
          front: "Question",
          back: "Answer",
          extra: true,
          variants: [{ front: "Variant", back: 42 }],
        },
      ],
      new Set(),
    );

    expect(result.rows[2]).toEqual({
      index: 2,
      status: "invalid",
      issues: [
        {
          path: "cards[2].variants[0].back",
          messageKey: "error.field.string",
        },
      ],
      warnings: [
        {
          path: "cards[2].extra",
          messageKey: "import.unknownField",
        },
      ],
    });
  });

  it("marks existing and within-file exact normalized duplicates", () => {
    const existing = new Set([duplicateKey(" Café\r\n", " Answer ")]);
    const result = validateImportJson(
      [
        { front: "Cafe\u0301\n", back: "Answer" },
        { front: "Fresh", back: "Card" },
        { front: " Fresh ", back: "Card\r\n" },
      ],
      existing,
    );

    expect(result.rows.map((row) => row.status)).toEqual([
      "duplicate",
      "valid",
      "duplicate",
    ]);
    expect(result.acceptedItems).toHaveLength(1);
  });

  it("reports empty and non-string required fields without throwing", () => {
    const result = validateImportJson(
      [
        { front: "", back: "Answer" },
        { front: 9, back: null },
      ],
      new Set(),
    );

    expect(result.invalid).toBe(2);
    expect(result.rows[1]?.issues).toEqual([
      { path: "cards[1].front", messageKey: "error.field.string" },
      { path: "cards[1].back", messageKey: "error.field.string" },
    ]);
  });
});

describe("plain-text markup discrimination", () => {
  it.each(["<script>", "</p>", "<img src=x>", "<!--x-->", "<!doctype html>"])(
    "rejects markup: %s",
    (value) => {
      expect(containsMarkup(value)).toBe(true);
    },
  );

  it.each(["a < b > c", "2 < 3", "<3", "س < ص > ع"])(
    "accepts comparison text: %s",
    (value) => {
      expect(containsMarkup(value)).toBe(false);
    },
  );
});
