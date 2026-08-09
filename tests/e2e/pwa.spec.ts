import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

const legacyServiceWorker = `
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("openrecall-v1.0.0-e2e").then((cache) =>
      cache.put("/legacy-sentinel", new Response("legacy")),
    ).then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
`;

test("an existing v1.0.0 worker deletes caches and unregisters once", async ({
  page,
}) => {
  const serviceWorkerPath = resolve("apps/web/dist/sw.js");
  const compatibilityServiceWorker = await readFile(
    serviceWorkerPath,
    "utf8",
  );

  try {
    await page.goto("/");
    await writeFile(serviceWorkerPath, legacyServiceWorker, "utf8");
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() => page.evaluate(async () => caches.keys()))
      .toContain("openrecall-v1.0.0-e2e");

    await writeFile(
      serviceWorkerPath,
      compatibilityServiceWorker,
      "utf8",
    );
    await page.evaluate(async () => {
      const registration =
        await navigator.serviceWorker.getRegistration("/");
      if (registration === undefined) {
        throw new Error("LEGACY_SERVICE_WORKER_MISSING");
      }
      await registration.update();
    });

    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await navigator.serviceWorker.getRegistration("/")) ===
          undefined,
        ),
      )
      .toBe(true);
    await expect
      .poll(() => page.evaluate(async () => (await caches.keys()).length))
      .toBe(0);

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Learning sections" }),
    ).toBeVisible();
    expect(
      await page.evaluate(async () =>
        (await navigator.serviceWorker.getRegistration("/")) ===
        undefined,
      ),
    ).toBe(true);
  } finally {
    await writeFile(
      serviceWorkerPath,
      compatibilityServiceWorker,
      "utf8",
    );
  }
});
