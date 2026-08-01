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

  it("canonicalizes section deletion and rejects invalid event variants", async () => {
    const events = new ReviewEvents();
    const received: unknown[] = [];
    events.subscribe({
      async send(event) {
        received.push(event);
      },
      close() {},
    });

    events.publish({
      event: "section-deleted",
      data: { sectionId: "section-1", front: "must be stripped" },
    } as never);
    await Promise.resolve();
    expect(received).toEqual([
      {
        event: "section-deleted",
        data: { sectionId: "section-1" },
      },
    ]);
    expect(() =>
      events.publish({
        event: "section-deleted",
        data: { sectionId: "" },
      } as never),
    ).toThrow("SECTION_DELETED_EVENT_INVALID");
    expect(() =>
      events.publish({ event: "unknown", data: {} } as never),
    ).toThrow("REVIEW_EVENT_INVALID");
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

  it("detaches a failed transport for section deletion events", async () => {
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
      event: "section-deleted",
      data: { sectionId: "section-1" },
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.subscriberCount).toBe(0);
    expect(closed).toBe(true);
  });

  it("detaches a synchronous transport failure and still reaches later subscribers", () => {
    const events = new ReviewEvents();
    let brokenClosed = false;
    const received: unknown[] = [];
    events.subscribe({
      send() {
        throw new Error("SYNCHRONOUS_TRANSPORT_FAILURE");
      },
      close() {
        brokenClosed = true;
      },
    });
    events.subscribe({
      async send(event) {
        received.push(event);
      },
      close() {},
    });

    expect(() =>
      events.publish({
        event: "section-deleted",
        data: { sectionId: "section-1" },
      }),
    ).not.toThrow();

    expect(brokenClosed).toBe(true);
    expect(received).toEqual([
      {
        event: "section-deleted",
        data: { sectionId: "section-1" },
      },
    ]);
    expect(events.subscriberCount).toBe(1);
  });
});
