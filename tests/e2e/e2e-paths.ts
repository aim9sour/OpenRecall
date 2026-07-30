import { resolve } from "node:path";

export function e2eClockPath(apiPort: number): string {
  return resolve("tests/e2e", `.openrecall-clock-${apiPort}`);
}
