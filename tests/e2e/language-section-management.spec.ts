import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

async function restoreArabicPreference(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(async () => {
    const bootstrapResponse = await fetch("/api/v1/bootstrap", {
      headers: { accept: "application/json" },
    });
    if (!bootstrapResponse.ok) throw new Error("E2E_BOOTSTRAP_FAILED");
    const bootstrap = (await bootstrapResponse.json()) as {
      csrfToken: string;
      locale: string;
      localeUpdatedAtMs: number;
    };
    if (bootstrap.locale === "ar") return;
    const response = await fetch("/api/v1/application-settings/locale", {
      method: "PUT",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-openrecall-csrf": bootstrap.csrfToken,
      },
      body: JSON.stringify({
        locale: "ar",
        expectedUpdatedAtMs: bootstrap.localeUpdatedAtMs,
      }),
    });
    if (!response.ok) throw new Error("E2E_LOCALE_RESTORE_FAILED");
  });
}

async function createSection(page: Page, name: string): Promise<string> {
  await page.goto("/");
  await page.getByLabel("اسم القسم").fill(name);
  await page.getByRole("button", { name: "إنشاء قسم" }).click();
  await page.getByRole("link", { name }).click();
  await expect(page).toHaveURL(/\/sections\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { level: 1, name, exact: true }),
  ).toBeFocused();
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

async function importOneCard(page: Page): Promise<void> {
  await page.getByRole("link", { name: "إضافة بطاقات من JSON" }).click();
  await page.getByLabel("ملف البطاقات").setInputFiles({
    name: "section-deletion-review.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        front: "ما فائدة المراجعة المتباعدة؟",
        back: "توزيع المراجعات عبر الزمن.",
        notes: "بطاقة اختبار حذف القسم.",
      }),
    ),
  });
  await page.getByRole("button", { name: "معاينة الاستيراد" }).click();
  await page.getByRole("button", { name: "استيراد البطاقات" }).click();
}

test.afterEach(async ({ page }) => {
  await restoreArabicPreference(page);
});

test("switches language immediately and persists the SQLite preference", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("combobox", { name: "اللغة" }).selectOption("en");
  await page.getByRole("button", { name: "حفظ اللغة" }).click();

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(
    page.getByRole("status").filter({ hasText: "Language saved." }),
  ).toBeFocused();
  await expect(page.getByRole("link", { name: "Home", exact: true })).toBeVisible();

  await page.evaluate(() => localStorage.removeItem("openrecall.locale"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  await page.getByRole("combobox", { name: "Language" }).selectOption("ar");
  await page.getByRole("button", { name: "Save language" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(
    page.getByRole("status").filter({ hasText: "تم حفظ اللغة." }),
  ).toBeFocused();
  await expect(page.getByRole("link", { name: "الرئيسية", exact: true })).toBeVisible();

  await page.evaluate(() => localStorage.removeItem("openrecall.locale"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("heading", { level: 1, name: "الإعدادات" })).toBeVisible();
});

test("renames and permanently deletes sections, including an open review", async ({
  page,
  context,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const originalName = `قسم إدارة ${suffix}`;
  const renamedName = `قسم مُعاد ${suffix}`;
  await createSection(page, originalName);

  await page.getByRole("textbox", { name: "اسم القسم" }).fill(renamedName);
  await page.getByRole("button", { name: "حفظ الاسم الجديد" }).click();
  await expect(page.getByRole("heading", { level: 1, name: renamedName })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "تم حفظ اسم القسم." }),
  ).toBeFocused();

  await page.getByRole("link", { name: "العودة إلى الأقسام التعليمية" }).click();
  await expect(page.getByRole("link", { name: renamedName })).toBeVisible();
  await page.getByRole("link", { name: renamedName }).click();

  const confirmation = page.getByRole("checkbox", {
    name: "أفهم أن هذا القسم سيُحذف نهائيًا",
  });
  const deleteButton = page.getByRole("button", { name: "حذف القسم نهائيًا" });
  await expect(deleteButton).toBeDisabled();
  await confirmation.check();
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();

  await expect(page.getByRole("heading", { level: 1, name: "الأقسام التعليمية" })).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("تم حذف القسم نهائيًا.");
  await expect(page.getByRole("link", { name: renamedName })).toHaveCount(0);

  const reviewSectionName = `قسم جلسة ${suffix}`;
  const reviewSectionId = await createSection(page, reviewSectionName);
  await importOneCard(page);
  await page.getByRole("button", { name: "بدء المراجعة" }).click();
  await expect(page.locator('[data-review-content="question"]')).toBeFocused();
  await page.getByRole("button", { name: "إنهاء المراجعة" }).click();
  await page.getByRole("button", { name: "المتابعة لاحقًا" }).click();
  await expect(page.getByRole("heading", { name: "المراجعة متوقفة مؤقتًا" })).toBeFocused();
  const reviewUrl = page.url();

  const secondPage = await context.newPage();
  const nextRequests: string[] = [];
  secondPage.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/next")) {
      nextRequests.push(request.url());
    }
  });
  await secondPage.goto(reviewUrl);
  await expect(secondPage.getByRole("heading", { name: "المراجعة متوقفة مؤقتًا" })).toBeFocused();

  await page.goto(`/sections/${reviewSectionId}`);
  await page.getByRole("checkbox", {
    name: "أفهم أن هذا القسم سيُحذف نهائيًا",
  }).check();
  await page.getByRole("button", { name: "حذف القسم نهائيًا" }).click();

  const deletedHeading = secondPage.getByRole("heading", {
    level: 1,
    name: "تم حذف هذا القسم",
  });
  await expect(deletedHeading).toBeFocused();
  await expect(secondPage.getByRole("link", { name: "الذهاب إلى الرئيسية" })).toBeVisible();
  await secondPage.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
  });
  await secondPage.waitForTimeout(250);
  expect(nextRequests).toEqual([]);
  await secondPage.close();
});
