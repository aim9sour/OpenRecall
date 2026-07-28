import { describe, expect, it } from "vitest";
import { validateCardEdit } from "./validate-card-edit.js";

const ITEM_ID = "a8f65aa8-122b-41e1-985c-61cd3cbb3210";

describe("validateCardEdit", () => {
  it("requires a primary front and back with presentation-rooted paths", () => {
    const result = validateCardEdit(ITEM_ID, [
      { front: " ", back: null },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("EXPECTED_VALIDATION_FAILURE");
    }
    expect(result.issues).toEqual(
      expect.arrayContaining([
        {
          path: "presentations[0].front",
          messageKey: "error.field.required",
        },
        {
          path: "presentations[0].back",
          messageKey: "error.field.string",
        },
      ]),
    );
  });

  it("preserves variant order and normalizes empty optional notes to null", () => {
    const result = validateCardEdit(ITEM_ID, [
      { id: "primary-id", front: " First\r\n", back: "Answer", notes: " " },
      { id: "variant-b", front: "Second", back: "B", notes: "" },
      { id: "variant-c", front: "Third", back: "C", notes: "Hint" },
    ]);

    expect(result).toEqual({
      ok: true,
      value: {
        itemId: ITEM_ID,
        presentations: [
          {
            id: "primary-id",
            front: " First\n",
            back: "Answer",
            notes: null,
          },
          {
            id: "variant-b",
            front: "Second",
            back: "B",
            notes: null,
          },
          {
            id: "variant-c",
            front: "Third",
            back: "C",
            notes: "Hint",
          },
        ],
      },
    });
  });

  it("rejects markup in primary and variants using the import rule", () => {
    const result = validateCardEdit(ITEM_ID, [
      { front: "<b>Primary</b>", back: "Answer" },
      { front: "Variant", back: "<script>alert(1)</script>" },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("EXPECTED_VALIDATION_FAILURE");
    }
    expect(result.issues).toEqual(
      expect.arrayContaining([
        {
          path: "presentations[0].front",
          messageKey: "import.markupNotAllowed",
        },
        {
          path: "presentations[1].back",
          messageKey: "import.markupNotAllowed",
        },
      ]),
    );
  });

  it("keeps the supplied learning-item identity unchanged", () => {
    const result = validateCardEdit(ITEM_ID, [
      { front: "Changed question", back: "Changed answer" },
    ]);

    expect(result.ok && result.value.itemId).toBe(ITEM_ID);
  });
});
