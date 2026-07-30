import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

async function waitForServiceWorkerControl(
  page: import("@playwright/test").Page,
): Promise<void> {
  const controlled = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
  if (!controlled) await page.reload();
  await expect
    .poll(() =>
      page.evaluate(
        () => navigator.serviceWorker.controller !== null,
      ),
    )
    .toBe(true);
}

test("cached shell reports a stopped server without exposing cached study data", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Learning sections" }),
  ).toBeVisible();
  await waitForServiceWorkerControl(page);

  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "OpenRecall server is stopped",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Learning sections" }),
  ).toHaveCount(0);
  await expect(page.getByText("http://127.0.0.1:3210")).toBeVisible();

  await context.setOffline(false);
});

test("a waiting service worker prompts without reloading the active page", async ({
  page,
}) => {
  const serviceWorkerPath = resolve("apps/web/dist/sw.js");
  const originalServiceWorker = await readFile(
    serviceWorkerPath,
    "utf8",
  );

  try {
    await page.goto("/");
    await waitForServiceWorkerControl(page);
    const documentToken = await page.evaluate(() => {
      const token = crypto.randomUUID();
      document.body.dataset["pwaDocumentToken"] = token;
      return token;
    });

    await writeFile(
      serviceWorkerPath,
      `${originalServiceWorker}\n// openrecall-e2e-update-${Date.now()}\n`,
      "utf8",
    );
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
    });

    await expect(
      page.getByText("An OpenRecall update is ready.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.locator("body")).toHaveAttribute(
      "data-pwa-document-token",
      documentToken,
    );
    await page.getByRole("button", { name: "Later" }).click();
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.locator("body")).toHaveAttribute(
      "data-pwa-document-token",
      documentToken,
    );
  } finally {
    await writeFile(serviceWorkerPath, originalServiceWorker, "utf8");
  }
});
