import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeText } from "./normalize.js";
import { validateImportJson } from "./validate-import.js";

describe("import validation properties", () => {
  it("never throws for arbitrary JSON values", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(() => validateImportJson(value, new Set())).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });

  it("normalization is idempotent", () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        expect(normalizeText(normalizeText(value))).toBe(normalizeText(value));
      }),
      { numRuns: 300 },
    );
  });

  it("valid plain-text presentations round-trip", () => {
    const plainText = fc
      .string({ minLength: 1, maxLength: 100 })
      .filter((value) => value.trim().length > 0 && !value.includes("<"));

    fc.assert(
      fc.property(plainText, plainText, (front, back) => {
        const result = validateImportJson({ front, back }, new Set());
        expect(result.valid).toBe(1);
        expect(result.acceptedItems[0]).toMatchObject({
          front: normalizeText(front),
          back: normalizeText(back),
        });
      }),
      { numRuns: 200 },
    );
  });
});
