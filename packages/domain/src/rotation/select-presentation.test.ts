import { describe, expect, it, vi } from "vitest";
import { selectPresentation } from "./select-presentation.js";

describe("selectPresentation", () => {
  it("always selects the only presentation without using randomness", () => {
    const randomIndex = vi.fn(() => 0);

    expect(
      selectPresentation(
        [{ id: "only", lastShownAtMs: 100, showCount: 20 }],
        randomIndex,
      ),
    ).toBe("only");
    expect(randomIndex).not.toHaveBeenCalled();
  });

  it("excludes the most recently shown presentation when another exists", () => {
    expect(
      selectPresentation(
        [
          { id: "recent", lastShownAtMs: 300, showCount: 0 },
          { id: "older", lastShownAtMs: 200, showCount: 10 },
        ],
        () => 0,
      ),
    ).toBe("older");
  });

  it("treats a never-shown presentation as the oldest", () => {
    expect(
      selectPresentation(
        [
          { id: "shown", lastShownAtMs: 100, showCount: 1 },
          { id: "never", lastShownAtMs: null, showCount: 0 },
          { id: "older", lastShownAtMs: 50, showCount: 1 },
        ],
        () => 0,
      ),
    ).toBe("never");
  });

  it("uses the lowest show count after the timestamp tie", () => {
    expect(
      selectPresentation(
        [
          { id: "more", lastShownAtMs: null, showCount: 3 },
          { id: "less", lastShownAtMs: null, showCount: 1 },
        ],
        () => 0,
      ),
    ).toBe("less");
  });

  it("uses the injected index only for a complete tie", () => {
    const candidates = [
      { id: "a", lastShownAtMs: null, showCount: 0 },
      { id: "b", lastShownAtMs: null, showCount: 0 },
      { id: "c", lastShownAtMs: null, showCount: 0 },
    ];

    expect(selectPresentation(candidates, () => 2)).toBe("c");
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("rejects empty candidates and out-of-range random indexes", () => {
    expect(() => selectPresentation([], () => 0)).toThrow(RangeError);
    expect(() =>
      selectPresentation(
        [
          { id: "a", lastShownAtMs: null, showCount: 0 },
          { id: "b", lastShownAtMs: null, showCount: 0 },
        ],
        () => 2,
      ),
    ).toThrow(RangeError);
  });
});
