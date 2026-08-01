import type { ReviewInvalidationEvent } from "./review-events.js";

export const MAX_TIMER_DELAY_MS = 2_147_000_000;

export interface TimerHandle {
  unref?(): void;
}

export interface DueWakeTarget {
  readonly sessionId: string;
  readonly dueAtMs: number;
}

export interface DueWakeRepository {
  findNextDue(nowMs: number): DueWakeTarget | null;
  mergeDueItems(
    sessionId: string,
    nowMs: number,
  ): { readonly added: number; readonly revision: number };
}

export interface ReviewEventPublisher {
  publish(event: ReviewInvalidationEvent): void;
}

export interface DueWakeClock {
  readonly now: () => number;
  readonly setTimer: (
    callback: () => void,
    delayMs: number,
  ) => TimerHandle;
  readonly clearTimer: (timer: TimerHandle) => void;
}

const systemClock: DueWakeClock = {
  now: Date.now,
  setTimer(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clearTimer(timer) {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};

function validateTarget(target: DueWakeTarget): void {
  if (
    target.sessionId.length === 0 ||
    !Number.isSafeInteger(target.dueAtMs) ||
    target.dueAtMs < 0
  ) {
    throw new Error("DUE_WAKE_TARGET_INVALID");
  }
}

export class DueWakeService {
  readonly #repository: DueWakeRepository;
  readonly #events: ReviewEventPublisher;
  readonly #clock: DueWakeClock;
  #started = false;
  #timer: TimerHandle | null = null;

  constructor(
    repository: DueWakeRepository,
    events: ReviewEventPublisher,
    clock: DueWakeClock = systemClock,
  ) {
    this.#repository = repository;
    this.#events = events;
    this.#clock = clock;
  }

  start(): void {
    if (this.#started) {
      return;
    }

    this.#started = true;
    this.#scheduleFromDatabase();
  }

  rearm(): void {
    if (!this.#started) {
      return;
    }

    this.#clearCurrentTimer();
    this.#scheduleFromDatabase();
  }

  stop(): void {
    this.#started = false;
    this.#clearCurrentTimer();
  }

  #clearCurrentTimer(): void {
    if (this.#timer !== null) {
      this.#clock.clearTimer(this.#timer);
      this.#timer = null;
    }
  }

  #scheduleFromDatabase(): void {
    if (!this.#started) {
      return;
    }

    const nowMs = this.#clock.now();
    const target = this.#repository.findNextDue(nowMs);
    if (target !== null) {
      this.#scheduleTarget(target, nowMs);
    }
  }

  #scheduleTarget(target: DueWakeTarget, nowMs: number): void {
    validateTarget(target);
    const delayMs = Math.min(
      Math.max(0, target.dueAtMs - nowMs),
      MAX_TIMER_DELAY_MS,
    );
    const timer = this.#clock.setTimer(() => {
      this.#clock.clearTimer(timer);
      if (this.#timer === timer) {
        this.#timer = null;
      }
      this.#wake();
    }, delayMs);
    this.#timer = timer;
    timer.unref?.();
  }

  #wake(): void {
    if (!this.#started) {
      return;
    }

    const nowMs = this.#clock.now();
    const target = this.#repository.findNextDue(nowMs);
    if (target === null) {
      return;
    }
    validateTarget(target);

    if (target.dueAtMs > nowMs) {
      this.#scheduleTarget(target, nowMs);
      return;
    }

    const merged = this.#repository.mergeDueItems(
      target.sessionId,
      nowMs,
    );
    if (merged.added > 0) {
      this.#events.publish({
        event: "review-invalidated",
        data: {
          sessionId: target.sessionId,
          revision: merged.revision,
        },
      });
    }
    this.#scheduleFromDatabase();
  }
}
