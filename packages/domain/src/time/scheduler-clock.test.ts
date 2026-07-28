import { describe, expect, it } from "vitest";
import {
  fromSchedulerDate,
  studyDayDelta,
  toSchedulerDate,
} from "./scheduler-clock.js";
import type { StudyDayConfig } from "./types.js";

const cairoStudyDay: StudyDayConfig = {
  timeZone: "Africa/Cairo",
  boundaryMinutes: 240,
};

describe("scheduler clock", () => {
  it("keeps pre-boundary Cairo time in the previous study day", () => {
    const local0130 = Date.parse("2026-07-27T22:30:00.000Z");
    const local0400 = Date.parse("2026-07-28T01:00:00.000Z");

    expect(toSchedulerDate(local0130, cairoStudyDay).toISOString()).toBe(
      "2026-07-27T21:30:00.000Z",
    );
    expect(toSchedulerDate(local0400, cairoStudyDay).toISOString()).toBe(
      "2026-07-28T00:00:00.000Z",
    );
  });

  it("preserves UTC fields and milliseconds when the boundary is midnight", () => {
    const config: StudyDayConfig = {
      timeZone: "UTC",
      boundaryMinutes: 0,
    };
    const epochMs = Date.parse("2026-07-28T12:34:56.789Z");
    const schedulerDate = toSchedulerDate(epochMs, config);

    expect(schedulerDate.toISOString()).toBe("2026-07-28T12:34:56.789Z");
    expect(fromSchedulerDate(schedulerDate, config)).toBe(epochMs);
  });

  it.each([
    ["spring", "2026-03-07T17:00:00.000Z"],
    ["fall", "2026-11-02T17:00:00.000Z"],
  ])("round-trips an ordinary New York instant near the %s transition", (_, iso) => {
    const config: StudyDayConfig = {
      timeZone: "America/New_York",
      boundaryMinutes: 240,
    };
    const epochMs = Date.parse(iso);

    expect(fromSchedulerDate(toSchedulerDate(epochMs, config), config)).toBe(
      epochMs,
    );
  });

  it("uses compatible disambiguation for a skipped New York wall time", () => {
    const config: StudyDayConfig = {
      timeZone: "America/New_York",
      boundaryMinutes: 0,
    };
    const skippedWallTime = new Date("2026-03-08T02:30:00.000Z");

    expect(fromSchedulerDate(skippedWallTime, config)).toBe(
      Date.parse("2026-03-08T07:30:00.000Z"),
    );
  });

  it("uses the earlier occurrence for a repeated New York wall time", () => {
    const config: StudyDayConfig = {
      timeZone: "America/New_York",
      boundaryMinutes: 0,
    };
    const repeatedWallTime = new Date("2026-11-01T01:30:00.000Z");

    expect(fromSchedulerDate(repeatedWallTime, config)).toBe(
      Date.parse("2026-11-01T05:30:00.000Z"),
    );
  });

  it("counts calendar study-day changes rather than elapsed 24-hour periods", () => {
    const beforeBoundary = Date.parse("2026-07-27T22:30:00.000Z");
    const atBoundary = Date.parse("2026-07-28T01:00:00.000Z");

    expect(studyDayDelta(beforeBoundary, atBoundary, cairoStudyDay)).toBe(1);
  });

  it.each([-1, 1.5, 1440])(
    "rejects invalid boundary minutes: %s",
    (boundaryMinutes) => {
      expect(() =>
        toSchedulerDate(Date.now(), {
          timeZone: "UTC",
          boundaryMinutes,
        }),
      ).toThrow(RangeError);
    },
  );

  it("rejects an invalid IANA time zone", () => {
    expect(() =>
      toSchedulerDate(Date.now(), {
        timeZone: "Not/A_Time_Zone",
        boundaryMinutes: 0,
      }),
    ).toThrow(RangeError);
  });

  it("rejects reversed study-day ranges", () => {
    expect(() =>
      studyDayDelta(
        Date.parse("2026-07-29T00:00:00.000Z"),
        Date.parse("2026-07-28T00:00:00.000Z"),
        cairoStudyDay,
      ),
    ).toThrow(RangeError);
  });
});
