import dns from "node:dns";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import tls from "node:tls";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { build } from "vite";
import { buildServer } from "../../apps/server/src/app.js";
import { DueWakeService } from "../../apps/server/src/review/due-wake-service.js";
import { ReviewEvents } from "../../apps/server/src/review/review-events.js";
import { openDatabase } from "../../packages/database/src/index.js";
import { networkFenceState } from "./network-fence.js";

const TEST_HOST = "127.0.0.1";
const TEST_PORT = 3_210;
const TEST_AUTHORITY = `${TEST_HOST}:${TEST_PORT}`;
const openServers: Awaited<ReturnType<typeof buildServer>>[] = [];
const temporaryDirectories: string[] = [];
let builtClientRoot = "";

async function applicationFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(root, entry.name);
      if (entry.isDirectory()) return applicationFiles(path);
      return /\.(?:html|css|js)$/u.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

async function getHealth(): Promise<{
  readonly body: string;
  readonly status: number;
}> {
  return new Promise((resolveResponse, reject) => {
    const request = http.get(
      {
        headers: { host: TEST_AUTHORITY },
        host: TEST_HOST,
        path: "/api/v1/health",
        port: TEST_PORT,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolveResponse({
            body: Buffer.concat(chunks).toString("utf8"),
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    request.on("error", reject);
  });
}

beforeAll(async () => {
  builtClientRoot = await mkdtemp(
    join(tmpdir(), "openrecall-network-build-"),
  );
  await build({
    root: resolve("apps/web"),
    configFile: resolve("apps/web/vite.config.ts"),
    build: {
      emptyOutDir: true,
      outDir: builtClientRoot,
    },
  });
}, 30_000);

afterAll(async () => {
  if (builtClientRoot !== "") {
    await rm(builtClientRoot, { force: true, recursive: true });
  }
});

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("local-only production boundary", () => {
  it("runs the full production server behind a loopback-only DNS and socket fence", async () => {
    const connectionsBefore =
      networkFenceState.allowedSocketConnections;
    const directory = await mkdtemp(
      join(tmpdir(), "openrecall-network-fence-"),
    );
    temporaryDirectories.push(directory);
    const database = openDatabase(
      join(directory, "openrecall.sqlite3"),
    );
    const server = await buildServer({
      config: {
        authority: TEST_AUTHORITY,
        dataDirectory: directory,
        host: TEST_HOST,
        locale: "en",
        port: TEST_PORT,
        publicOrigin: `http://${TEST_AUTHORITY}`,
      },
      database,
      staticClientRoot: builtClientRoot,
    });
    openServers.push(server);
    await server.listen({ host: TEST_HOST, port: TEST_PORT });

    const response = await getHealth();

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      app: "OpenRecall",
      apiVersion: 1,
      database: "open",
      schema: "supported",
    });
    expect(networkFenceState.allowedSocketConnections).toBeGreaterThan(
      connectionsBefore,
    );
    expect(() =>
      dns.lookup("example.com", () => undefined),
    ).toThrowError("OUTBOUND_DNS_FORBIDDEN");
    expect(() =>
      net.connect({ host: "example.com", port: 443 }),
    ).toThrowError("OUTBOUND_DESTINATION_FORBIDDEN");
    expect(() =>
      tls.connect({ host: "example.com", port: 443 }),
    ).toThrowError("OUTBOUND_DESTINATION_FORBIDDEN");
  });

  it("contains no remote application dependency in the built client", async () => {
    const files = await applicationFiles(builtClientRoot);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = await readFile(file, "utf8");
      const networkDependencies = [
        ...source.matchAll(
          /(?:src|href)=["']https?:\/\/(?!127\.0\.0\.1(?::3210)?)/giu,
        ),
        ...source.matchAll(
          /url\(\s*["']?https?:\/\/(?!127\.0\.0\.1(?::3210)?)/giu,
        ),
        ...source.matchAll(
          /(?:fetch|EventSource|WebSocket)\(\s*["']https?:\/\/(?!127\.0\.0\.1(?::3210)?)/gu,
        ),
      ];
      expect(networkDependencies, file).toEqual([]);
    }
  });

  it("drains active requests before stopping database-backed services", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "openrecall-shutdown-drain-"),
    );
    temporaryDirectories.push(directory);
    const database = openDatabase(
      join(directory, "openrecall.sqlite3"),
    );
    const snapshotPath = join(directory, "manual.sqlite3");
    let releaseSnapshot!: () => void;
    const snapshotGate = new Promise<void>((resolveSnapshot) => {
      releaseSnapshot = resolveSnapshot;
    });
    const createSnapshot = vi.fn(async () => {
      await snapshotGate;
      await writeFile(snapshotPath, "SQLite format 3\u0000");
      return {
        createdAtMs: 1,
        filename: "openrecall-manual-1-test.sqlite3",
        kind: "manual" as const,
        path: snapshotPath,
      };
    });
    const dispose = vi.fn();
    const whenIdle = vi.fn(async () => undefined);
    const dueStop = vi.spyOn(DueWakeService.prototype, "stop");
    const reviewEvents = new ReviewEvents();
    const eventsClose = vi.spyOn(reviewEvents, "closeAll");
    const server = await buildServer({
      backupService: {
        createSnapshot,
        validateSnapshot: vi.fn(async () => ({
          createdAtMs: 1,
          userVersion: 1,
        })),
      },
      config: {
        authority: TEST_AUTHORITY,
        dataDirectory: directory,
        host: TEST_HOST,
        locale: "en",
        port: TEST_PORT,
        publicOrigin: `http://${TEST_AUTHORITY}`,
      },
      database,
      optimizerService: {
        cancelRun: vi.fn(() => false),
        dispose,
        getEligibility: vi.fn(),
        getRun: vi.fn(() => null),
        startRun: vi.fn(),
        whenIdle,
      },
      reviewEvents,
    });
    openServers.push(server);
    await server.listen({ host: TEST_HOST, port: TEST_PORT });
    const bootstrap = await fetch(
      `http://${TEST_AUTHORITY}/api/v1/bootstrap`,
    );
    const { csrfToken } = (await bootstrap.json()) as {
      readonly csrfToken: string;
    };
    const request = new Promise<number>((resolveRequest, reject) => {
      const activeRequest = http.request(
        {
          agent: false,
          headers: {
            connection: "close",
            origin: `http://${TEST_AUTHORITY}`,
            "x-openrecall-csrf": csrfToken,
          },
          host: TEST_HOST,
          method: "POST",
          path: "/api/v1/backup",
          port: TEST_PORT,
        },
        (response) => {
          response.resume();
          response.once("end", () => {
            resolveRequest(response.statusCode ?? 0);
          });
        },
      );
      activeRequest.once("error", reject);
      activeRequest.end();
    });
    await vi.waitFor(() => {
      expect(createSnapshot).toHaveBeenCalledOnce();
    });

    const closing = server.close();
    let disposedBeforeDrain = -1;
    let dueStoppedBeforeDrain = -1;
    try {
      await vi.waitFor(() => {
        expect(eventsClose).toHaveBeenCalled();
      });
      disposedBeforeDrain = dispose.mock.calls.length;
      dueStoppedBeforeDrain = dueStop.mock.calls.length;
    } finally {
      releaseSnapshot();
    }
    const [status] = await Promise.all([request, closing]);

    expect(status).toBe(200);
    expect(disposedBeforeDrain).toBe(0);
    expect(dueStoppedBeforeDrain).toBe(0);
    expect(dispose).toHaveBeenCalledOnce();
    expect(whenIdle).toHaveBeenCalledOnce();
    expect(dueStop).toHaveBeenCalledOnce();
    expect(database.open).toBe(false);
  });
});
