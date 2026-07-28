import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { selectPresentation } from "./select-presentation.js";

const candidateArbitrary = fc.record({
  id: fc.uuid(),
  lastShownAtMs: fc.option(
    fc.integer({ min: 0, max: 1_000_000 }),
    { nil: null },
  ),
  showCount: fc.integer({ min: 0, max: 10_000 }),
});

describe("presentation rotation properties", () => {
  it("always returns an ID from a nonempty candidate set", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(candidateArbitrary, {
          minLength: 1,
          maxLength: 30,
          selector: (candidate) => candidate.id,
        }),
        (candidates) => {
          const selected = selectPresentation(candidates, () => 0);
          expect(candidates.some((candidate) => candidate.id === selected)).toBe(
            true,
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it("never repeats a uniquely most-recent presentation when an alternative exists", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(candidateArbitrary, {
          minLength: 2,
          maxLength: 30,
          selector: (candidate) => candidate.id,
        }),
        (generated) => {
          const candidates = generated.map((candidate, index) => ({
            ...candidate,
            lastShownAtMs:
              index === 0 ? 2_000_000 : candidate.lastShownAtMs,
          }));

          expect(selectPresentation(candidates, () => 0)).not.toBe(
            candidates[0]?.id,
          );
        },
      ),
      { numRuns: 300 },
    );
  });

  it("chooses the lesser-shown candidate when recency is tied", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 2, max: 10_000 }),
        (baseCount, difference) => {
          expect(
            selectPresentation(
              [
                {
                  id: "less",
                  lastShownAtMs: null,
                  showCount: baseCount,
                },
                {
                  id: "more",
                  lastShownAtMs: null,
                  showCount: baseCount + difference,
                },
              ],
              () => 0,
            ),
          ).toBe("less");
        },
      ),
      { numRuns: 300 },
    );
  });
});
