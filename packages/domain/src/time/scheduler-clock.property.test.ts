import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  fromSchedulerDate,
  studyDayDelta,
  toSchedulerDate,
} from "./scheduler-clock.js";
import type { StudyDayConfig } from "./types.js";

const zones = [
  "UTC",
  "Africa/Cairo",
  "America/New_York",
  "Asia/Kolkata",
] as const;

const tenYearInstant = fc
  .date({
    min: new Date("2021-01-01T00:00:00.000Z"),
    max: new Date("2030-12-31T23:59:59.999Z"),
    noInvalidDate: true,
  })
  .map((date) => date.getTime());

const configArbitrary = fc.record({
  timeZone: fc.constantFrom(...zones),
  boundaryMinutes: fc.integer({ min: 0, max: 1439 }),
});

describe("scheduler clock properties", () => {
  it("projects every instant deterministically", () => {
    fc.assert(
      fc.property(
        tenYearInstant,
        configArbitrary,
        (epochMs, config: StudyDayConfig) => {
          expect(toSchedulerDate(epochMs, config).getTime()).toBe(
            toSchedulerDate(epochMs, config).getTime(),
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it("produces a nonnegative integral study-day delta", () => {
    fc.assert(
      fc.property(
        tenYearInstant,
        tenYearInstant,
        configArbitrary,
        (firstMs, secondMs, config: StudyDayConfig) => {
          const previousMs = Math.min(firstMs, secondMs);
          const currentMs = Math.max(firstMs, secondMs);
          const delta = studyDayDelta(previousMs, currentMs, config);

          expect(Number.isInteger(delta)).toBe(true);
          expect(delta).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("round-trips ordinary instants across all supported test zones", () => {
    const ordinaryInstant = fc
      .tuple(
        fc.integer({ min: 2021, max: 2030 }),
        fc.integer({ min: 0, max: 11 }),
      )
      .map(([year, month]) => Date.UTC(year, month, 15, 18, 15, 30, 123));
    const ordinaryConfig = fc.record({
      timeZone: fc.constantFrom(...zones),
      boundaryMinutes: fc.integer({ min: 0, max: 120 }),
    });

    fc.assert(
      fc.property(
        ordinaryInstant,
        ordinaryConfig,
        (epochMs, config: StudyDayConfig) => {
          expect(
            fromSchedulerDate(toSchedulerDate(epochMs, config), config),
          ).toBe(epochMs);
        },
      ),
      { numRuns: 500 },
    );
  });
});
