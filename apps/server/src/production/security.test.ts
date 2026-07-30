import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TEST_AUTHORITY,
  TEST_ORIGIN,
  testRequestHeaders,
  withTempDatabase,
} from "@openrecall/test-support";
import { openDatabase } from "@openrecall/database";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../app.js";
import { MaintenanceMode } from "../durability/maintenance-mode.js";
import { registerHealthRoute } from "../health.js";
import {
  registerContentFreeErrorHandler,
  registerContentFreeLogging,
  type ContentFreeLogEntry,
} from "../logging.js";
import { productionStaticClientRoot } from "./static-client.js";

const openServers: FastifyInstance[] = [];
const temporaryDirectories: string[] = [];

async function createStaticRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openrecall-static-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "assets"));
  await writeFile(
    join(root, "index.html"),
    '<!doctype html><html><body><div id="root">OpenRecall shell</div><script type="module" src="/assets/app-a1b2c3.js"></script></body></html>',
  );
  await writeFile(
    join(root, "assets", "app-a1b2c3.js"),
    'document.querySelector("#root")?.setAttribute("data-ready", "true");',
  );
  return root;
}

async function createProductionServer(): Promise<FastifyInstance> {
  const server = await buildServer({
    config: {
      authority: TEST_AUTHORITY,
      dataDirectory: "unused-in-production-security-tests",
      host: "127.0.0.1",
      locale: "en",
      port: 3_210,
      publicOrigin: TEST_ORIGIN,
    },
    staticClientRoot: await createStaticRoot(),
  });
  openServers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("production security headers and static client", () => {
  it("does not require a built client directory in development mode", () => {
    expect(
      productionStaticClientRoot(
        "C:\\definitely-missing\\apps\\web\\dist",
        { NODE_ENV: "development" },
      ),
    ).toBeUndefined();
  });

  it("wires the portable development command through the explicit development entry", async () => {
    const packageJson = JSON.parse(
      await readFile(
        new URL("../../package.json", import.meta.url),
        "utf8",
      ),
    ) as { readonly scripts: Record<string, string> };
    const developmentEntry = await readFile(
      new URL("../development.ts", import.meta.url),
      "utf8",
    );

    expect(packageJson.scripts["dev"]).toBe(
      "tsx watch src/development.ts",
    );
    expect(developmentEntry.indexOf('process.env["NODE_ENV"]')).toBeLessThan(
      developmentEntry.indexOf('import("./index.js")'),
    );
  });

  it("uses a self-only script policy and defensive browser headers without CORS", async () => {
    const server = await createProductionServer();
    const response = await server.inject({
      method: "GET",
      url: "/",
      headers: testRequestHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-security-policy"]).toContain(
      "connect-src 'self'",
    );
    expect(response.headers["content-security-policy"]).toContain(
      "script-src 'self'",
    );
    expect(response.headers["content-security-policy"]).not.toContain(
      "'unsafe-inline'",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("keeps defensive headers on a request rejected at the Host boundary", async () => {
    const server = await createProductionServer();
    const response = await server.inject({
      method: "GET",
      url: "/",
      headers: { host: "localhost:3210" },
    });

    expect(response.statusCode).toBe(421);
    expect(response.headers["content-security-policy"]).toContain(
      "script-src 'self'",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
  });

  it("caches hashed assets immutably but never stores HTML or API responses", async () => {
    const server = await createProductionServer();
    const asset = await server.inject({
      method: "GET",
      url: "/assets/app-a1b2c3.js",
      headers: testRequestHeaders(),
    });
    const html = await server.inject({
      method: "GET",
      url: "/",
      headers: testRequestHeaders(),
    });
    const api = await server.inject({
      method: "GET",
      url: "/api/v1/bootstrap",
      headers: testRequestHeaders(),
    });

    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(html.headers["cache-control"]).toBe("no-store");
    expect(api.headers["cache-control"]).toBe("no-store");
  });

  it("falls back to the client shell without ever serving HTML below the API prefix", async () => {
    const server = await createProductionServer();
    const clientRoute = await server.inject({
      method: "GET",
      url: "/sections/00000000-0000-4000-8000-000000000000",
      headers: testRequestHeaders(),
    });
    const apiRoute = await server.inject({
      method: "GET",
      url: "/api/v1/not-real",
      headers: testRequestHeaders(),
    });
    const encodedApiRoute = await server.inject({
      method: "GET",
      url: "/api%2Fv1%2Fnot-real",
      headers: testRequestHeaders(),
    });

    expect(clientRoute.statusCode).toBe(200);
    expect(clientRoute.headers["content-type"]).toMatch(/^text\/html/);
    expect(clientRoute.body).toContain("OpenRecall shell");
    expect(apiRoute.statusCode).toBe(404);
    expect(apiRoute.headers["content-type"]).toMatch(/^application\/json/);
    expect(apiRoute.json()).toEqual({
      code: "NOT_FOUND",
      messageKey: "error.notFound",
    });
    expect(encodedApiRoute.statusCode).toBe(404);
    expect(encodedApiRoute.headers["content-type"]).toMatch(
      /^application\/json/,
    );
    expect(encodedApiRoute.json()).toEqual({
      code: "NOT_FOUND",
      messageKey: "error.notFound",
    });
  });

  it("rejects client query keys that could place study content in a URL", async () => {
    const server = await createProductionServer();
    const unknownKey = await server.inject({
      method: "GET",
      url: "/statistics?front=private-card-text",
      headers: testRequestHeaders(),
    });
    const contentInKnownKey = await server.inject({
      method: "GET",
      url: "/statistics?sectionId=private-card-text",
      headers: testRequestHeaders(),
    });
    const contentInKey = await server.inject({
      method: "GET",
      url: "/statistics?private-card-text=",
      headers: testRequestHeaders(),
    });

    for (const response of [
      unknownKey,
      contentInKnownKey,
      contentInKey,
    ]) {
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        code: "QUERY_NOT_ALLOWED",
        messageKey: "error.validation",
      });
      expect(response.body).not.toContain("private-card-text");
    }
  });
});

describe("content-free diagnostics", () => {
  it("records only opaque request metadata for bodies, paths, tokens, and thrown stacks", async () => {
    const entries: ContentFreeLogEntry[] = [];
    let clock = 10;
    const server = Fastify({ logger: false });
    registerContentFreeLogging(server, {
      nowMs: () => clock++,
      sink: (entry) => {
        entries.push(entry);
      },
    });
    registerContentFreeErrorHandler(server);
    server.post("/cards/:cardId", async () => {
      throw new Error(
        "card answer at C:\\Users\\private\\cards.sqlite3\nPRIVATE_STACK_MARKER",
      );
    });
    await server.ready();
    openServers.push(server);

    const response = await server.inject({
      method: "POST",
      url: "/cards/card-path-secret?notes=query-secret",
      headers: {
        "content-type": "application/json",
        "x-openrecall-csrf": "csrf-secret",
      },
      payload: { front: "front-secret", back: "back-secret" },
    });
    const serialized = JSON.stringify(entries);

    expect(response.statusCode).toBe(500);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      diagnosticId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
      ),
      requestId: expect.stringMatching(/^[A-Za-z0-9-]+$/),
      route: "/cards/:cardId",
      status: 500,
      durationMs: expect.any(Number),
    });
    for (const secret of [
      "card-path-secret",
      "query-secret",
      "csrf-secret",
      "front-secret",
      "back-secret",
      "C:\\Users\\private",
      "PRIVATE_STACK_MARKER",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe("content-free health", () => {
  it("reads database state through a live provider", async () => {
    let database = {
      open: true,
      pragma: () => 5,
    };
    const server = Fastify({ logger: false });
    registerHealthRoute(
      server,
      new MaintenanceMode(),
      () => database,
    );
    await server.ready();
    openServers.push(server);

    const available = await server.inject("/api/v1/health");
    database = {
      open: false,
      pragma: () => 5,
    };
    const closed = await server.inject("/api/v1/health");

    expect(available.statusCode).toBe(200);
    expect(available.json()).toMatchObject({
      database: "open",
      schema: "supported",
    });
    expect(closed.statusCode).toBe(503);
    expect(closed.json()).toMatchObject({
      database: "closed",
      schema: "not-checked",
    });
  });

  it("reports only app, API, schema, database, and maintenance state", async () => {
    await withTempDatabase(async (databasePath) => {
      const database = openDatabase(databasePath);
      const server = await buildServer({
        config: {
          authority: TEST_AUTHORITY,
          dataDirectory: "unused-in-production-health-tests",
          host: "127.0.0.1",
          locale: "en",
          port: 3_210,
          publicOrigin: TEST_ORIGIN,
        },
        database,
      });
      try {
        const response = await server.inject({
          method: "GET",
          url: "/api/v1/health",
          headers: testRequestHeaders(),
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
          app: "OpenRecall",
          apiVersion: 1,
          status: "ok",
          database: "open",
          schema: "supported",
          schemaVersion: 5,
          maintenance: false,
        });
        expect(response.body).not.toMatch(
          /(?:card|front|back|notes|path|directory|sqlite)/iu,
        );
      } finally {
        await server.close();
      }
    });
  });
});
