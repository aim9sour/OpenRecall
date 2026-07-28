import { describe, expect, it } from "vitest";
import {
  DueWakeService,
  MAX_TIMER_DELAY_MS,
  type DueWakeTarget,
  type TimerHandle,
} from "./due-wake-service.js";

interface ScheduledTimer extends TimerHandle {
  readonly callback: () => void;
  readonly delayMs: number;
  cleared: boolean;
  unrefCalled: boolean;
}

function createHarness(initialNowMs = 0) {
  let nowMs = initialNowMs;
  let target: DueWakeTarget | null = null;
  const timers: ScheduledTimer[] = [];
  const mergeCalls: Array<{ sessionId: string; nowMs: number }> = [];
  const events: Array<{ sessionId: string; revision: number }> = [];
  let nextMerge = { added: 1, revision: 1 };
  let queryCount = 0;

  const service = new DueWakeService(
    {
      findNextDue(currentNowMs) {
        queryCount += 1;
        return target === null ? null : { ...target };
      },
      mergeDueItems(sessionId, currentNowMs) {
        mergeCalls.push({ sessionId, nowMs: currentNowMs });
        target = null;
        return nextMerge;
      },
    },
    {
      publish(event) {
        events.push(event.data);
      },
    },
    {
      now: () => nowMs,
      setTimer(callback, delayMs) {
        const timer: ScheduledTimer = {
          callback,
          delayMs,
          cleared: false,
          unrefCalled: false,
          unref() {
            timer.unrefCalled = true;
          },
        };
        timers.push(timer);
        return timer;
      },
      clearTimer(timer) {
        (timer as ScheduledTimer).cleared = true;
      },
    },
  );

  return {
    service,
    timers,
    mergeCalls,
    events,
    get queryCount() {
      return queryCount;
    },
    setNow(value: number) {
      nowMs = value;
    },
    setTarget(value: DueWakeTarget | null) {
      target = value;
    },
    setMergeResult(value: { added: number; revision: number }) {
      nextMerge = value;
    },
    runLatestTimer() {
      const timer = timers.at(-1);
      if (timer === undefined) {
        throw new Error("TEST_TIMER_NOT_FOUND");
      }
      timer.callback();
    },
  };
}

describe("DueWakeService", () => {
  it("keeps one exact timer, merges at due time, and publishes invalidation", () => {
    const harness = createHarness(100);
    harness.setTarget({ sessionId: "session-1", dueAtMs: 1_000 });

    harness.service.start();
    harness.service.start();

    expect(harness.timers).toHaveLength(1);
    expect(harness.timers[0]).toMatchObject({
      delayMs: 900,
      cleared: false,
      unrefCalled: true,
    });

    harness.setNow(1_000);
    harness.runLatestTimer();

    expect(harness.mergeCalls).toEqual([
      { sessionId: "session-1", nowMs: 1_000 },
    ]);
    expect(harness.events).toEqual([
      { sessionId: "session-1", revision: 1 },
    ]);
    expect(harness.queryCount).toBe(3);
    expect(harness.timers).toHaveLength(1);
  });

  it("rearms after a database change and clears the prior timer", () => {
    const harness = createHarness();
    harness.setTarget({ sessionId: "session-1", dueAtMs: 10_000 });
    harness.service.start();

    harness.setTarget({ sessionId: "session-1", dueAtMs: 500 });
    harness.service.rearm();

    expect(harness.timers).toHaveLength(2);
    expect(harness.timers[0]?.cleared).toBe(true);
    expect(harness.timers[1]?.delayMs).toBe(500);
  });

  it("recovers from backward and forward clock jumps by requerying exact due", () => {
    const backward = createHarness();
    backward.setTarget({ sessionId: "session-1", dueAtMs: 1_000 });
    backward.service.start();
    backward.setNow(500);
    backward.runLatestTimer();

    expect(backward.mergeCalls).toEqual([]);
    expect(backward.timers.at(-1)?.delayMs).toBe(500);

    const forward = createHarness();
    forward.setTarget({ sessionId: "session-2", dueAtMs: 1_000 });
    forward.service.start();
    forward.setNow(5_000);
    forward.runLatestTimer();

    expect(forward.mergeCalls).toEqual([
      { sessionId: "session-2", nowMs: 5_000 },
    ]);
  });

  it("splits a 90-day wait into safe delays without polling", () => {
    const harness = createHarness();
    const dueAtMs = 90 * 24 * 60 * 60 * 1_000;
    harness.setTarget({ sessionId: "session-1", dueAtMs });
    harness.service.start();

    expect(harness.timers[0]?.delayMs).toBe(MAX_TIMER_DELAY_MS);

    harness.setNow(MAX_TIMER_DELAY_MS);
    harness.runLatestTimer();

    expect(harness.mergeCalls).toEqual([]);
    expect(harness.timers).toHaveLength(2);
    expect(harness.timers[1]?.delayMs).toBe(MAX_TIMER_DELAY_MS);
  });

  it("does not publish unchanged merges and stop cleans up", () => {
    const harness = createHarness();
    harness.setTarget({ sessionId: "session-1", dueAtMs: 0 });
    harness.setMergeResult({ added: 0, revision: 4 });
    harness.service.start();
    harness.runLatestTimer();
    harness.service.stop();

    expect(harness.events).toEqual([]);
    expect(harness.timers.every((timer) => timer.cleared)).toBe(true);
    expect(() => harness.service.rearm()).not.toThrow();
    expect(harness.timers).toHaveLength(1);
  });
});
