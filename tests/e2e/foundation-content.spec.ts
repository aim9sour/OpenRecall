import { expect, test } from "@playwright/test";

test("foundation content creates a section and imports one card with variants", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("اسم القسم").fill("الأحياء");
  await page.getByRole("button", { name: "إنشاء قسم" }).click();
  await page.getByRole("link", { name: "الأحياء" }).click();
  await page.getByRole("link", { name: "إضافة بطاقات من JSON" }).click();

  await page.getByLabel("ملف البطاقات").setInputFiles({
    name: "cards.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        front: "ما عاصمة مصر؟",
        back: "القاهرة",
        notes: "مدينة على نهر النيل",
        variants: [
          { front: "عاصمة جمهورية مصر العربية؟", back: "القاهرة" },
          { front: "Cairo is the capital of which country?", back: "Egypt" },
        ],
      }),
    ),
  });
  await page.getByRole("button", { name: "معاينة الاستيراد" }).click();

  await expect(page.getByRole("table")).toContainText("ما عاصمة مصر؟");
  await expect(page.getByRole("checkbox", { name: "تحديد البطاقة 1" })).toBeChecked();
  await page.getByRole("button", { name: "استيراد البطاقات" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "الأحياء" })).toBeFocused();
  await page.getByRole("button", { name: "إحصاءات القسم" }).click();
  await expect(
    page.locator("dt").filter({ hasText: "الإجمالي" }).locator(".."),
  ).toContainText("1");
});
