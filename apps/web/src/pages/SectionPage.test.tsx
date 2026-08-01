import type {
  CardPage,
  SectionSummary,
  StudyStatistics,
} from "@openrecall/contracts";
import { createI18n } from "@openrecall/i18n";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client.js";
import { createRoutes } from "../router.js";

const section: SectionSummary = {
  id: "d9428888-122b-41e1-985c-61cd3cbb3210",
  name: "Biology",
  createdAtMs: 1_000,
  counts: { total: 1, new: 0, dueNow: 1 },
  nextDueAtMs: 1_000,
};
const statistics: StudyStatistics = {
  summary: {
    reviewEvents: 1,
    uniqueItems: 1,
    ratingCounts: { 1: 0, 2: 0, 3: 1, 4: 0 },
    actualRecall: 1,
    meanPredictedRetrievability: 0.7,
    retrievabilityExcluded: 0,
    studyDurationMs: 2_000,
    durationExcluded: 0,
  },
  metrics: [],
  dailyActivity: [],
  workloadForecast: [{ studyDay: "2025-01-18", count: 1 }],
  stateCounts: {
    total: 1,
    dueNow: 1,
    new: 0,
    learning: 0,
    review: 1,
    relearning: 0,
  },
  sections: [
    {
      sectionId: section.id,
      name: section.name,
      total: 1,
      dueNow: 1,
      new: 0,
      learning: 0,
      review: 1,
      relearning: 0,
    },
  ],
};

describe("SectionPage statistics", () => {
  it("loads the section-scoped dashboard and keeps card management available", async () => {
    const get = vi.fn(async (path: string) => {
      if (path === `/api/v1/sections/${section.id}`) return section;
      if (path === `/api/v1/sections/${section.id}/statistics`) {
        return statistics;
      }
      return {
        items: [],
        nextCursor: null,
      } satisfies CardPage;
    });
    const api: ApiClient = {
      bootstrap: async () => ({
        apiVersion: 1,
        csrfToken: "token",
        databaseRevision: 1,
        locale: "en",
        localeUpdatedAtMs: 0,
      }),
      get: async <T,>(path: string) => (await get(path)) as T,
      post: async <T,>() => ({}) as T,
      put: async <T,>() => ({}) as T,
      delete: async <T,>() => undefined as T,
    };
    const i18n = await createI18n("en");
    const router = createMemoryRouter(createRoutes({ api, i18n }), {
      initialEntries: [`/sections/${section.id}`],
    });
    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Biology" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("heading", { level: 2, name: "Section statistics" }),
    ).not.toBeNull();
    expect(screen.getByText("100%")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Cards" })).not.toBeNull();
    expect(get).toHaveBeenCalledWith(
      `/api/v1/sections/${section.id}/statistics`,
    );
  });
});
