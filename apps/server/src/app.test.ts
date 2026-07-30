import {
  TEST_AUTHORITY,
  TEST_ORIGIN,
  testRequestHeaders,
} from "@openrecall/test-support";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./app.js";
import { loadConfig } from "./config.js";
import { MaintenanceMode } from "./durability/maintenance-mode.js";

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
      databaseRevision: 1,
      locale: "ar",
    });
  });

  it("rejects mutations during maintenance while keeping bootstrap readable", async () => {
    const maintenance = new MaintenanceMode();
    const server = await buildServer({
      config: {
        authority: TEST_AUTHORITY,
        dataDirectory: "unused-in-injection-tests",
        host: "127.0.0.1",
        locale: "ar",
        port: 3_210,
        publicOrigin: TEST_ORIGIN,
      },
      maintenanceMode: maintenance,
    });
    openServers.push(server);
    const bootstrap = await server.inject({
      method: "GET",
      url: "/api/v1/bootstrap",
      headers: testRequestHeaders(),
    });
    const csrfToken = bootstrap.json<{ csrfToken: string }>().csrfToken;
    const lease = maintenance.acquire(1);
    try {
      const mutation = await server.inject({
        method: "POST",
        url: "/api/v1/not-a-real-route",
        headers: testRequestHeaders({
          csrfToken,
          origin: TEST_ORIGIN,
        }),
      });
      expect(mutation.statusCode).toBe(503);
      expect(mutation.json()).toEqual({
        code: "MAINTENANCE_MODE",
        messageKey: "error.maintenance",
      });
      const readable = await server.inject({
        method: "GET",
        url: "/api/v1/bootstrap",
        headers: testRequestHeaders(),
      });
      expect(readable.statusCode).toBe(200);
      const health = await server.inject({
        method: "GET",
        url: "/api/v1/health",
        headers: testRequestHeaders(),
      });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toEqual({
        app: "OpenRecall",
        apiVersion: 1,
        status: "ok",
        database: "not-configured",
        schema: "not-checked",
        schemaVersion: 5,
        maintenance: true,
      });
    } finally {
      lease.release();
    }
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

  it("uses a content-free envelope for an unknown route", async () => {
    const server = await createTestServer();
    const response = await server.inject({
      method: "GET",
      url: "/api/v1/private-content-in-path",
      headers: testRequestHeaders(),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: "NOT_FOUND",
      messageKey: "error.notFound",
    });
    expect(response.body).not.toContain("private-content-in-path");
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

  it("allows the pseudo-locale only behind the development test flag", () => {
    expect(
      loadConfig({
        NODE_ENV: "development",
        OPENRECALL_ENABLE_PSEUDO_LOCALE: "1",
        OPENRECALL_LOCALE: "en-XA",
      }).locale,
    ).toBe("en-XA");
    expect(() =>
      loadConfig({
        NODE_ENV: "development",
        OPENRECALL_LOCALE: "en-XA",
      }),
    ).toThrowError("SERVER_LOCALE_NOT_SUPPORTED");
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        OPENRECALL_ENABLE_PSEUDO_LOCALE: "1",
        OPENRECALL_LOCALE: "en-XA",
      }),
    ).toThrowError("SERVER_LOCALE_NOT_SUPPORTED");
  });
});
