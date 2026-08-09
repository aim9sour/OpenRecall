import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
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
  it("emits the manifest and a self-destroying compatibility worker", async () => {
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
    expect(serviceWorker).toMatch(/registration\.unregister/);
    expect(serviceWorker).toMatch(/caches\.keys/);
    expect(serviceWorker).toMatch(/caches\.delete/);
    expect(serviceWorker).not.toMatch(
      /precacheAndRoute|NetworkOnly|SKIP_WAITING/,
    );
  });

  it("does not register a new worker from the application", async () => {
    const scripts = (
      await Promise.all(
        (await readdir(outputDirectory, { recursive: true }))
          .filter((name) => name.endsWith(".js"))
          .map((name) =>
            readFile(resolve(outputDirectory, name), "utf8"),
          ),
      )
    ).join("\n");
    expect(scripts).not.toMatch(
      /navigator\.serviceWorker\.register|virtual:pwa-register/,
    );

    for (const source of [
      "src/main.tsx",
      "src/router.tsx",
      "src/app/AppShell.tsx",
    ]) {
      expect(await readFile(resolve(webRoot, source), "utf8")).not.toMatch(
        /from ["'][^"']*\/pwa\//,
      );
    }
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

    const regular = await readFile(
      resolve(outputDirectory, "icon-512.png"),
    );
    const maskable = await readFile(
      resolve(outputDirectory, "icon-maskable-512.png"),
    );
    expect(maskable.equals(regular)).toBe(false);
    const { data } = await sharp(maskable)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(255);
  });
});
