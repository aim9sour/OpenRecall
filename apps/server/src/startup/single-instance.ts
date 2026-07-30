import { createServer } from "node:net";
import { API_VERSION, APP_NAME } from "@openrecall/contracts";

const PROBE_TIMEOUT_MS = 1_000;
const PROBE_RETRY_INTERVAL_MS = 50;

interface StartableServer {
  close(): Promise<unknown>;
  listen(options: {
    readonly host: string;
    readonly port: number;
  }): Promise<string>;
}

interface ClosableServer {
  close(): Promise<unknown>;
}

interface SignalSource {
  on(
    event: "SIGINT" | "SIGTERM",
    listener: () => void,
  ): unknown;
  off(
    event: "SIGINT" | "SIGTERM",
    listener: () => void,
  ): unknown;
}

export class StartupDiagnosticError extends Error {
  readonly code: "OPENRECALL_PORT_OCCUPIED";

  constructor(code: "OPENRECALL_PORT_OCCUPIED") {
    super(code);
    this.name = "StartupDiagnosticError";
    this.code = code;
  }
}

function hasErrorCode(
  error: unknown,
  code: string,
): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function isCompatibleHealth(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "app" in value &&
    value.app === APP_NAME &&
    "apiVersion" in value &&
    value.apiVersion === API_VERSION
  );
}

type HealthProbeResult =
  | "compatible"
  | "incompatible"
  | "unreachable";

async function inspectExistingInstance(
  url: string,
  fetchImplementation: typeof fetch,
): Promise<HealthProbeResult> {
  try {
    const response = await fetchImplementation(
      `${url}/api/v1/health`,
      {
        cache: "no-store",
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      },
    );
    if (!response.ok) return "incompatible";
    return isCompatibleHealth(await response.json())
      ? "compatible"
      : "incompatible";
  } catch {
    return "unreachable";
  }
}

async function probeExistingInstance(
  url: string,
  fetchImplementation: typeof fetch,
): Promise<boolean> {
  return (
    (await inspectExistingInstance(url, fetchImplementation)) ===
    "compatible"
  );
}

export type PortProbe = (options: {
  readonly host: "127.0.0.1";
  readonly port: number;
}) => Promise<
  | {
      readonly kind: "available";
      readonly release: () => Promise<void>;
    }
  | { readonly kind: "occupied" }
>;

const probeConfiguredPort: PortProbe = async ({
  host,
  port,
}) =>
  new Promise((resolve, reject) => {
    const reservation = createServer((socket) => {
      socket.destroy();
    });
    let releasePromise: Promise<void> | undefined;
    const release = (): Promise<void> => {
      releasePromise ??= new Promise((resolveRelease, rejectRelease) => {
        reservation.close((error) => {
          if (error !== undefined) {
            rejectRelease(error);
            return;
          }
          resolveRelease();
        });
      });
      return releasePromise;
    };
    reservation.unref();
    reservation.once("error", (error) => {
      if (hasErrorCode(error, "EADDRINUSE")) {
        resolve({ kind: "occupied" });
        return;
      }
      reject(error);
    });
    reservation.listen(
      { exclusive: true, host, port },
      () => {
        resolve({ kind: "available", release });
      },
    );
  });

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export async function preflightSingleInstance({
  fetchImplementation = fetch,
  host,
  port,
  probePort = probeConfiguredPort,
}: {
  readonly fetchImplementation?: typeof fetch;
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly probePort?: PortProbe;
}): Promise<
  | {
      readonly kind: "available";
      readonly release: () => Promise<void>;
      readonly url: string;
    }
  | { readonly kind: "already-running"; readonly url: string }
> {
  const url = `http://${host}:${port}`;
  const initialHealth = await inspectExistingInstance(
    url,
    fetchImplementation,
  );
  if (initialHealth === "compatible") {
    return { kind: "already-running", url };
  }

  const portState = await probePort({ host, port });
  if (portState.kind === "available") {
    return {
      kind: "available",
      release: portState.release,
      url,
    };
  }
  if (initialHealth === "incompatible") {
    throw new StartupDiagnosticError("OPENRECALL_PORT_OCCUPIED");
  }

  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  do {
    if (
      (await inspectExistingInstance(url, fetchImplementation)) ===
      "compatible"
    ) {
      return { kind: "already-running", url };
    }
    await wait(PROBE_RETRY_INTERVAL_MS);
  } while (Date.now() < deadline);

  throw new StartupDiagnosticError("OPENRECALL_PORT_OCCUPIED");
}

export async function coordinateSingleInstance({
  fetchImplementation = fetch,
  host,
  port,
  server,
}: {
  readonly fetchImplementation?: typeof fetch;
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly server: StartableServer;
}): Promise<
  | { readonly kind: "started"; readonly url: string }
  | { readonly kind: "already-running"; readonly url: string }
> {
  const url = `http://${host}:${port}`;
  try {
    await server.listen({ host, port });
    return { kind: "started", url };
  } catch (error) {
    await server.close();
    if (!hasErrorCode(error, "EADDRINUSE")) throw error;

    if (await probeExistingInstance(url, fetchImplementation)) {
      return { kind: "already-running", url };
    }
    throw new StartupDiagnosticError("OPENRECALL_PORT_OCCUPIED");
  }
}

export function installGracefulShutdown({
  onError,
  server,
  signals,
}: {
  readonly onError: (error: unknown) => void;
  readonly server: ClosableServer;
  readonly signals: SignalSource;
}): {
  readonly dispose: () => void;
  readonly shutdown: () => Promise<void>;
} {
  let shutdownPromise: Promise<void> | undefined;
  let disposed = false;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    signals.off("SIGINT", handleSignal);
    signals.off("SIGTERM", handleSignal);
  };
  const shutdown = (): Promise<void> => {
    shutdownPromise ??= Promise.resolve()
      .then(() => server.close())
      .then(() => undefined)
      .finally(dispose);
    return shutdownPromise;
  };
  const handleSignal = (): void => {
    void shutdown().catch(onError);
  };

  signals.on("SIGINT", handleSignal);
  signals.on("SIGTERM", handleSignal);
  return { dispose, shutdown };
}
