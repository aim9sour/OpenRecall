import { describe, expect, it } from "vitest";
import { ReviewEvents } from "./review-events.js";

describe("ReviewEvents", () => {
  it("canonicalizes invalidations and unsubscribe removes the subscriber", async () => {
    const events = new ReviewEvents();
    const received: unknown[] = [];
    const unsubscribe = events.subscribe({
      async send(event) {
        received.push(event);
      },
      close() {},
    });

    events.publish({
      event: "review-invalidated",
      data: {
        sessionId: "session-1",
        revision: 3,
        front: "must be stripped",
      },
    } as never);
    await Promise.resolve();

    expect(received).toEqual([
      {
        event: "review-invalidated",
        data: { sessionId: "session-1", revision: 3 },
      },
    ]);
    unsubscribe();
    unsubscribe();
    expect(events.subscriberCount).toBe(0);
  });

  it("detaches and closes a transport whose send fails", async () => {
    const events = new ReviewEvents();
    let closed = false;
    events.subscribe({
      async send() {
        throw new Error("transport closed");
      },
      close() {
        closed = true;
      },
    });

    events.publish({
      event: "review-invalidated",
      data: { sessionId: "session-1", revision: 1 },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.subscriberCount).toBe(0);
    expect(closed).toBe(true);
  });
});
