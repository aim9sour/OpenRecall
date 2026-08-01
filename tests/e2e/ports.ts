const API_BASE_PORT = 3_210;
const WEB_BASE_PORT = 5_173;
const PORT_COUNT = 5;
const MAXIMUM_PORT = 65_535;
const MAXIMUM_BASE_PORT = WEB_BASE_PORT + PORT_COUNT - 1;
const MAXIMUM_OFFSET = MAXIMUM_PORT - MAXIMUM_BASE_PORT;

export interface E2ePorts {
  readonly api: readonly [number, number, number, number, number];
  readonly web: readonly [number, number, number, number, number];
}

function portRange(base: number, offset: number) {
  return [
    base + offset,
    base + offset + 1,
    base + offset + 2,
    base + offset + 3,
    base + offset + 4,
  ] as const;
}

export function resolveE2ePorts(
  source = process.env["OPENRECALL_E2E_PORT_OFFSET"],
): E2ePorts {
  const offset = source === undefined ? 0 : Number(source);
  if (
    source !== undefined &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(source) ||
      !Number.isSafeInteger(offset) ||
      offset > MAXIMUM_OFFSET)
  ) {
    throw new Error("OPENRECALL_E2E_PORT_OFFSET_INVALID");
  }

  return {
    api: portRange(API_BASE_PORT, offset),
    web: portRange(WEB_BASE_PORT, offset),
  };
}

export function loopbackOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}
