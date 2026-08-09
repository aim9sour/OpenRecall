import { createI18n } from "@openrecall/i18n";
import type { SectionSummary, StudyStatistics } from "@openrecall/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "../api/client.js";
import { createRoutes } from "../router.js";

describe("ImportPage", () => {
  it("previews literal text, allows selection, and commits valid cards", async () => {
    const user = userEvent.setup();
    const posts: Array<{ path: string; body: unknown }> = [];
    const api: ApiClient = {
      bootstrap: async () => ({
        apiVersion: 1,
        csrfToken: "token",
        databaseRevision: 1,
        locale: "en",
        localeUpdatedAtMs: 0,
      }),
      get: async <T,>(path: string) => {
        const section: SectionSummary = {
          id: "d9428888-122b-41e1-985c-61cd3cbb3210",
          name: "Biology",
          createdAtMs: 1,
          updatedAtMs: 1,
          counts: { total: 1, new: 1, dueNow: 0 },
          nextDueAtMs: null,
        };
        if (path.endsWith("/statistics")) {
          return {
            summary: {
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
            workloadForecast: [],
            stateCounts: {
              total: 1,
              dueNow: 0,
              new: 1,
              learning: 0,
              review: 0,
              relearning: 0,
            },
            sections: [],
          } satisfies StudyStatistics as T;
        }
        return section as T;
      },
      patch: async <T,>() => ({}) as T,
      post: async <T,>(path: string, body: unknown) => {
        posts.push({ path, body });
        if (path.endsWith("/preview")) {
          return {
            previewId: "preview",
            digest: "a".repeat(64),
            total: 2,
            valid: 2,
            duplicate: 0,
            invalid: 0,
            rows: [
              {
                index: 0,
                status: "valid",
                issues: [],
                warnings: [],
              },
              {
                index: 1,
                status: "valid",
                issues: [],
                warnings: [],
              },
            ],
          } as T;
        }
        return { importedItemIds: ["item-1"] } as T;
      },
      put: async <T,>() => ({}) as T,
      delete: async <T,>() => undefined as T,
    };
    const i18n = await createI18n("en");
    const router = createMemoryRouter(createRoutes({ api, i18n }), {
      initialEntries: [
        "/sections/d9428888-122b-41e1-985c-61cd3cbb3210/import",
      ],
    });
    const { container } = render(<RouterProvider router={router} />);

    const input = await screen.findByLabelText("Cards file");
    expect(input.getAttribute("accept")).toBe(".json,application/json");
    const file = new File(
      [
        JSON.stringify([
          {
            front: "2 < 3",
            back: "True & literal",
            notes: "Primary note: 2 < 3 & context",
            variants: [
              {
                front: "Alternative",
                back: "True",
                notes: "Variant-only note",
              },
            ],
          },
          {
            front: "Question without notes",
            back: "Answer without notes",
          },
        ]),
      ],
      "cards.json",
      { type: "application/json" },
    );
    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: "Preview import" }));

    const literalCell = await screen.findByText("2 < 3");
    expect(literalCell.getAttribute("dir")).toBe("auto");
    expect(literalCell.querySelector("*")).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Notes" })).not.toBeNull();

    const primaryNotes = screen.getByText("Primary note: 2 < 3 & context");
    expect(primaryNotes.getAttribute("dir")).toBe("auto");
    expect(primaryNotes.querySelector("*")).toBeNull();
    expect(screen.queryByText("Variant-only note")).toBeNull();

    const noNotesRow = screen.getByText("Question without notes").closest("tr");
    expect(noNotesRow).not.toBeNull();
    expect(noNotesRow?.querySelectorAll("td")[4]?.textContent).toBe("");

    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([true, true]);

    for (const checkbox of checkboxes) await user.click(checkbox);
    expect(
      (screen.getByRole("button", { name: "Import cards" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    for (const checkbox of checkboxes) await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: "Import cards" }));

    await waitFor(() => expect(posts).toHaveLength(2));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Biology" }),
    ).not.toBeNull();
    expect(container.querySelector("main")).not.toBeNull();
  });
});
