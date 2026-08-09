import type {
  CardPage,
  SectionSummary,
  StudyStatistics,
} from "@openrecall/contracts";
import { createI18n } from "@openrecall/i18n";
import { act, render, screen, waitFor } from "@testing-library/react";
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

const secondSection: SectionSummary = {
  ...section,
  id: "e1529999-233c-42f2-a96d-72de4dcc4321",
  name: "Chemistry",
  counts: { total: 2, new: 1, dueNow: 0 },
};

const secondStatistics: StudyStatistics = {
  ...statistics,
  stateCounts: {
    ...statistics.stateCounts,
    total: 2,
    dueNow: 0,
    new: 1,
    review: 1,
  },
  sections: [
    {
      ...statistics.sections[0]!,
      sectionId: secondSection.id,
      name: secondSection.name,
      total: 2,
      dueNow: 0,
      new: 1,
    },
  ],
};

interface RenderSectionOptions {
  readonly get?: (path: string) => Promise<unknown>;
  readonly patch?: (path: string, body: unknown) => Promise<unknown>;
  readonly remove?: (path: string, body: unknown) => Promise<unknown>;
}

async function renderSection(options: RenderSectionOptions = {}) {
  const get = vi.fn(async (path: string) => {
    if (path === "/api/v1/settings/appearance") {
      return { theme: "system", updatedAtMs: 0 };
    }
    if (options.get !== undefined) return options.get(path);

        if (path === `/api/v1/sections/${section.id}`) return section;
        if (path === `/api/v1/sections/${section.id}/statistics`) {
          return statistics;
        }
        if (path.startsWith(`/api/v1/sections/${section.id}/cards?`)) {
          return {
            items: [],
            nextCursor: null,
          } satisfies CardPage;
        }
        if (path === "/api/v1/sections") return [];
        throw new Error(`UNEXPECTED_GET:${path}`);
  });
  const patch = vi.fn(
    options.patch ?? (async () => ({}) as unknown),
  );
  const remove = vi.fn(
    options.remove ?? (async () => undefined),
  );
  const api: ApiClient = {
    bootstrap: async () => ({
      apiVersion: 1,
      csrfToken: "token",
      databaseRevision: 1,
      locale: "en",
      localeUpdatedAtMs: 0,
    }),
    get: async <T,>(path: string) => (await get(path)) as T,
    patch: async <T,>(path: string, body: unknown) =>
      (await patch(path, body)) as T,
    post: async <T,>() => ({}) as T,
    put: async <T,>() => ({}) as T,
    delete: async <T,>(path: string, body: unknown) =>
      (await remove(path, body)) as T,
  };
  const i18n = await createI18n("en");
  const router = createMemoryRouter(createRoutes({ api, i18n }), {
    initialEntries: [`/sections/${section.id}`],
  });
  render(<RouterProvider router={router} />);
  return { get, patch, remove, router, user: userEvent.setup() };
}

describe("SectionPage disclosures", () => {
  it("loads statistics and cards only after their collapsed panels open", async () => {
    const { get, user } = await renderSection();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Biology" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "Add cards from JSON" }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Start review" })).not.toBeNull();

    const statisticsButton = screen.getByRole("button", {
      name: "Section statistics",
    });
    const cardsButton = screen.getByRole("button", { name: "Cards" });
    const managementButton = screen.getByRole("button", {
      name: "Section management",
    });
    for (const button of [statisticsButton, cardsButton, managementButton]) {
      expect(button.getAttribute("aria-expanded")).toBe("false");
      const panelId = button.getAttribute("aria-controls");
      expect(panelId).not.toBeNull();
      expect(document.getElementById(panelId!)?.hidden).toBe(true);
    }
    expect(get).toHaveBeenCalledWith(`/api/v1/sections/${section.id}`);
    expect(
      get.mock.calls.some(
        ([path]) =>
          path === `/api/v1/sections/${section.id}/statistics` ||
          String(path).startsWith(
            `/api/v1/sections/${section.id}/cards?`,
          ),
      ),
    ).toBe(false);
    expect(
      screen.queryByRole("textbox", { name: "Section name" }),
    ).toBeNull();

    statisticsButton.focus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole(
        "heading",
        { name: "Current card states" },
        { timeout: 5_000 },
      ),
    ).not.toBeNull();
    await user.click(statisticsButton);
    expect(
      screen.queryByRole("heading", { name: "Current card states" }),
    ).toBeNull();
    await user.click(statisticsButton);
    expect(
      await screen.findByRole(
        "heading",
        { name: "Current card states" },
        { timeout: 5_000 },
      ),
    ).not.toBeNull();
    expect(
      get.mock.calls.filter(
        ([path]) =>
          path === `/api/v1/sections/${section.id}/statistics`,
      ),
    ).toHaveLength(1);

    await user.click(cardsButton);
    expect(
      await screen.findByRole(
        "searchbox",
        { name: "Search cards" },
        { timeout: 5_000 },
      ),
    ).not.toBeNull();
    await user.click(cardsButton);
    expect(
      screen.queryByRole("searchbox", { name: "Search cards" }),
    ).toBeNull();
    await user.click(cardsButton);
    expect(
      await screen.findByRole(
        "searchbox",
        { name: "Search cards" },
        { timeout: 5_000 },
      ),
    ).not.toBeNull();
    expect(
      get.mock.calls.filter(([path]) =>
        String(path).startsWith(`/api/v1/sections/${section.id}/cards?`),
      ),
    ).toHaveLength(1);
  });

  it("reports a lazy statistics error and retries inside the panel", async () => {
    let statisticsAttempts = 0;
    const { user } = await renderSection({
      get: async (path) => {
        if (path === `/api/v1/sections/${section.id}`) return section;
        if (path === `/api/v1/sections/${section.id}/statistics`) {
          statisticsAttempts += 1;
          if (statisticsAttempts === 1) throw new Error("temporary");
          return statistics;
        }
        throw new Error(`UNEXPECTED_GET:${path}`);
      },
    });

    await screen.findByRole("heading", { level: 1, name: "Biology" });
    await user.click(
      screen.getByRole("button", { name: "Section statistics" }),
    );
    expect(
      await screen.findByText("Section statistics could not be loaded."),
    ).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("heading", { name: "Current card states" }),
    ).not.toBeNull();
    expect(statisticsAttempts).toBe(2);
  });

  it("preserves management state, renames, and permanently deletes", async () => {
    const renamed = { ...section, name: "Human Biology", updatedAtMs: 1_001 };
    const { patch, remove, router, user } = await renderSection({
      patch: async () => renamed,
      remove: async () => undefined,
    });

    await screen.findByRole("heading", { level: 1, name: "Biology" });
    expect(
      screen.queryByRole("textbox", { name: "Section name" }),
    ).toBeNull();
    const managementButton = screen.getByRole("button", {
      name: "Section management",
    });
    await user.click(managementButton);
    expect(
      screen.getByRole("heading", { level: 3, name: "Rename section" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Permanently delete section",
      }),
    ).not.toBeNull();
    const input = screen.getByRole("textbox", { name: "Section name" });
    await user.clear(input);
    await user.type(input, "Draft name");
    await user.click(managementButton);
    expect(
      screen.queryByRole("textbox", { name: "Section name" }),
    ).toBeNull();
    await user.click(managementButton);
    expect(
      (screen.getByRole("textbox", { name: "Section name" }) as HTMLInputElement)
        .value,
    ).toBe("Draft name");

    await user.clear(input);
    await user.type(input, "Human Biology");
    await user.click(screen.getByRole("button", { name: "Save new name" }));
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Human Biology",
      }),
    ).not.toBeNull();
    expect(patch).toHaveBeenCalledWith(`/api/v1/sections/${section.id}`, {
      name: "Human Biology",
      expectedUpdatedAtMs: section.updatedAtMs,
    });

    await user.click(
      screen.getByRole("checkbox", {
        name: "I understand that this section will be permanently deleted",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Permanently delete section" }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    await screen.findByRole("heading", {
      level: 1,
      name: "Learning sections",
    });
    expect(screen.getByRole("status").textContent).toBe(
      "The section was permanently deleted.",
    );
    expect(remove).toHaveBeenCalledWith(`/api/v1/sections/${section.id}`, {
      confirmed: true,
      expectedUpdatedAtMs: renamed.updatedAtMs,
    });
  });

  it("resets disclosure state and ignores old panel responses after direct section navigation", async () => {
    let releaseFirstStatistics!: (value: StudyStatistics) => void;
    const firstStatistics = new Promise<StudyStatistics>((resolve) => {
      releaseFirstStatistics = resolve;
    });
    const { router, user } = await renderSection({
      get: async (path) => {
        if (path === `/api/v1/sections/${section.id}`) return section;
        if (path === `/api/v1/sections/${secondSection.id}`) {
          return secondSection;
        }
        if (path === `/api/v1/sections/${section.id}/statistics`) {
          return firstStatistics;
        }
        if (path === `/api/v1/sections/${secondSection.id}/statistics`) {
          return secondStatistics;
        }
        throw new Error(`UNEXPECTED_GET:${path}`);
      },
    });

    await screen.findByRole("heading", { level: 1, name: "Biology" });
    await user.click(
      screen.getByRole("button", { name: "Section statistics" }),
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Loading section statistics…",
    );

    await act(async () => {
      await router.navigate(`/sections/${secondSection.id}`);
    });
    await screen.findByRole("heading", { level: 1, name: "Chemistry" });
    const statisticsButton = screen.getByRole("button", {
      name: "Section statistics",
    });
    expect(statisticsButton.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.getByRole("button", { name: "Section management" }).getAttribute(
        "aria-expanded",
      ),
    ).toBe("false");

    await user.click(statisticsButton);
    await waitFor(() =>
      expect(
        screen.getByText("Total", {
          exact: true,
          selector: "dt",
        }).parentElement?.textContent,
      ).toContain("2"),
    );
    await act(async () => {
      releaseFirstStatistics(statistics);
      await firstStatistics;
    });
    expect(
      screen.getByText("Total", {
        exact: true,
        selector: "dt",
      }).parentElement?.textContent,
    ).toContain("2");
  });
});
