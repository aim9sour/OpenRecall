import type { ReviewPageState } from "@openrecall/contracts";
import { createI18n, type LocaleTag } from "@openrecall/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client.js";
import { createRoutes } from "../router.js";

const SESSION_ID = "c9f65aa8-122b-41e1-985c-61cd3cbb3210";
const SECTION_ID = "d9428888-122b-41e1-985c-61cd3cbb3210";
const ENTRY_ID = "e9f65aa8-122b-41e1-985c-61cd3cbb3210";
const ITEM_ID = "a8f65aa8-122b-41e1-985c-61cd3cbb3210";
const PRESENTATION_ID = "b9f65aa8-122b-41e1-985c-61cd3cbb3210";

function progress(overrides = {}) {
  return {
    id: SESSION_ID,
    sectionId: SECTION_ID,
    status: "active" as const,
    revision: 1,
    completedAppearances: 0,
    currentlyRemaining: 1,
    newRemaining: 1,
    repeatedWithinSession: 0,
    elapsedActiveMs: 0,
    newlyJoined: 0,
    nextDueAtMs: null,
    remainingSnapshotAtMs: 1_000,
    ...overrides,
  };
}

const questionState: ReviewPageState = {
  kind: "question",
  card: {
    entryId: ENTRY_ID,
    learningItemId: ITEM_ID,
    presentationId: PRESENTATION_ID,
    front: "What is active recall?",
    stateRevision: 0,
  },
  session: progress(),
};

const answerState: ReviewPageState = {
  kind: "answer",
  card: {
    ...questionState.card,
    back: "Retrieving an answer from memory.",
    notes: "Do not reread first.",
  },
  outcomes: [1, 2, 3, 4].map((rating, index) => ({
    rating: rating as 1 | 2 | 3 | 4,
    dueAtMs: 61_200 + index * 60_000,
    intervalMs: 60_000 + index * 60_000,
  })),
  session: progress(),
};

const nextQuestionState: ReviewPageState = {
  kind: "question",
  card: {
    entryId: "f9f65aa8-122b-41e1-985c-61cd3cbb3210",
    learningItemId: "18f65aa8-122b-41e1-985c-61cd3cbb3210",
    presentationId: "28f65aa8-122b-41e1-985c-61cd3cbb3210",
    front: "What comes next?",
    stateRevision: 1,
  },
  session: progress({
    revision: 2,
    completedAppearances: 1,
    newlyJoined: 2,
  }),
};

async function renderReview(
  locale: LocaleTag = "en",
  initialState: ReviewPageState = questionState,
  shownGate?: Promise<void>,
) {
  let currentState = initialState;
  const posts: Array<{ path: string; body: unknown }> = [];
  const api: ApiClient = {
    bootstrap: async () => ({
      apiVersion: 1,
      csrfToken: "token",
      locale,
    }),
    get: async <T,>() => currentState as T,
    post: async <T,>(path: string, body: unknown) => {
      posts.push({ path, body });
      if (path.endsWith("/current/shown")) {
        await shownGate;
        return undefined as T;
      }
      if (path.endsWith("/current/reveal")) {
        currentState = answerState;
        return currentState as T;
      }
      if (path.endsWith("/current/rate")) {
        currentState = nextQuestionState;
        return currentState as T;
      }
      return currentState as T;
    },
    put: async <T,>() => ({}) as T,
    delete: async <T,>() => undefined as T,
  };
  const i18n = await createI18n(locale);
  const router = createMemoryRouter(createRoutes({ api, i18n }), {
    initialEntries: [`/review/${SESSION_ID}`],
  });
  const result = render(<RouterProvider router={router} />);
  return {
    ...result,
    posts,
    router,
    setCurrentState(state: ReviewPageState) {
      currentState = state;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReviewPage NVDA interaction", () => {
  it("marks only an actually active review as update-blocking", async () => {
    const active = await renderReview();
    await screen.findByRole("heading", {
      name: "What is active recall?",
    });
    expect(
      active.container.querySelector(
        '[data-openrecall-review-active="true"]',
      ),
    ).not.toBeNull();
    active.unmount();

    const paused = await renderReview("en", {
      ...questionState,
      session: progress({ status: "paused" }),
    });
    await screen.findByRole("heading", {
      name: "What is active recall?",
    });
    expect(
      paused.container.querySelector(
        '[data-openrecall-review-active="true"]',
      ),
    ).toBeNull();
    paused.unmount();

    const completed = await renderReview("en", {
      kind: "completed",
      summary: {
        sessionId: SESSION_ID,
        sectionId: SECTION_ID,
        completedAtMs: 2_000,
        reviewEvents: 1,
        uniqueItems: 1,
        repeatedWithinSession: 0,
        elapsedActiveMs: 1_000,
        ratingCounts: { again: 0, hard: 0, good: 1, easy: 0 },
      },
    });
    await screen.findByRole("heading", { name: "Review complete" });
    expect(
      completed.container.querySelector(
        '[data-openrecall-review-active="true"]',
      ),
    ).toBeNull();
  });

  it("does not reveal until the server has recorded the shown presentation", async () => {
    let releaseShown: (() => void) | undefined;
    const shownGate = new Promise<void>((resolve) => {
      releaseShown = resolve;
    });
    await renderReview("en", questionState, shownGate);

    const showAnswer = await screen.findByRole("button", {
      name: "Show answer",
    });
    expect((showAnswer as HTMLButtonElement).disabled).toBe(true);
    releaseShown?.();
    await waitFor(() =>
      expect((showAnswer as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("focuses card content directly through reveal and the next rating", async () => {
    const user = userEvent.setup();
    await renderReview();

    const question = await screen.findByRole("heading", {
      level: 1,
      name: "What is active recall?",
    });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(question));
    expect(question.textContent).toBe("What is active recall?");

    await user.click(screen.getByRole("button", { name: "Show answer" }));
    const answer = await screen.findByRole("heading", {
      level: 2,
      name: "Retrieving an answer from memory.",
    });
    await waitFor(() => expect(document.activeElement).toBe(answer));
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Do not reread first.",
      }).textContent,
    ).toBe("Do not reread first.");

    const status = screen.getByRole("status");
    expect(status.textContent).not.toMatch(
      /active recall|Retrieving an answer|Do not reread/i,
    );

    await user.click(screen.getByRole("button", { name: /Good/ }));
    const nextQuestion = await screen.findByRole("heading", {
      level: 1,
      name: "What comes next?",
    });
    await waitFor(() => expect(document.activeElement).toBe(nextQuestion));
    expect(status.textContent).toBe("2 cards joined this session.");
  });

  it("omits an empty notes heading", async () => {
    await renderReview("en", {
      ...answerState,
      card: { ...answerState.card, notes: "" },
    });

    await screen.findByRole("heading", {
      level: 2,
      name: "Retrieving an answer from memory.",
    });
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("supports Space, rating keys, and focus-only zero", async () => {
    const user = userEvent.setup();
    const { posts } = await renderReview();
    await screen.findByRole("heading", { name: "What is active recall?" });
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Show answer",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );

    await user.keyboard(" ");
    await screen.findByRole("heading", {
      level: 2,
      name: "Retrieving an answer from memory.",
    });
    await user.keyboard("0");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "End review" }),
    );
    expect(posts.some(({ path }) => path.endsWith("/pause"))).toBe(false);

    await user.keyboard("3");
    await screen.findByRole("heading", { name: "What comes next?" });
    expect(
      posts.filter(({ path }) => path.endsWith("/current/rate")),
    ).toHaveLength(1);
  });

  it("revalidates from SSE without stealing focus or exposing card content", async () => {
    class FakeEventSource extends EventTarget {
      static latest: FakeEventSource | undefined;

      constructor(_url: string) {
        super();
        FakeEventSource.latest = this;
      }

      close(): void {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    const { setCurrentState } = await renderReview();
    const question = await screen.findByRole("heading", {
      name: "What is active recall?",
    });
    await waitFor(() => expect(document.activeElement).toBe(question));
    const endButton = screen.getByRole("button", { name: "End review" });
    endButton.focus();
    setCurrentState({
      ...questionState,
      session: progress({ revision: 2, newlyJoined: 2 }),
    });

    FakeEventSource.latest?.dispatchEvent(
      new MessageEvent("review-invalidated", {
        data: JSON.stringify({ sessionId: SESSION_ID, revision: 2 }),
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe(
        "2 cards joined this session.",
      ),
    );
    expect(document.activeElement).toBe(endButton);
    expect(screen.getByRole("status").textContent).not.toContain(
      "What is active recall?",
    );
  });

  it.each(["en", "ar"] as const)(
    "has no serious accessibility violations in %s",
    async (locale) => {
      const { container } = await renderReview(locale);
      await screen.findByRole("heading", { name: "What is active recall?" });

      const results = await axe.run(container, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(
        results.violations.filter(
          (violation) =>
            violation.impact === "serious" ||
            violation.impact === "critical",
        ),
      ).toEqual([]);
    },
  );
});

describe("review shortcut isolation", () => {
  it("ignores shortcuts in editable controls and modal dialogs", async () => {
    const user = userEvent.setup();
    await renderReview();
    await screen.findByRole("heading", { name: "What is active recall?" });
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    await user.keyboard(" ");
    expect(
      screen.queryByRole("heading", {
        level: 2,
        name: "Retrieving an answer from memory.",
      }),
    ).toBeNull();
    input.remove();

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    await user.keyboard(" ");
    expect(
      screen.queryByRole("heading", {
        level: 2,
        name: "Retrieving an answer from memory.",
      }),
    ).toBeNull();
    dialog.remove();
  });
});
