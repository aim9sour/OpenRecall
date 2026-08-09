import { copyFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { SettingsView } from "@openrecall/contracts";
import {
  openDatabase,
  SCHEMA_VERSION,
} from "../../packages/database/src/index.js";
import { e2eClockPath } from "./e2e-paths.js";
import { resolveE2ePorts } from "./ports.js";

const clockPath = e2eClockPath(resolveE2ePorts().api[4]);

test.describe.serial("optimizer and SQLite durability", () => {
  test("cancels and completes a real optimizer worker, applies a preview, and rolls back", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/settings");

    const rawReviewEvents = Number(
      await page
        .getByText("أحداث المراجعة الخام")
        .locator("..")
        .locator("dd")
        .textContent(),
    );
    const eligibleExamples = Number(
      await page
        .getByText("أمثلة التدريب المؤهلة")
        .locator("..")
        .locator("dd")
        .textContent(),
    );
    expect(rawReviewEvents).toBeGreaterThanOrEqual(600);
    expect(eligibleExamples).toBeGreaterThanOrEqual(480);
    const before = await page.evaluate(async () => {
      const response = await fetch("/api/v1/settings");
      return (await response.json()) as SettingsView;
    });
    expect(before.effective.parameterSource.kind).toBe("global");
    const initialProfileId = before.effective.parameterSource.profileId;
    expect(initialProfileId).toBeTruthy();

    await page
      .getByRole("button", { name: "تدريب المعاملات" })
      .click();
    await expect(
      page.getByRole("button", { name: "إلغاء التدريب" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "إلغاء التدريب" })
      .click();
    await expect(
      page.getByText("الحالة: أُلغي"),
    ).toBeVisible({ timeout: 30_000 });
    const afterCancellation = await page.evaluate(async () => {
      const response = await fetch("/api/v1/settings");
      return (await response.json()) as SettingsView;
    });
    expect(afterCancellation.effective.parameterSource.profileId).toBe(
      initialProfileId,
    );

    await page
      .getByRole("button", { name: "تدريب المعاملات" })
      .click();
    const previewButton = page.getByRole("button", {
      name: "معاينة تغييرات المواعيد",
    });
    await expect(previewButton).toBeVisible({ timeout: 150_000 });
    await expect(page.getByRole("progressbar")).toHaveAttribute(
      "value",
      "100",
    );
    await previewButton.click();

    const preview = page.getByRole("region", {
      name: "معاينة تغيير المواعيد",
    });
    await expect(preview).toBeVisible();
    const firstCandidateProfileId = (
      await preview
        .getByText("مصدر المعاملات المقترح")
        .locator("..")
        .locator("dd")
        .textContent()
    )?.trim();
    expect(firstCandidateProfileId).toBeTruthy();
    const affected = Number(
      (
        await preview
          .getByText("البطاقات المتأثرة")
          .locator("..")
          .locator("dd")
          .textContent()
      )?.trim(),
    );
    const shiftCounts = await Promise.all(
      ["أبكر", "أبعد", "بلا تغيير"].map(async (label) =>
        Number(
          (
            await preview
              .getByText(label, { exact: true })
              .locator("..")
              .locator("dd")
              .textContent()
          )?.trim(),
        ),
      ),
    );
    expect(affected).toBeGreaterThanOrEqual(120);
    expect(
      shiftCounts.reduce((total, count) => total + count, 0),
    ).toBe(affected);
    await preview
      .getByRole("checkbox", {
        name: /أفهم أن المواعيد ستتغير/,
      })
      .check();
    await preview
      .getByRole("button", {
        name: "تطبيق المعاملات المرشحة",
      })
      .click();
    await expect(
      preview.getByRole("status"),
    ).toContainText("طُبقت المعاملات");

    const applied = await page.evaluate(async () => {
      const response = await fetch("/api/v1/settings");
      return (await response.json()) as SettingsView;
    });
    expect(applied.effective.parameterSource.kind).toBe("global");
    expect(applied.effective.parameterSource.profileId).not.toBe(
      initialProfileId,
    );

    await page.reload();
    await page
      .getByRole("button", { name: "تدريب المعاملات" })
      .click();
    const secondPreviewButton = page.getByRole("button", {
      name: "معاينة تغييرات المواعيد",
    });
    await expect(secondPreviewButton).toBeVisible({ timeout: 150_000 });
    await secondPreviewButton.click();
    const secondPreview = page.getByRole("region", {
      name: "معاينة تغيير المواعيد",
    });
    await secondPreview
      .getByRole("checkbox", {
        name: /أفهم أن المواعيد ستتغير/,
      })
      .check();
    await secondPreview
      .getByRole("button", {
        name: "تطبيق المعاملات المرشحة",
      })
      .click();
    await expect(secondPreview.getByRole("status")).toContainText(
      "طُبقت المعاملات",
    );

    await page.reload();
    const previousProfile = page
      .getByRole("article")
      .filter({ hasText: firstCandidateProfileId! });
    await previousProfile
      .getByRole("button", { name: "معاينة مواعيد الرجوع" })
      .click();
    const rollback = previousProfile.getByRole("region", {
      name: "معاينة تغيير المواعيد",
    });
    await rollback
      .getByRole("checkbox", {
        name: /أفهم أن المواعيد ستتغير/,
      })
      .check();
    await rollback
      .getByRole("button", { name: "استعادة هذه المعاملات" })
      .click();
    await expect(rollback.getByRole("status")).toContainText(
      "استُعيدت المعاملات",
    );
    const rolledBack = await page.evaluate(async () => {
      const response = await fetch("/api/v1/settings");
      return (await response.json()) as SettingsView;
    });
    expect(rolledBack.effective.parameterSource.profileId).toBe(
      firstCandidateProfileId,
    );
  });

  test("downloads, rejects unsafe candidates, restores through the file input, and rearms the due timer", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const attempt = `${testInfo.repeatEachIndex}-${testInfo.retry}`;
    const sectionName = `اختبار مؤقت الاستعادة ${attempt}`;
    const question = `متى يعود مؤقت المراجعة بعد الاستعادة؟ ${attempt}`;
    const mutationName = `بيانات يجب حذفها بعد الاستعادة ${attempt}`;

    await page.goto("/");
    await page.getByLabel("اسم القسم").fill(sectionName);
    await page.getByRole("button", { name: "إنشاء قسم" }).click();
    await page.getByRole("link", { name: sectionName }).click();
    await page
      .getByRole("link", { name: "إضافة بطاقات من JSON" })
      .click();
    await page.getByLabel("ملف البطاقات").setInputFiles({
      name: "durability-card.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          front: question,
          back: "بإعادة تسليح خدمة المواعيد من قاعدة SQLite الجديدة.",
        }),
      ),
    });
    await page
      .getByRole("button", { name: "معاينة الاستيراد" })
      .click();
    await page
      .getByRole("button", { name: "استيراد البطاقات" })
      .click();
    const sectionUrl = page.url();
    await page.getByRole("button", { name: "بدء المراجعة" }).click();
    await expect(page).toHaveURL(/\/review\/[^/]+$/);
    const questionContent = page.locator(
      '[data-review-content="question"]',
    );
    await expect(questionContent).toBeVisible();
    if ((await questionContent.textContent()) !== question) {
      await page
        .getByRole("button", { name: "إنهاء المراجعة" })
        .click();
      await page
        .getByRole("dialog", {
          name: "هل تريد إنهاء جلسة المراجعة؟",
        })
        .getByRole("button", { name: "إنهاء الجلسة" })
        .click();
      await page.goto(sectionUrl);
      await page
        .getByRole("button", { name: "بدء المراجعة" })
        .click();
      await expect(page).toHaveURL(/\/review\/[^/]+$/);
    }
    await expect(questionContent).toHaveText(question);
    await expect(questionContent).toBeFocused();
    const reviewUrl = page.url();
    await page.getByRole("button", { name: "عرض الإجابة" }).click();
    await page.getByRole("button", { name: /مرة أخرى/ }).click();
    const dueIso = await page.locator("time").getAttribute("datetime");
    expect(dueIso).not.toBeNull();

    await page.getByRole("link", { name: "الإعدادات" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", {
        name: "تنزيل نسخة SQLite احتياطية",
      })
      .click();
    const download = await downloadPromise;
    const downloadedPath = await download.path();
    expect(downloadedPath).not.toBeNull();
    const snapshotPath = testInfo.outputPath("valid.sqlite3");
    const futurePath = testInfo.outputPath("future.sqlite3");
    await copyFile(downloadedPath!, snapshotPath);
    await copyFile(downloadedPath!, futurePath);
    const future = openDatabase(futurePath);
    future.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    future.close();

    await page.getByRole("link", { name: "الرئيسية" }).click();
    await page.getByLabel("اسم القسم").fill(mutationName);
    await page.getByRole("button", { name: "إنشاء قسم" }).click();
    await expect(
      page.getByRole("link", { name: mutationName }),
    ).toBeVisible();
    await page.getByRole("link", { name: "الإعدادات" }).click();

    const fileInput = page.getByLabel(
      "ملف نسخة SQLite الاحتياطية",
    );
    const confirmation = page.getByRole("checkbox", {
      name: /أفهم أن قاعدة البيانات الحالية ستُستبدل/,
    });
    await fileInput.setInputFiles({
      name: "corrupt.sqlite3",
      mimeType: "application/vnd.sqlite3",
      buffer: Buffer.from("not a SQLite database"),
    });
    await confirmation.check();
    await page
      .getByRole("button", { name: "استعادة هذه النسخة" })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "لم تُستعد قاعدة البيانات",
      }),
    ).toBeFocused();

    await fileInput.setInputFiles(futurePath);
    await confirmation.check();
    await page
      .getByRole("button", { name: "استعادة هذه النسخة" })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "لم تُستعد قاعدة البيانات",
      }),
    ).toBeFocused();
    await page.getByRole("link", { name: "الرئيسية" }).click();
    await expect(
      page.getByRole("link", { name: mutationName }),
    ).toBeVisible();

    await page.getByRole("link", { name: "الإعدادات" }).click();
    await fileInput.setInputFiles(snapshotPath);
    await confirmation.check();
    await page
      .getByRole("button", { name: "استعادة هذه النسخة" })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "تمت استعادة قاعدة البيانات",
      }),
    ).toBeFocused({ timeout: 15_000 });

    await page.getByRole("link", { name: "الرئيسية" }).click();
    await expect(
      page.getByRole("link", { name: mutationName }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: sectionName }),
    ).toBeVisible();

    await writeFile(clockPath, String(Date.parse(dueIso!)), "utf8");
    await page.goto(reviewUrl);
    await expect(questionContent).toHaveText(question, { timeout: 15_000 });
    await expect(questionContent).toBeFocused({ timeout: 15_000 });
    await page
      .getByRole("button", { name: "إنهاء المراجعة" })
      .click();
    await expect(
      page.getByRole("heading", { name: "اكتملت المراجعة" }),
    ).toBeFocused();
    await expect(page).toHaveURL(/\/review\/[^/]+$/);
  });
});
