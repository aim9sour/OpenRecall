import type { Card, CardStatistics } from "@openrecall/contracts";
import { createI18n } from "@openrecall/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client.js";
import { I18nProvider } from "../app/I18nProvider.js";
import { CardStatisticsDisclosure } from "./CardStatisticsDisclosure.js";

const card: Card = {
  id: "a8f65aa8-122b-41e1-985c-61cd3cbb3210",
  sectionId: "d9428888-122b-41e1-985c-61cd3cbb3210",
  lifecycle: "active",
  createdAtMs: 1_000,
  updatedAtMs: 2_000,
  trashedAtMs: null,
  presentations: [
    {
      id: "b9f65aa8-122b-41e1-985c-61cd3cbb3210",
      kind: "primary",
      ordinal: 0,
      front: "Question",
      back: "Answer",
      notes: null,
    },
  ],
};

const cardStatistics: CardStatistics = {
  itemId: card.id,
  sectionId: card.sectionId,
  lifecycle: "active",
  currentState: {
    dueAtMs: Date.parse("2025-01-20T12:00:00Z"),
    memoryState: "review",
    stepIndex: null,
    stability: 10,
    difficulty: 5,
    repetitions: 3,
    lapses: 1,
    revision: 3,
    retrievability: 0.8,
    algorithmId: "FSRS-6",
    algorithmVersion: "6.0",
    adapterVersion: 1,
    parameterProfileId: "official-fsrs6-v1",
  },
  lastReview: { rating: 3, ratedAtMs: Date.parse("2025-01-15T12:00:00Z") },
  presentations: [
    {
      presentationId: card.presentations[0]!.id,
      lifecycle: "active",
      showCount: 3,
      firstShownAtMs: Date.parse("2025-01-01T12:00:00Z"),
      lastShownAtMs: Date.parse("2025-01-15T12:00:00Z"),
    },
  ],
  history: {
    items: [
      {
        id: "log-1",
        presentationId: card.presentations[0]!.id,
        frontSnapshot: "Old question",
        backSnapshot: "Old answer",
        notesSnapshot: null,
        rating: 3,
        shownAtMs: Date.parse("2025-01-15T12:00:00Z"),
        revealedAtMs: Date.parse("2025-01-15T12:00:01Z"),
        ratedAtMs: Date.parse("2025-01-15T12:00:02Z"),
        durationMs: 2_000,
        retrievabilityBefore: 0.75,
        resultingDueAtMs: Date.parse("2025-01-20T12:00:00Z"),
      },
    ],
    nextCursor: null,
  },
};

describe("CardStatisticsDisclosure", () => {
  it("loads only when expanded, exposes details in native structures, and retains focus", async () => {
    let resolveRequest: ((value: CardStatistics) => void) | undefined;
    const get = vi.fn(
      (_path: string) =>
        new Promise<CardStatistics>((resolve) => {
          resolveRequest = resolve;
        }),
    );
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
    render(
      <I18nProvider i18n={i18n}>
        <MemoryRouter>
          <CardStatisticsDisclosure api={api} card={card} />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(get).not.toHaveBeenCalled();

    const button = screen.getByRole("button", {
      name: "Show card statistics",
    });
    await userEvent.click(button);
    expect(get).toHaveBeenCalledWith(`/api/v1/cards/${card.id}/statistics`);
    expect(
      document
        .getElementById(`card-statistics-${card.id}`)
        ?.getAttribute("aria-busy"),
    ).toBe("true");
    expect(document.activeElement).toBe(button);

    resolveRequest?.(cardStatistics);
    expect((await screen.findByText("Memory state")).tagName).toBe("DT");
    expect(
      screen.getByRole("table", { name: "Presentation exposure history" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("table", { name: "Review history" }),
    ).not.toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
});
