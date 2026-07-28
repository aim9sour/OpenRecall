import {
  TEST_AUTHORITY,
  TEST_ORIGIN,
  testRequestHeaders,
} from "@openrecall/test-support";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { ReviewEvents } from "../review/review-events.js";

const openServers: FastifyInstance[] = [];

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("TEST_CONDITION_TIMEOUT");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function createTestServer(
  events: ReviewEvents,
): Promise<FastifyInstance> {
  const server = await buildServer({
    config: {
      authority: TEST_AUTHORITY,
      dataDirectory: "unused-in-injection-tests",
      host: "127.0.0.1",
      locale: "ar",
      port: 3_210,
      publicOrigin: TEST_ORIGIN,
    },
    reviewEvents: events,
    sseHeartbeatIntervalMs: 10,
  });
  openServers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

describe("review event stream", () => {
  it("streams only revision invalidations and content-free heartbeats", async () => {
    const events = new ReviewEvents();
    const server = await createTestServer(events);
    const responsePromise = server.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: {
        ...testRequestHeaders({ origin: TEST_ORIGIN }),
        accept: "text/event-stream",
      },
    });

    await waitFor(() => events.subscriberCount === 1);
    events.publish({
      event: "review-invalidated",
      data: { sessionId: "session-1", revision: 7 },
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    events.closeAll();

    const response = await responsePromise;
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/event-stream");
    expect(response.body).toContain("event: review-invalidated");
    expect(response.body).toContain(
      'data: {"sessionId":"session-1","revision":7}',
    );
    expect(response.body).toContain(": heartbeat");
    expect(response.body).not.toMatch(/front|back|notes|question|answer/i);
    expect(events.subscriberCount).toBe(0);
  });

  it("rejects the wrong Host or Origin before opening a stream", async () => {
    const events = new ReviewEvents();
    const server = await createTestServer(events);

    const wrongHost = await server.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: {
        host: "localhost:3210",
        origin: TEST_ORIGIN,
        accept: "text/event-stream",
      },
    });
    const wrongOrigin = await server.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: {
        host: TEST_AUTHORITY,
        origin: "http://localhost:3210",
        accept: "text/event-stream",
      },
    });

    expect(wrongHost.statusCode).toBe(421);
    expect(wrongOrigin.statusCode).toBe(403);
    expect(wrongOrigin.json()).toEqual({
      code: "ORIGIN_NOT_ALLOWED",
      messageKey: "error.originNotAllowed",
    });
    expect(events.subscriberCount).toBe(0);
  });
});
