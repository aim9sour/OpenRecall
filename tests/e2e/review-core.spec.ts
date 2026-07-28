import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const clockPath = resolve("tests/e2e/.openrecall-clock");

test("review core continuously rotates variants, resumes, and finishes with a summary", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("اسم القسم").fill("اختبار المراجعة المستمرة");
  await page.getByRole("button", { name: "إنشاء قسم" }).click();
  await page
    .getByRole("link", { name: "اختبار المراجعة المستمرة" })
    .click();
  await page.getByRole("link", { name: "إضافة بطاقات من JSON" }).click();

  await page.getByLabel("ملف البطاقات").setInputFiles({
    name: "continuous-review.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        front: "ما المقصود بالاستدعاء النشط؟",
        back: "استرجاع الإجابة من الذاكرة.",
        notes: "لا تقرأ الإجابة أولًا.",
        variants: [
          {
            front: "كيف تختبر ذاكرتك دون إعادة القراءة؟",
            back: "باستدعاء الإجابة قبل كشفها.",
            notes: "صياغة بديلة للمفهوم نفسه.",
          },
        ],
      }),
    ),
  });
  await page.getByRole("button", { name: "معاينة الاستيراد" }).click();
  await page.getByRole("button", { name: "استيراد البطاقات" }).click();
  await page.getByRole("button", { name: "بدء المراجعة" }).click();

  const firstQuestion = page.locator("main h1");
  await expect(firstQuestion).toHaveText(
    /ما المقصود بالاستدعاء النشط|كيف تختبر ذاكرتك/,
  );
  await expect(firstQuestion).toBeFocused();
  const firstQuestionText = (await firstQuestion.textContent())?.trim();
  expect(firstQuestionText).toMatch(
    /ما المقصود بالاستدعاء النشط|كيف تختبر ذاكرتك/,
  );

  await page.getByRole("button", { name: "عرض الإجابة" }).click();
  await expect(page.locator("main h2")).toBeFocused();
  await page.getByRole("button", { name: /مرة أخرى/ }).click();

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "لا توجد بطاقات مستحقة الآن",
    }),
  ).toBeFocused();
  const dueTime = page.locator("time");
  await expect(dueTime).toBeVisible();
  const dueIso = await dueTime.getAttribute("datetime");
  expect(dueIso).not.toBeNull();

  await writeFile(clockPath, String(Date.parse(dueIso!)), "utf8");

  const expectedRepeatedQuestion =
    firstQuestionText === "ما المقصود بالاستدعاء النشط؟"
      ? "كيف تختبر ذاكرتك دون إعادة القراءة؟"
      : "ما المقصود بالاستدعاء النشط؟";
  await expect(firstQuestion).toHaveText(expectedRepeatedQuestion, {
    timeout: 10_000,
  });
  await expect(firstQuestion).toBeFocused({ timeout: 10_000 });
  const repeatedQuestionText = (await firstQuestion.textContent())?.trim();
  expect(repeatedQuestionText).not.toBe(firstQuestionText);

  await page.getByRole("button", { name: "عرض الإجابة" }).click();
  await page.getByRole("button", { name: /جيد/ }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "لا توجد بطاقات مستحقة الآن",
    }),
  ).toBeFocused();

  await page.getByRole("button", { name: "إنهاء المراجعة" }).click();
  const dialog = page.getByRole("dialog", {
    name: "هل تريد إنهاء جلسة المراجعة؟",
  });
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "المتابعة لاحقًا" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "المراجعة متوقفة مؤقتًا",
    }),
  ).toBeFocused();

  await page.reload();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "المراجعة متوقفة مؤقتًا",
    }),
  ).toBeFocused();
  await page.getByRole("button", { name: "استئناف المراجعة" }).click();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "لا توجد بطاقات مستحقة الآن",
    }),
  ).toBeFocused();

  await page.getByRole("button", { name: "إنهاء المراجعة" }).click();
  await page.getByRole("button", { name: "إنهاء الجلسة" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "اكتملت المراجعة" }),
  ).toBeFocused();
  await expect(page.getByText("أحداث المراجعة").locator("..")).toContainText(
    "2",
  );
  await expect(page.getByText("البطاقات الفريدة").locator("..")).toContainText(
    "1",
  );
  await expect(page.getByText("التكرارات").locator("..")).toContainText("1");
  const distribution = page.getByRole("table", {
    name: "توزيع التقييمات",
  });
  await expect(distribution.getByRole("row", { name: /مرة أخرى/ })).toContainText(
    "1",
  );
  await expect(distribution.getByRole("row", { name: /جيد/ })).toContainText(
    "1",
  );

  await page.locator("main").getByRole("link", { name: "الرئيسية" }).click();
  await expect(page).toHaveURL("/");
});
