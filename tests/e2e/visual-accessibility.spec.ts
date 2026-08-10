import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { OPTIMIZER_FIXTURE_SECTION_ID } from "./seed-optimizer-fixture.js";

test.setTimeout(120_000);

const staticRoutes = [
  "/",
  `/sections/${OPTIMIZER_FIXTURE_SECTION_ID}`,
  `/sections/${OPTIMIZER_FIXTURE_SECTION_ID}/import`,
  "/statistics",
  "/settings",
] as const;

async function expectPageFitsViewport(
  page: Page,
  route: string,
  viewportWidth: number,
): Promise<void> {
  const overflow = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    return {
      clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll<HTMLElement>("body *")]
        .map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            selector: `${element.tagName.toLowerCase()}${element.id === "" ? "" : `#${element.id}`}${[...element.classList].map((name) => `.${name}`).join("")}`,
            left: Math.round(bounds.left),
            right: Math.round(bounds.right),
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
          };
        })
        .filter(
          ({ left, right, scrollWidth, clientWidth: elementClientWidth }) =>
            left < -1 ||
            right > clientWidth + 1 ||
            scrollWidth > elementClientWidth + 1,
        )
        .slice(0, 12),
    };
  });
  expect(
    overflow.scrollWidth,
    `${route} at ${viewportWidth}px overflowed: ${JSON.stringify(overflow.elements)}`,
  ).toBeLessThanOrEqual(overflow.clientWidth);
}

async function expectNoSeriousAccessibilityViolations(
  page: Page,
): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
}

async function openSettingsDisclosures(page: Page): Promise<void> {
  const disclosures = page.locator("main button.disclosure-toggle");
  await expect(disclosures).toHaveCount(3);
  for (let index = 0; index < await disclosures.count(); index += 1) {
    const disclosure = disclosures.nth(index);
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expectNoSeriousAccessibilityViolations(page);
  }
}

test("learning-step results stay navigable without bloating live announcements", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/settings");
  const recommendationPanel = page.locator("main section.panel").filter({
    has: page.locator("button.disclosure-toggle"),
  }).first();
  const disclosure = recommendationPanel.locator("button.disclosure-toggle");
  await expect(disclosure).toHaveAttribute("aria-expanded", "false");
  await disclosure.click();
  const analyze = recommendationPanel.locator(".review-actions button").first();
  await expect(analyze).toBeFocused();
  await expectNoSeriousAccessibilityViolations(page);
  await analyze.click();

  await expect(recommendationPanel.locator(".step-recommendation-results"))
    .toBeVisible({ timeout: 30_000 });
  const liveText = (await page.getByTestId("step-live").textContent()) ?? "";
  expect(liveText.trim().length).toBeGreaterThan(0);
  expect(liveText.length).toBeLessThan(200);
  expect(liveText).not.toMatch(/(?:٨٤٢|842)/u);
  await expectNoSeriousAccessibilityViolations(page);
  await expectPageFitsViewport(page, "/settings#step-results", 320);
});

async function ensureReviewRoute(page: Page): Promise<string> {
  await page.goto("/");
  const sessionId = await page.evaluate(async (sectionId) => {
    const bootstrapResponse = await fetch("/api/v1/bootstrap");
    const bootstrap = (await bootstrapResponse.json()) as {
      csrfToken: string;
    };
    const response = await fetch("/api/v1/review-sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-openrecall-csrf": bootstrap.csrfToken,
      },
      body: JSON.stringify({ sectionId }),
    });
    const body = (await response.json()) as {
      session?: { id: string };
      sessionId?: string;
    };
    const id = body.session?.id ?? body.sessionId;
    if (
      (response.status !== 201 && response.status !== 409) ||
      id === undefined
    ) {
      throw new Error(`VISUAL_REVIEW_SETUP_FAILED_${response.status}`);
    }
    return id;
  }, OPTIMIZER_FIXTURE_SECTION_ID);
  return `/review/${encodeURIComponent(sessionId)}`;
}

test("visual accessibility covers every route, locale, theme, and reflow mode", async ({
  page,
}, testInfo) => {
  const reviewRoute = await ensureReviewRoute(page);
  const routes = [...staticRoutes, reviewRoute];

  for (const viewport of [
    { width: 1_280, height: 800 },
    { width: 320, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator("main h1").first()).toBeVisible();
      await expectPageFitsViewport(page, route, viewport.width);
      await expectNoSeriousAccessibilityViolations(page);
      if (route === "/settings") {
        await openSettingsDisclosures(page);
        await expectPageFitsViewport(page, route, viewport.width);
      }
    }
  }

  await page.setViewportSize({ width: 1_280, height: 800 });
  await page.goto("/");
  const theme = page.locator("#theme-preference");

  await theme.selectOption("light");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "light",
  );
  await theme.selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  await theme.selectOption("system");
  await page.emulateMedia({
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  await expectNoSeriousAccessibilityViolations(page);

  await page.emulateMedia({ forcedColors: "active" });
  await expectNoSeriousAccessibilityViolations(page);

  const direction = testInfo.project.name.endsWith("-ar")
    ? "rtl"
    : "ltr";
  await expect(page.locator("html")).toHaveAttribute("dir", direction);
  if (testInfo.project.name.endsWith("-xa")) {
    await expect(page.locator("body")).toContainText("［");
  }
});
