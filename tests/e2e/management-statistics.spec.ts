import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type {
  CardPage,
  CardStatistics,
  StudyStatistics,
} from "@openrecall/contracts";

const text = {
  ar: {
    direction: "rtl",
    section: "اختبار الإدارة والإحصاءات",
    sectionName: "اسم القسم",
    createSection: "إنشاء قسم",
    importLink: "إضافة بطاقات من JSON",
    file: "ملف البطاقات",
    preview: "معاينة الاستيراد",
    commit: "استيراد البطاقات",
    startReview: "بدء المراجعة",
    showAnswer: "عرض الإجابة",
    good: /جيد/,
    waiting: "لا توجد بطاقات مستحقة الآن",
    endReview: "إنهاء المراجعة",
    endDialog: "هل تريد إنهاء جلسة المراجعة؟",
    finish: "إنهاء الجلسة",
    completed: "اكتملت المراجعة",
    backSection: "العودة إلى القسم",
    edit: "تحرير البطاقة",
    primary: "الصياغة الأساسية",
    question: "السؤال",
    save: "حفظ البطاقة",
    showStatistics: "عرض إحصاءات البطاقة",
    repetitions: "مرات التكرار",
    reviewHistory: "سجل المراجعة",
    trash: "نقل البطاقة إلى سلة المحذوفات",
    undoTrash: "التراجع عن النقل إلى السلة",
    permanentDelete: "حذف البطاقة نهائيًا",
    deleteDialog: "هل تريد حذف هذه البطاقة نهائيًا؟",
    confirmDelete: "تأكيد الحذف النهائي",
    statistics: "الإحصاءات",
    statisticsTitle: "الإحصاءات",
    sectionFilter: "القسم",
    from: "من يوم المذاكرة",
    to: "إلى يوم المذاكرة",
    apply: "تطبيق المرشحات",
    results: "النتائج",
    reviewEvents: "أحداث المراجعة",
    uniqueCards: "البطاقات الفريدة",
    actualRecall: "التذكر الفعلي",
    ratingData: "بيانات توزيع التقييمات",
    workloadData: "بيانات توقع عبء المراجعة لثلاثين يومًا",
    goodRating: "جيد",
  },
  en: {
    direction: "ltr",
    section: "Management and statistics test",
    sectionName: "Section name",
    createSection: "Create section",
    importLink: "Add cards from JSON",
    file: "Cards file",
    preview: "Preview import",
    commit: "Import cards",
    startReview: "Start review",
    showAnswer: "Show answer",
    good: /Good/,
    waiting: "No cards are due now",
    endReview: "End review",
    endDialog: "End this review session?",
    finish: "Finish session",
    completed: "Review complete",
    backSection: "Back to section",
    edit: "Edit card",
    primary: "Primary presentation",
    question: "Question",
    save: "Save card",
    showStatistics: "Show card statistics",
    repetitions: "Repetitions",
    reviewHistory: "Review history",
    trash: "Move card to trash",
    undoTrash: "Undo trash",
    permanentDelete: "Delete card permanently",
    deleteDialog: "Permanently delete this card?",
    confirmDelete: "Confirm permanent deletion",
    statistics: "Statistics",
    statisticsTitle: "Statistics",
    sectionFilter: "Section",
    from: "From study day",
    to: "To study day",
    apply: "Apply filters",
    results: "Results",
    reviewEvents: "Review events",
    uniqueCards: "Unique cards",
    actualRecall: "Actual recall",
    ratingData: "Rating distribution data",
    workloadData: "30-day workload forecast data",
    goodRating: "Good",
  },
} as const;

async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
}

test("management and statistics preserve history, isolate deletion, and reflow", async ({
  page,
}, testInfo) => {
  const language = testInfo.project.name.endsWith("-en") ? "en" : "ar";
  const t = text[language];
  const firstFront = language === "ar" ? "ما وظيفة الميتوكوندريا؟" : "What does a mitochondrion do?";
  const firstVariant =
    language === "ar"
      ? "ما العضية التي تنتج معظم طاقة الخلية؟"
      : "Which organelle produces most cellular energy?";
  const editedFront =
    language === "ar"
      ? "ما الدور الأساسي للميتوكوندريا؟"
      : "What is the primary role of mitochondria?";
  const secondFront =
    language === "ar" ? "ما رمز عنصر الأكسجين؟" : "What is oxygen's symbol?";

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", t.direction);
  await page.getByLabel(t.sectionName).fill(t.section);
  await page.getByRole("button", { name: t.createSection }).click();
  await page.getByRole("link", { name: t.section }).click();
  await expect(page).toHaveURL(
    /\/sections\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  const sectionId = new URL(page.url()).pathname.split("/").at(-1)!;

  await page.getByRole("link", { name: t.importLink }).click();
  await expectAccessible(page);
  await page.getByLabel(t.file).setInputFiles({
    name: "management-statistics.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify([
        {
          front: firstFront,
          back: language === "ar" ? "إنتاج الطاقة." : "Energy production.",
          notes: language === "ar" ? "بطاقة متعددة الصياغات." : "A multi-presentation card.",
          variants: [
            {
              front: firstVariant,
              back: language === "ar" ? "الميتوكوندريا." : "The mitochondrion.",
            },
          ],
        },
        {
          front: secondFront,
          back: "O",
        },
      ]),
    ),
  });
  await page.getByRole("button", { name: t.preview }).click();
  await page.getByRole("button", { name: t.commit }).click();
  await expect(page.getByRole("heading", { level: 1, name: t.section })).toBeFocused();

  const cardsResponse = await page.request.get(
    `/api/v1/sections/${sectionId}/cards?lifecycle=active&limit=25`,
  );
  const cardsBody = await cardsResponse.text();
  expect(cardsResponse.status(), cardsBody).toBe(200);
  const cardPage = JSON.parse(cardsBody) as CardPage;
  const firstCard = cardPage.items.find(
    ({ presentations }) => presentations[0]?.front === firstFront,
  )!;
  const secondCard = cardPage.items.find(
    ({ presentations }) => presentations[0]?.front === secondFront,
  )!;

  await page.getByRole("button", { name: t.startReview }).click();
  for (let index = 0; index < 2; index += 1) {
    await expect(
      page.locator('[data-review-content="question"]'),
    ).toBeFocused();
    await page.getByRole("button", { name: t.showAnswer }).click();
    await page.getByRole("button", { name: t.good }).click();
  }
  await expect(
    page.getByRole("heading", { level: 1, name: t.waiting }),
  ).toBeFocused();
  await page.getByRole("button", { name: t.endReview }).click();
  await expect(
    page.getByRole("dialog", { name: t.endDialog }),
  ).toBeVisible();
  await page.getByRole("button", { name: t.finish }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: t.completed }),
  ).toBeFocused();
  await page.getByRole("link", { name: t.backSection }).click();

  const beforeEditResponse = await page.request.get(
    `/api/v1/cards/${firstCard.id}/statistics`,
  );
  const beforeEdit = (await beforeEditResponse.json()) as CardStatistics;

  let firstArticle = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: firstFront }) });
  await firstArticle.getByRole("button", { name: t.edit }).click();
  const primary = firstArticle.getByRole("group", { name: t.primary });
  await primary.getByLabel(t.question).fill(editedFront);
  await firstArticle.getByRole("button", { name: t.save }).click();
  firstArticle = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: editedFront }) });
  await expect(firstArticle).toBeVisible();

  const afterEditResponse = await page.request.get(
    `/api/v1/cards/${firstCard.id}/statistics`,
  );
  const afterEdit = (await afterEditResponse.json()) as CardStatistics;
  expect(afterEdit.currentState?.revision).toBe(
    beforeEdit.currentState?.revision,
  );
  expect(afterEdit.history.items.map(({ id }) => id)).toEqual(
    beforeEdit.history.items.map(({ id }) => id),
  );

  await firstArticle
    .getByRole("button", { name: t.showStatistics })
    .click();
  await expect(
    firstArticle.getByText(t.repetitions, { exact: true }).locator(".."),
  ).toContainText("1");
  await expect(
    firstArticle.getByRole("table", { name: t.reviewHistory }),
  ).toContainText(new RegExp(`${firstFront}|${firstVariant}`));

  await firstArticle.getByRole("button", { name: t.trash }).click();
  await page.getByRole("button", { name: t.undoTrash }).click();
  await expect(page.getByRole("heading", { name: editedFront })).toBeVisible();

  const secondArticle = page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: secondFront }) });
  await secondArticle
    .getByRole("button", { name: t.permanentDelete })
    .click();
  await expect(
    page.getByRole("dialog", { name: t.deleteDialog }),
  ).toBeVisible();
  await page.getByRole("button", { name: t.confirmDelete }).click();
  await expect(page.getByRole("heading", { name: secondFront })).toHaveCount(0);

  const deletedStatistics = await page.request.get(
    `/api/v1/cards/${secondCard.id}/statistics`,
  );
  expect(deletedStatistics.status()).toBe(404);
  expect(
    (
      await page.request.get(`/api/v1/cards/${firstCard.id}/statistics`)
    ).status(),
  ).toBe(200);
  await expectAccessible(page);

  await page
    .getByRole("link", { name: t.statistics, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: t.statisticsTitle }),
  ).toBeFocused();
  await page
    .getByRole("combobox", { name: t.sectionFilter })
    .selectOption(sectionId);
  await page.getByLabel(t.from).fill("2025-01-01");
  await page.getByLabel(t.to).fill("2025-01-02");
  await page.getByRole("button", { name: t.apply }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: t.results }),
  ).toBeFocused();

  const filteredApiResponse = await page.request.get(
    `/api/v1/sections/${sectionId}/statistics?fromStudyDay=2025-01-01&toStudyDay=2025-01-02`,
  );
  const filtered = (await filteredApiResponse.json()) as StudyStatistics;
  expect(filtered.summary.reviewEvents).toBe(1);
  expect(filtered.summary.uniqueItems).toBe(1);
  expect(filtered.summary.actualRecall).toBe(1);
  await expect(
    page
      .locator(".metric-summary")
      .getByText(t.reviewEvents, { exact: true })
      .locator(".."),
  ).toContainText(String(filtered.summary.reviewEvents));
  await expect(
    page
      .locator(".metric-summary")
      .getByText(t.uniqueCards, { exact: true })
      .locator(".."),
  ).toContainText(String(filtered.summary.uniqueItems));
  await expect(
    page
      .locator(".metric-summary")
      .getByText(t.actualRecall, { exact: true })
      .locator(".."),
  ).toContainText("100");
  await expect(
    page
      .getByRole("table", { name: t.ratingData })
      .getByRole("row", { name: new RegExp(t.goodRating) }),
  ).toContainText("1");
  await expect(
    page.getByRole("table", { name: t.workloadData }),
  ).toBeVisible();
  await expectAccessible(page);

  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.getByRole("heading", { name: t.results })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.getByRole("heading", { name: t.results }).focus();
  const sectionLink = page.getByRole("link", { name: t.section });
  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press("Tab");
    if (
      await sectionLink.evaluate(
        (element) => element === document.activeElement,
      )
    ) {
      break;
    }
  }
  await expect(sectionLink).toBeFocused();
});
