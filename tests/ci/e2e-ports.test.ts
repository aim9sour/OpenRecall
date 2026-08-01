import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveE2ePorts } from "../e2e/ports.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("isolated E2E port allocation", () => {
  it("preserves the documented default port set", () => {
    expect(resolveE2ePorts(undefined)).toEqual({
      api: [3210, 3211, 3212, 3213, 3214],
      web: [5173, 5174, 5175, 5176, 5177],
    });
  });

  it("moves every API and web port by one validated offset", () => {
    expect(resolveE2ePorts("1000")).toEqual({
      api: [4210, 4211, 4212, 4213, 4214],
      web: [6173, 6174, 6175, 6176, 6177],
    });
  });

  it.each(["-1", "1.5", "word", "60359", " 1"])(
    "rejects unsafe offset %s",
    (offset) => {
      expect(() => resolveE2ePorts(offset)).toThrow(
        "OPENRECALL_E2E_PORT_OFFSET_INVALID",
      );
    },
  );

  it("keeps the ordinary Vite development server fixed and isolates Arabic E2E", async () => {
    const [developmentConfig, arabicE2eConfig, playwrightConfig] =
      await Promise.all([
        readFile(resolve(repositoryRoot, "apps/web/vite.config.ts"), "utf8"),
        readFile(
          resolve(repositoryRoot, "apps/web/vite.e2e-ar.config.ts"),
          "utf8",
        ),
        readFile(resolve(repositoryRoot, "playwright.config.ts"), "utf8"),
      ]);

    expect(developmentConfig).toContain("port: 5_173");
    expect(developmentConfig).toContain(
      'target: "http://127.0.0.1:3210"',
    );
    expect(developmentConfig).not.toContain("resolveE2ePorts");
    expect(arabicE2eConfig).toContain("e2ePorts.web[0]");
    expect(arabicE2eConfig).toContain("e2ePorts.api[0]");
    expect(playwrightConfig).toContain("vite.e2e-ar.config.ts");
  });
});
