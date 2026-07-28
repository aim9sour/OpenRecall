import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  ApiErrorSchema,
  CardImportSchema,
  ImportPreviewSchema,
  SectionSummarySchema,
} from "./index.js";

describe("shared runtime contracts", () => {
  it("accepts a card with any number of optional presentations", () => {
    const card = {
      front: "What is spaced retrieval?",
      back: "Reviewing shortly before forgetting.",
      source: "A preserved future field",
      variants: Array.from({ length: 32 }, (_, index) => ({
        front: `Alternative wording ${index}`,
        back: "The same underlying answer",
        notes: index % 2 === 0 ? null : "Optional hint",
      })),
    };

    expect(Value.Check(CardImportSchema, card)).toBe(true);
  });

  it.each([
    { front: "", back: "answer" },
    { front: "   ", back: "answer" },
    { front: "question", back: "\n\t" },
  ])("rejects a card without meaningful front and back text", (card) => {
    expect(Value.Check(CardImportSchema, card)).toBe(false);
  });

  it("validates API errors, section summaries, and import previews", () => {
    expect(
      Value.Check(ApiErrorSchema, {
        code: "IMPORT_INVALID",
        messageKey: "errors.importInvalid",
        fieldErrors: [{ path: "cards.0.front", messageKey: "errors.required" }],
      }),
    ).toBe(true);

    expect(
      Value.Check(SectionSummarySchema, {
        id: "d9428888-122b-11e1-b85c-61cd3cbb3210",
        name: "Biology",
        createdAtMs: 1_722_110_400_000,
        counts: { total: 20, new: 4, dueNow: 3 },
        nextDueAtMs: null,
      }),
    ).toBe(true);

    expect(
      Value.Check(ImportPreviewSchema, {
        total: 3,
        valid: 1,
        duplicate: 1,
        invalid: 1,
        rows: [
          { index: 0, status: "valid", issues: [], warnings: [] },
          {
            index: 1,
            status: "duplicate",
            issues: [],
            warnings: ["import.duplicate"],
          },
          {
            index: 2,
            status: "invalid",
            issues: ["errors.required"],
            warnings: [],
          },
        ],
      }),
    ).toBe(true);
  });
});
