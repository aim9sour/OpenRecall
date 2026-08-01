import type { ReviewPageState } from "@openrecall/contracts";
import { createI18n, type LocaleTag } from "@openrecall/i18n";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const waitingForDueState: ReviewPageState = {
  kind: "waiting",
  nextDueAtMs: 61_000,
  session: progress({
    currentlyRemaining: 0,
    newRemaining: 0,
    nextDueAtMs: 61_000,
    remainingSnapshotAtMs: 1_000,
  }),
};

async function renderReview(
  locale: LocaleTag = "en",
  initialState: ReviewPageState = questionState,
  shownGate?: Promise<void>,
  postOverride?: (
    path: string,
    body: unknown,
  ) => Promise<ReviewPageState | void> | undefined,
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
      const overridden = postOverride?.(path, body);
      if (overridden !== undefined) {
        return (await overridden) as T;
      }
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
      if (path.endsWith("/next")) {
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ReviewPage NVDA interaction", () => {
  it("marks only an actually active review as update-blocking", async () => {
    const active = await renderReview();
    await screen.findByText("What is active recall?", { selector: "p" });
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
    await screen.findByText("What is active recall?", { selector: "p" });
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

  it("claims a card at its exact due time when SSE is unavailable", async () => {
    vi.useFakeTimers();
    // The browser clock can differ from the server clock. Scheduling must use
    // the server snapshot carried by the response, not the local wall clock.
    vi.setSystemTime(1_000_000);
    vi.stubGlobal("EventSource", undefined);
    const { posts } = await renderReview("en", waitingForDueState);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(
      posts.filter(({ path }) => path.endsWith("/next")),
    ).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(
      posts.filter(({ path }) => path.endsWith("/next")),
    ).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(
      posts.filter(({ path }) => path.endsWith("/next")),
    ).toHaveLength(1);
    const question = screen.getByText("What comes next?", {
      selector: '[data-review-content="question"]',
    });
    expect(document.activeElement).toBe(question);
  });

  it("uses local timer slices without claiming before a far-future due time", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", undefined);
    const maximumTimerDelayMs = 2_147_000_000;
    const dueDelayMs = maximumTimerDelayMs + 1_000;
    let monotonicNowMs = 0;
    vi.spyOn(window.performance, "now").mockImplementation(
      () => monotonicNowMs,
    );
    const { posts } = await renderReview("en", {
      ...waitingForDueState,
      nextDueAtMs: 1_000 + dueDelayMs,
      session: progress({
        currentlyRemaining: 0,
        newRemaining: 0,
        nextDueAtMs: 1_000 + dueDelayMs,
        remainingSnapshotAtMs: 1_000,
      }),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    monotonicNowMs = dueDelayMs;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(maximumTimerDelayMs);
    });
    expect(
      posts.filter(({ path }) => path.endsWith("/next")),
    ).toHaveLength(1);
  });

  it("waits for a hung claim without starting a 100ms polling loop", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", undefined);
    let releaseClaim: ((state: ReviewPageState) => void) | undefined;
    const firstClaim = new Promise<ReviewPageState>((resolve) => {
      releaseClaim = resolve;
    });
    let attempts = 0;
    const { posts } = await renderReview(
      "en",
      {
        ...waitingForDueState,
        nextDueAtMs: 1_000,
        session: progress({
          currentlyRemaining: 0,
          newRemaining: 0,
          nextDueAtMs: 1_000,
          remainingSnapshotAtMs: 1_000,
        }),
      },
      undefined,
      (path) => {
        if (!path.endsWith("/next")) {
          return undefined;
        }
        attempts += 1;
        return attempts === 1
          ? firstClaim
          : Promise.resolve(nextQuestionState);
      },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "End review" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(posts.filter(({ path }) => path.endsWith("/next"))).toHaveLength(1);

    await act(async () => {
      releaseClaim?.(nextQuestionState);
      await firstClaim;
      await Promise.resolve();
    });
    expect(posts.filter(({ path }) => path.endsWith("/next"))).toHaveLength(2);
  });

  it("retries a failed due claim with backoff", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", undefined);
    let attempts = 0;
    const { posts } = await renderReview(
      "en",
      {
        ...waitingForDueState,
        nextDueAtMs: 1_000,
        session: progress({
          currentlyRemaining: 0,
          newRemaining: 0,
          nextDueAtMs: 1_000,
          remainingSnapshotAtMs: 1_000,
        }),
      },
      undefined,
      (path) => {
        if (!path.endsWith("/next")) {
          return undefined;
        }
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("temporary"))
          : Promise.resolve(nextQuestionState);
      },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(posts.filter(({ path }) => path.endsWith("/next"))).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(posts.filter(({ path }) => path.endsWith("/next"))).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(posts.filter(({ path }) => path.endsWith("/next"))).toHaveLength(2);
    expect(
      screen.getByText("What comes next?", {
        selector: '[data-review-content="question"]',
      }),
    ).toBe(document.activeElement);
  });

  it("defers a due claim and focus while the end-session dialog is open", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", undefined);
    const { posts } = await renderReview("en", waitingForDueState);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "End review" }));
    const dialog = screen.getByRole("dialog", {
      name: "End this review session?",
    });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(posts.filter(({ path }) => path.endsWith("/next"))).toHaveLength(0);
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(posts.filter(({ path }) => path.endsWith("/next"))).toHaveLength(1);
    expect(
      screen.getByText("What comes next?", {
        selector: '[data-review-content="question"]',
      }),
    ).toBe(document.activeElement);
  });

  it("ignores an older due-claim response after pausing", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", undefined);
    let releaseClaim: ((state: ReviewPageState) => void) | undefined;
    const claim = new Promise<ReviewPageState>((resolve) => {
      releaseClaim = resolve;
    });
    const pausedState: ReviewPageState = {
      ...waitingForDueState,
      session: progress({
        status: "paused",
        currentlyRemaining: 0,
        newRemaining: 0,
        nextDueAtMs: 1_000,
        remainingSnapshotAtMs: 1_000,
      }),
    };
    await renderReview(
      "en",
      {
        ...waitingForDueState,
        nextDueAtMs: 1_000,
        session: progress({
          currentlyRemaining: 0,
          newRemaining: 0,
          nextDueAtMs: 1_000,
          remainingSnapshotAtMs: 1_000,
        }),
      },
      undefined,
      (path) => {
        if (path.endsWith("/next")) {
          return claim;
        }
        if (path.endsWith("/pause")) {
          return Promise.resolve(pausedState);
        }
        return undefined;
      },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "End review" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue later" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByRole("heading", { name: "Review paused" }),
    ).toBe(document.activeElement);

    await act(async () => {
      releaseClaim?.(nextQuestionState);
      await claim;
      await Promise.resolve();
    });
    expect(screen.queryByText("What comes next?")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Review paused" }),
    ).toBe(document.activeElement);
  });

  it("ignores an older due-claim response after finishing", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", undefined);
    let releaseClaim: ((state: ReviewPageState) => void) | undefined;
    const claim = new Promise<ReviewPageState>((resolve) => {
      releaseClaim = resolve;
    });
    const completedState: ReviewPageState = {
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
    };
    await renderReview(
      "en",
      {
        ...waitingForDueState,
        nextDueAtMs: 1_000,
        session: progress({
          currentlyRemaining: 0,
          newRemaining: 0,
          nextDueAtMs: 1_000,
          remainingSnapshotAtMs: 1_000,
        }),
      },
      undefined,
      (path) => {
        if (path.endsWith("/next")) {
          return claim;
        }
        if (path.endsWith("/finish")) {
          return Promise.resolve(completedState);
        }
        return undefined;
      },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "End review" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish session" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByRole("heading", { name: "Review complete" }),
    ).toBe(document.activeElement);

    await act(async () => {
      releaseClaim?.(nextQuestionState);
      await claim;
      await Promise.resolve();
    });
    expect(screen.queryByText("What comes next?")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Review complete" }),
    ).toBe(document.activeElement);
  });

  it("closes the dialog when revalidation wins the race with pause", async () => {
    let releasePause: ((state: ReviewPageState) => void) | undefined;
    const pauseResponse = new Promise<ReviewPageState>((resolve) => {
      releasePause = resolve;
    });
    const pausedState: ReviewPageState = {
      ...waitingForDueState,
      session: progress({
        status: "paused",
        currentlyRemaining: 0,
        newRemaining: 0,
        nextDueAtMs: 61_000,
        remainingSnapshotAtMs: 1_000,
      }),
    };
    const { router, setCurrentState } = await renderReview(
      "en",
      waitingForDueState,
      undefined,
      (path) =>
        path.endsWith("/pause") ? pauseResponse : undefined,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "End review" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue later" }));
    setCurrentState(pausedState);
    await act(async () => {
      await router.revalidate();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();

    await act(async () => {
      releasePause?.(pausedState);
      await pauseResponse;
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Review paused" }),
    ).toBe(document.activeElement);
  });

  it("restores focus to End review when the same card dialog is cancelled", async () => {
    const user = userEvent.setup();
    await renderReview();
    const question = await screen.findByText("What is active recall?", {
      selector: '[data-review-content="question"]',
    });
    await waitFor(() => expect(document.activeElement).toBe(question));
    const endButton = screen.getByRole("button", { name: "End review" });
    await user.click(endButton);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(endButton));
  });

  it("focuses the paused heading when pausing from a question", async () => {
    const user = userEvent.setup();
    const pausedQuestionState: ReviewPageState = {
      ...questionState,
      session: progress({ status: "paused" }),
    };
    await renderReview("en", questionState, undefined, (path) =>
      path.endsWith("/pause")
        ? Promise.resolve(pausedQuestionState)
        : undefined,
    );
    const question = await screen.findByText("What is active recall?", {
      selector: '[data-review-content="question"]',
    });
    await waitFor(() => expect(document.activeElement).toBe(question));
    await user.click(screen.getByRole("button", { name: "End review" }));
    await user.click(
      screen.getByRole("button", { name: "Continue later" }),
    );
    const pausedHeading = await screen.findByRole("heading", {
      name: "Review paused",
    });
    await waitFor(() => expect(document.activeElement).toBe(pausedHeading));
  });

  it("focuses card content directly through reveal and the next rating", async () => {
    const user = userEvent.setup();
    await renderReview();

    const question = await screen.findByText("What is active recall?", {
      selector: '[data-review-content="question"]',
    });
    expect(
      screen.getByRole("heading", { level: 1, name: "Question" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.queryByRole("heading", { name: "What is active recall?" }),
    ).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(question));
    expect(question.textContent).toBe("What is active recall?");

    await user.click(screen.getByRole("button", { name: "Show answer" }));
    const answer = await screen.findByText(
      "Retrieving an answer from memory.",
      {
        selector: '[data-review-content="answer"]',
      },
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Answer" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 2, name: "Notes" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", {
        name: "Retrieving an answer from memory.",
      }),
    ).toBeNull();
    expect(
      screen.getByText("Do not reread first.", {
        selector: '[data-review-content="notes"]',
      }).textContent,
    ).toBe("Do not reread first.");
    expect(
      screen.queryByRole("heading", { name: "Do not reread first." }),
    ).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(answer));

    const status = screen.getByRole("status");
    expect(status.textContent).not.toMatch(
      /active recall|Retrieving an answer|Do not reread/i,
    );

    await user.click(screen.getByRole("button", { name: /Good/ }));
    const nextQuestion = await screen.findByText("What comes next?", {
      selector: '[data-review-content="question"]',
    });
    await waitFor(() => expect(document.activeElement).toBe(nextQuestion));
    expect(status.textContent).toBe("2 cards joined this session.");
  });

  it("omits an empty notes heading", async () => {
    await renderReview("en", {
      ...answerState,
      card: { ...answerState.card, notes: "" },
    });

    await screen.findByText("Retrieving an answer from memory.", {
      selector: '[data-review-content="answer"]',
    });
    expect(
      screen.getByRole("heading", { level: 2, name: "Answer" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Notes" })).toBeNull();
  });

  it("supports Space, rating keys, and focus-only zero", async () => {
    const user = userEvent.setup();
    const { posts } = await renderReview();
    await screen.findByText("What is active recall?", {
      selector: '[data-review-content="question"]',
    });
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
    await screen.findByText("Retrieving an answer from memory.", {
      selector: '[data-review-content="answer"]',
    });
    await user.keyboard("0");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "End review" }),
    );
    expect(posts.some(({ path }) => path.endsWith("/pause"))).toBe(false);

    await user.keyboard("3");
    await screen.findByText("What comes next?", {
      selector: '[data-review-content="question"]',
    });
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
    const question = await screen.findByText("What is active recall?", {
      selector: '[data-review-content="question"]',
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
      await screen.findByText("What is active recall?", {
        selector: '[data-review-content="question"]',
      });

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
    await screen.findByText("What is active recall?", {
      selector: '[data-review-content="question"]',
    });
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    await user.keyboard(" ");
    expect(
      screen.queryByText("Retrieving an answer from memory."),
    ).toBeNull();
    input.remove();

    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    await user.keyboard(" ");
    expect(
      screen.queryByText("Retrieving an answer from memory."),
    ).toBeNull();
    dialog.remove();
  });
});
