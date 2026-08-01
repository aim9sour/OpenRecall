import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPluralCount,
  formatRatingCount,
  formatRelativeTime,
  formatReviewInterval,
  getPluralCategory,
} from "./formatters.js";

describe("explicit locale formatters", () => {
  it("formats localized digits without using the process locale", () => {
    expect(formatNumber(12_345.5, "en")).toBe("12,345.5");
    expect(formatNumber(12_345.5, "ar")).toMatch(
      /^[\u0660-\u0669٬٫]+$/,
    );
  });

  it("formats absolute and relative due time with explicit locale and zone", () => {
    const instant = Date.UTC(2025, 0, 2, 15, 30);
    expect(formatDateTime(instant, "en", "UTC")).toContain("2025");
    expect(formatDateTime(instant, "ar", "UTC")).toMatch(
      /[\u0660-\u0669]/,
    );
    expect(formatRelativeTime(2, "day", "en")).toBe("in 2 days");
    expect(formatRelativeTime(-1, "day", "en")).toBe("yesterday");
  });

  it("does not discard whole days from long durations", () => {
    expect(formatDuration(90_061_000, "en")).toBe(
      "1 day, 1 hour, 1 minute, 1 second",
    );
    expect(formatDuration(90_061_000, "ar")).toMatch(
      /يوم.*ساعة.*دقيقة.*ثانية/,
    );
  });

  it.each([
    [0, "1 minute"],
    [3_599_999, "60 minutes"],
    [3_600_000, "1 hour"],
    [86_399_999, "24 hours"],
    [86_400_000, "1 day"],
    [2_591_999_999, "30 days"],
    [2_592_000_000, "1 month"],
    [3_888_000_000, "2 months"],
  ] as const)(
    "formats review interval %i ms as %s",
    (intervalMs, expected) => {
      expect(formatReviewInterval(intervalMs, "en")).toBe(expected);
    },
  );

  it("uses locale-aware Arabic review interval units", () => {
    expect(formatReviewInterval(59 * 60_000, "ar")).toBe(
      "٥٩ دقيقة",
    );
    expect(formatReviewInterval(3 * 3_600_000, "ar")).toBe(
      "٣ ساعات",
    );
    expect(formatReviewInterval(4 * 86_400_000, "ar")).toBe(
      "٤ أيام",
    );
    expect(formatReviewInterval(60 * 86_400_000, "ar")).toBe(
      "شهران",
    );
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid review interval %s",
    (intervalMs) => {
      expect(() => formatReviewInterval(intervalMs, "en")).toThrow(
        "FORMAT_REVIEW_INTERVAL_INVALID",
      );
    },
  );
});

describe("plural and rating helpers", () => {
  it.each([
    [0, "zero"],
    [1, "one"],
    [2, "two"],
    [3, "few"],
    [11, "many"],
    [100, "other"],
  ] as const)("selects Arabic %s as %s", (count, category) => {
    expect(getPluralCategory(count, "ar")).toBe(category);
  });

  it("selects English singular and plural", () => {
    expect(getPluralCategory(1, "en")).toBe("one");
    expect(getPluralCategory(2, "en")).toBe("other");
  });

  it("formats plural counts and rating counts with localized numbers", () => {
    const forms = {
      zero: "no cards",
      one: "{{count}} card",
      two: "{{count}} cards",
      few: "{{count}} cards",
      many: "{{count}} cards",
      other: "{{count}} cards",
    } as const;
    expect(formatPluralCount(1, "en", forms)).toBe("1 card");
    expect(formatPluralCount(2, "en", forms)).toBe("2 cards");
    expect(formatRatingCount("Good", 12, "en")).toBe("Good: 12");
    expect(formatRatingCount("جيد", 12, "ar")).toMatch(
      /^جيد: [\u0660-\u0669]+$/,
    );
  });
});
