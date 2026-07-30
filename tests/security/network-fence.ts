import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";

const ALLOWED_HOST = "127.0.0.1";
const ALLOWED_PORT = 3_210;
const FENCE_KEY = Symbol.for("openrecall.test.network-fence");

export interface NetworkFenceState {
  allowedSocketConnections: number;
}

function destinationFromArguments(
  args: readonly unknown[],
): { readonly host: string; readonly port: number } {
  const first = args[0];
  if (typeof first === "object" && first !== null) {
    const options = first as {
      readonly host?: string;
      readonly hostname?: string;
      readonly port?: number | string;
    };
    return {
      host: options.host ?? options.hostname ?? "",
      port: Number(options.port),
    };
  }
  return {
    host: typeof args[1] === "string" ? args[1] : "",
    port: Number(first),
  };
}

function installNetworkFence(): NetworkFenceState {
  const globalWithFence = globalThis as typeof globalThis & {
    [FENCE_KEY]?: NetworkFenceState;
  };
  const existing = globalWithFence[FENCE_KEY];
  if (existing !== undefined) return existing;

  const state: NetworkFenceState = {
    allowedSocketConnections: 0,
  };
  globalWithFence[FENCE_KEY] = state;
  const originalDnsLookup = dns.lookup.bind(dns);
  const originalNetConnect = net.connect.bind(net);
  const originalNetCreateConnection =
    net.createConnection.bind(net);
  const originalTlsConnect = tls.connect.bind(tls);

  const assertAllowed = (args: readonly unknown[]): void => {
    const destination = destinationFromArguments(args);
    if (
      destination.host !== ALLOWED_HOST ||
      destination.port !== ALLOWED_PORT
    ) {
      throw new Error("OUTBOUND_DESTINATION_FORBIDDEN");
    }
    state.allowedSocketConnections += 1;
  };

  dns.lookup = ((hostname: string, ...args: unknown[]) => {
    if (hostname !== ALLOWED_HOST) {
      throw new Error("OUTBOUND_DNS_FORBIDDEN");
    }
    return Reflect.apply(originalDnsLookup, dns, [
      hostname,
      ...args,
    ]);
  }) as typeof dns.lookup;
  net.connect = ((...args: unknown[]) => {
    assertAllowed(args);
    return Reflect.apply(originalNetConnect, net, args);
  }) as typeof net.connect;
  net.createConnection = ((...args: unknown[]) => {
    assertAllowed(args);
    return Reflect.apply(
      originalNetCreateConnection,
      net,
      args,
    );
  }) as typeof net.createConnection;
  tls.connect = ((...args: unknown[]) => {
    assertAllowed(args);
    return Reflect.apply(originalTlsConnect, tls, args);
  }) as typeof tls.connect;
  syncBuiltinESMExports();
  return state;
}

export const networkFenceState = installNetworkFence();
