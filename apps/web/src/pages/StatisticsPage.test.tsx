import type { StudyStatistics } from "@openrecall/contracts";
import { createI18n } from "@openrecall/i18n";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client.js";
import { createRoutes } from "../router.js";

const statistics: StudyStatistics = {
  summary: {
    reviewEvents: 4,
    uniqueItems: 3,
    ratingCounts: { 1: 1, 2: 1, 3: 1, 4: 1 },
    actualRecall: 0.75,
    meanPredictedRetrievability: 0.625,
    retrievabilityExcluded: 1,
    studyDurationMs: 90_000,
    durationExcluded: 1,
  },
  metrics: [
    { labelKey: "statistics.metric.reviewEvents", value: 4 },
    { labelKey: "statistics.metric.uniqueItems", value: 3 },
    { labelKey: "statistics.metric.actualRecall", value: 0.75 },
    {
      labelKey: "statistics.metric.predictedRetrievability",
      value: 0.625,
    },
    { labelKey: "statistics.metric.studyDurationMs", value: 90_000 },
  ],
  dailyActivity: [
    {
      studyDay: "2025-01-15",
      reviewEvents: 2,
      uniqueItems: 1,
      durationMs: 30_000,
      durationExcluded: 0,
    },
    {
      studyDay: "2025-01-16",
      reviewEvents: 2,
      uniqueItems: 2,
      durationMs: 60_000,
      durationExcluded: 1,
    },
  ],
  workloadForecast: [
    { studyDay: "2025-01-17", count: 2 },
    { studyDay: "2025-01-18", count: 0 },
  ],
  stateCounts: {
    total: 4,
    dueNow: 2,
    new: 1,
    learning: 1,
    review: 2,
    relearning: 0,
  },
  sections: [
    {
      sectionId: "d9428888-122b-41e1-985c-61cd3cbb3210",
      name: "Biology",
      total: 4,
      dueNow: 2,
      new: 1,
      learning: 1,
      review: 2,
      relearning: 0,
    },
  ],
};

async function renderStatistics(
  value: StudyStatistics = statistics,
  initialEntry = "/statistics",
) {
  const get = vi.fn(async (path: string) => {
    if (path.startsWith("/api/v1/statistics")) return value;
    return [] satisfies readonly never[];
  });
  const api: ApiClient = {
    bootstrap: async () => ({
      apiVersion: 1,
      csrfToken: "token",
      locale: "en",
    }),
    get: async <T,>(path: string) => (await get(path)) as T,
    post: async <T,>() => ({}) as T,
    put: async <T,>() => ({}) as T,
    delete: async <T,>() => undefined as T,
  };
  const i18n = await createI18n("en");
  const router = createMemoryRouter(createRoutes({ api, i18n }), {
    initialEntries: [initialEntry],
  });
  const result = render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1, name: "Statistics" });
  return { ...result, get, router };
}

describe("StatisticsPage", () => {
  it("provides equivalent tables for visual charts and has no serious axe violations", async () => {
    const { container } = await renderStatistics();

    expect(screen.getByText("75%")).not.toBeNull();
    expect(screen.getByText("62.5%")).not.toBeNull();
    expect(screen.getByText("1 min 30 sec")).not.toBeNull();

    const ratingTable = screen.getByRole("table", {
      name: "Rating distribution data",
    });
    expect(within(ratingTable).getByText("Again")).not.toBeNull();
    expect(within(ratingTable).getAllByText("1")).toHaveLength(4);
    expect(
      container
        .querySelector('[data-chart="rating-distribution"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");

    expect(
      screen.getByRole("table", { name: "Daily activity data" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("table", { name: "30-day workload forecast data" }),
    ).not.toBeNull();
    expect(screen.getByRole("link", { name: "Biology" })).not.toBeNull();

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      results.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);
  });

  it("stores native date filters in the URL, refetches, and focuses the results heading", async () => {
    const user = userEvent.setup();
    const { get, router } = await renderStatistics();

    await user.type(screen.getByLabelText("From study day"), "2025-01-01");
    await user.type(screen.getByLabelText("To study day"), "2025-02-01");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() =>
      expect(router.state.location.search).toBe(
        "?fromStudyDay=2025-01-01&toStudyDay=2025-02-01",
      ),
    );
    expect(get).toHaveBeenLastCalledWith(
      "/api/v1/statistics?fromStudyDay=2025-01-01&toStudyDay=2025-02-01",
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Results" }),
      ),
    );
  });

  it("distinguishes a genuine zero from unavailable calculated metrics", async () => {
    await renderStatistics({
      ...statistics,
      summary: {
        ...statistics.summary,
        reviewEvents: 0,
        uniqueItems: 0,
        ratingCounts: { 1: 0, 2: 0, 3: 0, 4: 0 },
        actualRecall: null,
        meanPredictedRetrievability: null,
        retrievabilityExcluded: 0,
        studyDurationMs: 0,
        durationExcluded: 0,
      },
      metrics: [],
      dailyActivity: [],
    });

    expect(screen.getByText("No review activity in this period.")).not.toBeNull();
    expect(screen.getAllByText("Not enough data")).toHaveLength(2);
    expect(screen.getByText("0 sec")).not.toBeNull();
  });
});
