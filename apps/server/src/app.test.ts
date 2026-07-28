import {
  TEST_AUTHORITY,
  TEST_ORIGIN,
  testRequestHeaders,
} from "@openrecall/test-support";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./app.js";
import { loadConfig } from "./config.js";

const openServers: FastifyInstance[] = [];

async function createTestServer(): Promise<FastifyInstance> {
  const server = await buildServer({
    config: {
      authority: TEST_AUTHORITY,
      dataDirectory: "unused-in-injection-tests",
      host: "127.0.0.1",
      locale: "ar",
      port: 3_210,
      publicOrigin: TEST_ORIGIN,
    },
  });
  openServers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

describe("server boundary security", () => {
  it("returns only the public bootstrap fields and a random token", async () => {
    const server = await createTestServer();
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/bootstrap",
      headers: testRequestHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      apiVersion: 1,
      csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      locale: "ar",
    });
  });

  it("rejects a request sent to any other Host authority", async () => {
    const server = await createTestServer();
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/bootstrap",
      headers: { host: "localhost:3210" },
    });

    expect(response.statusCode).toBe(421);
    expect(response.json()).toEqual({
      code: "HOST_NOT_ALLOWED",
      messageKey: "error.hostNotAllowed",
    });
  });

  it("rejects a mutation from any other Origin", async () => {
    const server = await createTestServer();
    const bootstrap = await server.inject({
      method: "GET",
      url: "/api/v1/bootstrap",
      headers: testRequestHeaders(),
    });
    const { csrfToken } = bootstrap.json<{ csrfToken: string }>();

    const response = await server.inject({
      method: "POST",
      url: "/api/v1/not-a-real-route",
      headers: testRequestHeaders({
        csrfToken,
        origin: "http://localhost:3210",
      }),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      code: "ORIGIN_NOT_ALLOWED",
      messageKey: "error.originNotAllowed",
    });
  });

  it("rejects a mutation without the process CSRF token", async () => {
    const server = await createTestServer();
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/not-a-real-route",
      headers: testRequestHeaders({ origin: TEST_ORIGIN }),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      code: "CSRF_TOKEN_INVALID",
      messageKey: "error.csrfTokenInvalid",
    });
  });
});

describe("server configuration", () => {
  it("uses fixed loopback boundaries in production and development", () => {
    expect(loadConfig({}).publicOrigin).toBe("http://127.0.0.1:3210");
    expect(loadConfig({ NODE_ENV: "development" }).publicOrigin).toBe(
      "http://127.0.0.1:5173",
    );

    expect(() =>
      loadConfig({ OPENRECALL_HOST: "0.0.0.0" }),
    ).toThrowError("SERVER_HOST_NOT_ALLOWED");
    expect(() =>
      loadConfig({ OPENRECALL_PUBLIC_ORIGIN: "https://example.com" }),
    ).toThrowError("SERVER_ORIGIN_NOT_ALLOWED");
  });
});
