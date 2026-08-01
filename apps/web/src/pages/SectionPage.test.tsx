import type {
  CardPage,
  SectionSummary,
  StudyStatistics,
} from "@openrecall/contracts";
import { createI18n } from "@openrecall/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client.js";
import { createRoutes } from "../router.js";

const section: SectionSummary = {
  id: "d9428888-122b-41e1-985c-61cd3cbb3210",
  name: "Biology",
  createdAtMs: 1_000,
  updatedAtMs: 1_000,
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
      patch: async <T,>() => ({}) as T,
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

  it("updates the page heading after rename and announces permanent deletion on home", async () => {
    const user = userEvent.setup();
    const renamed = { ...section, name: "Human Biology", updatedAtMs: 1_001 };
    const patch = vi.fn(async (_path: string, _body: unknown) => renamed);
    const remove = vi.fn(async (_path: string, _body: unknown) => undefined);
    const api: ApiClient = {
      bootstrap: async () => ({
        apiVersion: 1,
        csrfToken: "token",
        databaseRevision: 1,
        locale: "en",
        localeUpdatedAtMs: 0,
      }),
      get: async <T,>(path: string) => {
        if (path === `/api/v1/sections/${section.id}`) return section as T;
        if (path === `/api/v1/sections/${section.id}/statistics`) return statistics as T;
        if (path === "/api/v1/sections") return [] as T;
        return { items: [], nextCursor: null } as T;
      },
      patch: async <T,>(path: string, body: unknown) => (await patch(path, body)) as T,
      post: async <T,>() => ({}) as T,
      put: async <T,>() => ({}) as T,
      delete: async <T,>(path: string, body: unknown) => (await remove(path, body)) as T,
    };
    const i18n = await createI18n("en");
    const router = createMemoryRouter(createRoutes({ api, i18n }), {
      initialEntries: [`/sections/${section.id}`],
    });
    render(<RouterProvider router={router} />);

    const input = await screen.findByRole("textbox", { name: "Section name" });
    await user.clear(input);
    await user.type(input, "Human Biology");
    await user.click(screen.getByRole("button", { name: "Save new name" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Human Biology" })).not.toBeNull();

    await user.click(screen.getByRole("checkbox", {
      name: "I understand that this section will be permanently deleted",
    }));
    await user.click(screen.getByRole("button", { name: "Permanently delete section" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    await screen.findByRole("heading", { level: 1, name: "Learning sections" });
    expect(screen.getByRole("status").textContent).toBe(
      "The section was permanently deleted.",
    );
    expect(remove).toHaveBeenCalledWith(`/api/v1/sections/${section.id}`, {
      confirmed: true,
      expectedUpdatedAtMs: renamed.updatedAtMs,
    });
  });
});
