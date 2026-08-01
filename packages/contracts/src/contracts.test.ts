import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  ApplicationLocalePreferenceMutationSchema,
  ApplicationLocalePreferenceSchema,
  ApiErrorSchema,
  CardImportSchema,
  ImportPreviewSchema,
  ReviewPageStateSchema,
  SectionSummarySchema,
} from "./index.js";

describe("shared runtime contracts", () => {
  it("accepts registered production locales and rejects the development locale", () => {
    expect(
      Value.Check(ApplicationLocalePreferenceSchema, {
        locale: "ar",
        updatedAtMs: 100,
      }),
    ).toBe(true);
    expect(
      Value.Check(ApplicationLocalePreferenceMutationSchema, {
        locale: "en",
        expectedUpdatedAtMs: 100,
      }),
    ).toBe(true);
    expect(
      Value.Check(ApplicationLocalePreferenceMutationSchema, {
        locale: "en-XA",
        expectedUpdatedAtMs: 100,
      }),
    ).toBe(false);
  });

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
            warnings: [
              { path: "cards[1]", messageKey: "import.duplicate" },
            ],
          },
          {
            index: 2,
            status: "invalid",
            issues: [
              { path: "cards[2].front", messageKey: "error.field.required" },
            ],
            warnings: [],
          },
        ],
      }),
    ).toBe(true);
  });

  it("keeps unrevealed question contracts free of answer content", () => {
    const questionState = {
      kind: "question",
      card: {
        entryId: "d9428888-122b-41e1-985c-61cd3cbb3210",
        learningItemId: "a8f65aa8-122b-41e1-985c-61cd3cbb3210",
        presentationId: "b9f65aa8-122b-41e1-985c-61cd3cbb3210",
        front: "Question",
        stateRevision: 0,
      },
      session: {
        id: "c9f65aa8-122b-41e1-985c-61cd3cbb3210",
        sectionId: "d9428888-122b-41e1-985c-61cd3cbb3210",
        status: "active",
        revision: 1,
        completedAppearances: 0,
        currentlyRemaining: 1,
        newRemaining: 1,
        repeatedWithinSession: 0,
        elapsedActiveMs: 0,
        newlyJoined: 1,
        nextDueAtMs: null,
        remainingSnapshotAtMs: 1000,
      },
    };

    expect(Value.Check(ReviewPageStateSchema, questionState)).toBe(true);
    expect(
      Value.Check(ReviewPageStateSchema, {
        ...questionState,
        card: { ...questionState.card, back: "must not be present" },
      }),
    ).toBe(false);
  });
});
