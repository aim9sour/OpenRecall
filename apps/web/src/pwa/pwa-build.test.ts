import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

const webRoot = resolve("apps/web");
let outputDirectory = "";

function pngDimensions(buffer: Buffer): {
  readonly width: number;
  readonly height: number;
} {
  expect(buffer.subarray(1, 4).toString("ascii")).toBe("PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

beforeAll(async () => {
  outputDirectory = await mkdtemp(
    resolve(tmpdir(), "openrecall-pwa-build-"),
  );
  await build({
    root: webRoot,
    configFile: resolve(webRoot, "vite.config.ts"),
    build: {
      emptyOutDir: true,
      outDir: outputDirectory,
    },
  });
}, 30_000);

afterAll(async () => {
  if (outputDirectory !== "") {
    await rm(outputDirectory, { force: true, recursive: true });
  }
});

describe("production PWA build", () => {
  it("pre-caches only the local shell and immutable assets", async () => {
    const manifest = JSON.parse(
      await readFile(
        resolve(outputDirectory, "manifest.webmanifest"),
        "utf8",
      ),
    ) as {
      name: string;
      short_name: string;
      display: string;
      start_url: string;
    };
    expect(manifest).toMatchObject({
      name: "OpenRecall",
      short_name: "OpenRecall",
      display: "standalone",
      start_url: "/",
    });

    const serviceWorker = await readFile(
      resolve(outputDirectory, "sw.js"),
      "utf8",
    );
    const precacheCall = serviceWorker.match(
      /precacheAndRoute\((\[[\s\S]*?\]),\s*\{\}\)/,
    )?.[1];
    expect(precacheCall).toBeDefined();
    expect(precacheCall).toMatch(/index\.html/);
    expect(precacheCall).toMatch(
      /assets\/index-[A-Za-z0-9_-]+\.js/,
    );
    expect(precacheCall).toMatch(
      /assets\/index-[A-Za-z0-9_-]+\.css/,
    );
    expect(precacheCall).not.toMatch(/["']\/api\//);
  });

  it("keeps API and SSE requests network-only and updates prompt-based", async () => {
    const scripts = (
      await Promise.all(
        (await readdir(outputDirectory))
          .filter((name) => name.endsWith(".js"))
          .map((name) =>
            readFile(resolve(outputDirectory, name), "utf8"),
          ),
      )
    ).join("\n");
    expect(scripts).toMatch(/NetworkOnly/);
    expect(scripts).toMatch(/api/);
    expect(scripts).toMatch(/SKIP_WAITING/);
    expect(scripts).not.toMatch(
      /addEventListener\(["']install["'][\s\S]{0,300}self\.skipWaiting/,
    );
  });

  it("emits deterministic install icons at their declared dimensions", async () => {
    for (const [filename, size] of [
      ["icon-192.png", 192],
      ["icon-512.png", 512],
      ["icon-maskable-512.png", 512],
    ] as const) {
      expect(
        pngDimensions(
          await readFile(resolve(outputDirectory, filename)),
        ),
      ).toEqual({ width: size, height: size });
    }
  });
});
