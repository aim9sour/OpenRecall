import { describe, expect, it } from "vitest";
import { normalizeLocalizedNumber } from "./normalize-localized-number.js";

describe("normalizeLocalizedNumber", () => {
  it("normalizes Arabic-Indic and Persian digits without accepting grouping", () => {
    expect(normalizeLocalizedNumber("٠٫٩٢")).toBe("0.92");
    expect(normalizeLocalizedNumber("۱۲۸")).toBe("128");
    expect(normalizeLocalizedNumber("١٬٠٠٠")).toBeNull();
    expect(normalizeLocalizedNumber("1,000")).toBeNull();
  });
});
