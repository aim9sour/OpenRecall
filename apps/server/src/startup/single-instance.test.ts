import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import {
  TEST_AUTHORITY,
  TEST_ORIGIN,
  withTempDatabase,
} from "@openrecall/test-support";
import { openDatabase } from "@openrecall/database";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildServer,
  recoverInterruptedOptimizerRuns,
} from "../app.js";
import { DueWakeService } from "../review/due-wake-service.js";
import { ReviewEvents } from "../review/review-events.js";
import {
  coordinateSingleInstance,
  installGracefulShutdown,
  preflightSingleInstance,
  StartupDiagnosticError,
} from "./single-instance.js";

const TEST_URL = "http://127.0.0.1:3210";

function addressInUse(): Error & { code: string } {
  return Object.assign(new Error("private operating-system text"), {
    code: "EADDRINUSE",
  });
}

function response(
  body: unknown,
  options: { readonly ok?: boolean } = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: options.ok === false ? 503 : 200,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("single-instance coordination", () => {
  it("recognizes an existing instance before reserving the port or opening application state", async () => {
    const probePort = vi.fn();

    const result = await preflightSingleInstance({
      fetchImplementation: vi.fn(async () =>
        response({
          app: "OpenRecall",
          apiVersion: 1,
          status: "ok",
        }),
      ),
      host: "127.0.0.1",
      port: 3_210,
      probePort,
    });

    expect(result).toEqual({
      kind: "already-running",
      url: TEST_URL,
    });
    expect(probePort).not.toHaveBeenCalled();
  });

  it("keeps a free port reserved while application state is prepared", async () => {
    const release = vi.fn(async () => undefined);
    const probePort = vi.fn(async () => ({
      kind: "available" as const,
      release,
    }));

    const result = await preflightSingleInstance({
      fetchImplementation: vi.fn(async () => {
        throw new Error("not listening");
      }),
      host: "127.0.0.1",
      port: 3_210,
      probePort,
    });

    expect(result).toMatchObject({
      kind: "available",
      url: TEST_URL,
    });
    expect(probePort).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    if (result.kind === "available") await result.release();
    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects a foreign occupied port before application state is opened", async () => {
    await expect(
      preflightSingleInstance({
        fetchImplementation: vi.fn(async () =>
          response({ app: "AnotherApp", apiVersion: 1 }),
        ),
        host: "127.0.0.1",
        port: 3_210,
        probePort: vi.fn(async () => ({
          kind: "occupied" as const,
        })),
      }),
    ).rejects.toEqual(
      new StartupDiagnosticError("OPENRECALL_PORT_OCCUPIED"),
    );
  });

  it("recognizes a concurrent launch that becomes healthy after taking the port", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValueOnce(
        response({
          app: "OpenRecall",
          apiVersion: 1,
          status: "ok",
        }),
      );

    await expect(
      preflightSingleInstance({
        fetchImplementation,
        host: "127.0.0.1",
        port: 3_210,
        probePort: vi.fn(async () => ({
          kind: "occupied" as const,
        })),
      }),
    ).resolves.toEqual({
      kind: "already-running",
      url: TEST_URL,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("listens once on the exact configured loopback address when the port is free", async () => {
    const server = {
      close: vi.fn(async () => undefined),
      listen: vi.fn(async () => TEST_URL),
    };
    const fetchImplementation = vi.fn<typeof fetch>();

    const result = await coordinateSingleInstance({
      fetchImplementation,
      host: "127.0.0.1",
      port: 3_210,
      server,
    });

    expect(result).toEqual({ kind: "started", url: TEST_URL });
    expect(server.listen).toHaveBeenCalledTimes(1);
    expect(server.listen).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 3_210,
    });
    expect(server.close).not.toHaveBeenCalled();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("recognizes an existing compatible OpenRecall process and closes the unused app", async () => {
    const server = {
      close: vi.fn(async () => undefined),
      listen: vi.fn(async () => {
        throw addressInUse();
      }),
    };
    const fetchImplementation = vi.fn<typeof fetch>(
      async (_input, init) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return response({
          app: "OpenRecall",
          apiVersion: 1,
          status: "ok",
        });
      },
    );

    const result = await coordinateSingleInstance({
      fetchImplementation,
      host: "127.0.0.1",
      port: 3_210,
      server,
    });

    expect(result).toEqual({
      kind: "already-running",
      url: TEST_URL,
    });
    expect(server.listen).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).toHaveBeenCalledWith(
      `${TEST_URL}/api/v1/health`,
      expect.objectContaining({
        headers: { accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    ["foreign response", response({ app: "AnotherApp", apiVersion: 1 })],
    ["future API", response({ app: "OpenRecall", apiVersion: 2 })],
    ["unhealthy response", response({}, { ok: false })],
  ])(
    "fails with one stable code and never chooses another port for a %s",
    async (_label, probeResponse) => {
      const server = {
        close: vi.fn(async () => undefined),
        listen: vi.fn(async () => {
          throw addressInUse();
        }),
      };

      const operation = coordinateSingleInstance({
        fetchImplementation: vi.fn(async () => probeResponse),
        host: "127.0.0.1",
        port: 3_210,
        server,
      });

      await expect(operation).rejects.toEqual(
        new StartupDiagnosticError("OPENRECALL_PORT_OCCUPIED"),
      );
      expect(server.listen).toHaveBeenCalledTimes(1);
      expect(server.close).toHaveBeenCalledTimes(1);
    },
  );

  it("maps a failed or timed-out health probe to the same content-free collision code", async () => {
    const server = {
      close: vi.fn(async () => undefined),
      listen: vi.fn(async () => {
        throw addressInUse();
      }),
    };

    await expect(
      coordinateSingleInstance({
        fetchImplementation: vi.fn(async () => {
          throw new Error(
            "connect failed for C:\\private\\machine\\details",
          );
        }),
        host: "127.0.0.1",
        port: 3_210,
        server,
      }),
    ).rejects.toEqual(
      new StartupDiagnosticError("OPENRECALL_PORT_OCCUPIED"),
    );
  });

  it("does not reinterpret unrelated listen failures", async () => {
    const original = Object.assign(new Error("permission denied"), {
      code: "EACCES",
    });
    const server = {
      close: vi.fn(async () => undefined),
      listen: vi.fn(async () => {
        throw original;
      }),
    };

    await expect(
      coordinateSingleInstance({
        fetchImplementation: vi.fn(),
        host: "127.0.0.1",
        port: 3_210,
        server,
      }),
    ).rejects.toBe(original);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it("contains no filesystem enumeration, deletion, or broad path operation", async () => {
    const source = await readFile(
      new URL("./single-instance.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(
      /(?:node:fs|readdir|glob|unlink|rm|rmdir|remove|process\.cwd)/u,
    );
  });

  it("runs the single-instance preflight before any data directory or SQLite work", async () => {
    const source = await readFile(
      new URL("../index.ts", import.meta.url),
      "utf8",
    );

    expect(source.indexOf("await preflightSingleInstance(")).toBeGreaterThan(
      -1,
    );
    expect(source.indexOf("await preflightSingleInstance(")).toBeLessThan(
      source.indexOf("await mkdir(config.dataDirectory"),
    );
    expect(source.indexOf("await preflightSingleInstance(")).toBeLessThan(
      source.indexOf("await openDatabaseWithPreMigrationBackup("),
    );
  });

  it("propagates optimizer recovery failure after listen and before announcing ready", async () => {
    await withTempDatabase(async (databasePath) => {
      const database = openDatabase(databasePath);
      const recoveryError = new Error(
        "OPTIMIZER_RECOVERY_FAILED",
      );
      const server = await buildServer({
        config: {
          authority: TEST_AUTHORITY,
          dataDirectory: "unused-with-injected-database",
          host: "127.0.0.1",
          locale: "en",
          port: 3_210,
          publicOrigin: TEST_ORIGIN,
        },
        database,
        optimizerService: {
          cancelRun: vi.fn(() => false),
          dispose: vi.fn(),
          getEligibility: vi.fn(),
          getRun: vi.fn(() => null),
          recoverInterruptedRuns: vi.fn(() => {
            throw recoveryError;
          }),
          startRun: vi.fn(),
          whenIdle: vi.fn(async () => undefined),
        },
      });
      try {
        expect(() =>
          recoverInterruptedOptimizerRuns(server),
        ).toThrow(recoveryError);
      } finally {
        await server.close();
      }
    });

    const source = await readFile(
      new URL("../index.ts", import.meta.url),
      "utf8",
    );
    const listenIndex = source.indexOf(
      "await coordinateSingleInstance(",
    );
    const recoveryIndex = source.indexOf(
      "recoverInterruptedOptimizerRuns(server);",
    );
    const readyIndex = source.indexOf(
      "OPENRECALL_READY",
    );
    expect(listenIndex).toBeGreaterThan(-1);
    expect(recoveryIndex).toBeGreaterThan(listenIndex);
    expect(readyIndex).toBeGreaterThan(recoveryIndex);
  });
});

describe("graceful shutdown", () => {
  it.each(["SIGINT", "SIGTERM"] as const)(
    "closes exactly once when %s is received",
    async (signal) => {
      const signals = new EventEmitter();
      const server = {
        close: vi.fn(async () => undefined),
      };
      const controller = installGracefulShutdown({
        onError: vi.fn(),
        server,
        signals,
      });

      signals.emit(signal);
      signals.emit(signal);
      await controller.shutdown();

      expect(server.close).toHaveBeenCalledTimes(1);
      controller.dispose();
      expect(signals.listenerCount("SIGINT")).toBe(0);
      expect(signals.listenerCount("SIGTERM")).toBe(0);
    },
  );

  it("stops due wakeups and SSE, checkpoints passively, and closes SQLite", async () => {
    await withTempDatabase(async (databasePath) => {
      const database = openDatabase(databasePath);
      const dueStop = vi.spyOn(DueWakeService.prototype, "stop");
      const eventsClose = vi.spyOn(
        ReviewEvents.prototype,
        "closeAll",
      );
      const pragma = vi.spyOn(database, "pragma");
      const close = vi.spyOn(database, "close");
      const server = await buildServer({
        config: {
          authority: TEST_AUTHORITY,
          dataDirectory: "unused-with-injected-database",
          host: "127.0.0.1",
          locale: "en",
          port: 3_210,
          publicOrigin: TEST_ORIGIN,
        },
        database,
      });
      const signals = new EventEmitter();
      const controller = installGracefulShutdown({
        onError: vi.fn(),
        server,
        signals,
      });

      signals.emit("SIGTERM");
      await controller.shutdown();

      expect(dueStop).toHaveBeenCalled();
      expect(eventsClose).toHaveBeenCalled();
      expect(pragma).toHaveBeenCalledWith(
        "wal_checkpoint(PASSIVE)",
      );
      expect(close).toHaveBeenCalledTimes(1);
      expect(database.open).toBe(false);
    });
  });

});

describe("Windows launch boundary", () => {
  it("wires root start and delegates CMD to a portable, local-only PowerShell script", async () => {
    const root = new URL("../../../../", import.meta.url);
    const packageJson = JSON.parse(
      await readFile(new URL("package.json", root), "utf8"),
    ) as { readonly scripts: Record<string, string> };
    const powershell = await readFile(
      new URL("scripts/start-openrecall.ps1", root),
      "utf8",
    );
    const command = await readFile(
      new URL("scripts/start-openrecall.cmd", root),
      "utf8",
    );

    expect(packageJson.scripts["start"]).toBe(
      "pnpm --filter @openrecall/server start",
    );
    expect(powershell).toContain("$PSScriptRoot");
    expect(powershell).toMatch(/node.+--version/isu);
    expect(powershell).toMatch(/pnpm.+--version/isu);
    expect(powershell).toMatch(/pnpm.+start/isu);
    expect(command).toContain(
      '%~dp0start-openrecall.ps1"',
    );
    for (const source of [powershell, command]) {
      expect(source).not.toMatch(
        /(?:Invoke-WebRequest|curl|wget|Start-Process.+RunAs|choco|winget|npm install|pnpm install)/isu,
      );
    }
  });

  it("uses IPC only for Windows smoke shutdown and signals on Unix-like systems", async () => {
    const root = new URL("../../../../", import.meta.url);
    const smoke = await readFile(
      new URL("scripts/smoke-production.mjs", root),
      "utf8",
    );

    expect(smoke).toContain("return spawn(process.execPath");
    expect(smoke).toMatch(
      /if \(process\.platform === "win32"\)[\s\S]+return fork\(/u,
    );
    expect(smoke).toContain(
      'stdio: ["ignore", "pipe", "pipe"]',
    );
  });

  it("documents the complete Windows lifecycle in Arabic and English", async () => {
    const root = new URL("../../../../", import.meta.url);
    const [arabic, english] = await Promise.all([
      readFile(
        new URL("docs/getting-started/windows-ar.md", root),
        "utf8",
      ),
      readFile(
        new URL("docs/getting-started/windows-en.md", root),
        "utf8",
      ),
    ]);

    for (const guide of [arabic, english]) {
      expect(guide).toContain("Node.js 24");
      expect(guide).toContain("pnpm 11");
      expect(guide).toContain("pnpm install --frozen-lockfile");
      expect(guide).toContain("pnpm build");
      expect(guide).toContain("pnpm start");
      expect(guide).toContain("http://127.0.0.1:3210");
      expect(guide).toContain("start-openrecall.cmd");
      expect(guide).toContain("OPENRECALL_PORT_OCCUPIED");
      expect(guide).toMatch(/OpenRecall-nodejs[\\/]Data/u);
      expect(guide).toMatch(/backups/u);
      expect(guide).toMatch(/Chrome/u);
      expect(guide).toMatch(/PWA/u);
      expect(guide).toMatch(/Ctrl\+C/u);
    }
  });
});
