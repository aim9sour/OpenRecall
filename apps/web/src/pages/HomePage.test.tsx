import type { ReviewPageState } from "@openrecall/contracts";
import { createI18n } from "@openrecall/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";
import {
  ApiClientError,
  type ApiClient,
} from "../api/client.js";
import { createRoutes } from "../router.js";

const sections = [
  {
    id: "d9428888-122b-41e1-985c-61cd3cbb3210",
    name: "Biology",
    createdAtMs: 1_000,
    counts: { total: 12, new: 4, dueNow: 3 },
    nextDueAtMs: null,
  },
];
const waitingReview: ReviewPageState = {
  kind: "waiting",
  nextDueAtMs: null,
  session: {
    id: "c9f65aa8-122b-41e1-985c-61cd3cbb3210",
    sectionId: sections[0]!.id,
    status: "waiting",
    revision: 1,
    completedAppearances: 0,
    currentlyRemaining: 0,
    newRemaining: 0,
    repeatedWithinSession: 0,
    elapsedActiveMs: 0,
    newlyJoined: 0,
    nextDueAtMs: null,
    remainingSnapshotAtMs: 1_000,
  },
};

async function renderHome(
  post: ApiClient["post"] = async <T,>() => ({}) as T,
) {
  const i18n = await createI18n("en");
  const api: ApiClient = {
    bootstrap: async () => ({
      apiVersion: 1,
      csrfToken: "test-token",
      locale: "en",
    }),
    get: async <T,>(path: string) =>
      (path.startsWith("/api/v1/review-sessions/")
        ? waitingReview
        : sections) as T,
    post,
  };
  const router = createMemoryRouter(createRoutes({ api, i18n }), {
    initialEntries: ["/"],
  });
  const result = render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { level: 1, name: "Learning sections" });
  return { ...result, router };
}

describe("HomePage accessibility", () => {
  it("has one main landmark, one h1, a skip link, and enabled review controls", async () => {
    const { container } = await renderHome();

    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Skip to main content").getAttribute("href")).toBe(
      "#main-content",
    );

    const reviewButton = screen.getByRole("button", {
      name: "Start review",
    }) as HTMLButtonElement;
    expect(reviewButton.disabled).toBe(false);
    expect(reviewButton.getAttribute("aria-describedby")).toBeNull();

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("heading", {
          level: 1,
          name: "Learning sections",
        }),
      );
    });

    const results = await axe.run(container, {
      rules: {
        // jsdom has no canvas-backed color computation; Playwright covers it.
        "color-contrast": { enabled: false },
      },
    });
    expect(
      results.violations.filter(
        (violation) =>
          violation.impact === "serious" || violation.impact === "critical",
      ),
    ).toEqual([]);
  });

  it("focuses a persistent summary when section creation fails", async () => {
    const user = userEvent.setup();
    await renderHome(async () => {
      throw new ApiClientError(400, {
        code: "VALIDATION_ERROR",
        messageKey: "error.validation",
        fieldErrors: [
          { path: "/name", messageKey: "error.field.invalid" },
        ],
      });
    });

    await user.type(screen.getByLabelText("Section name"), "Invalid");
    await user.click(screen.getByRole("button", { name: "Create section" }));

    const summary = await screen.findByRole("alert");
    expect(summary.getAttribute("tabindex")).toBe("-1");
    await waitFor(() => {
      expect(document.activeElement).toBe(summary);
    });
    expect(summary.textContent).toContain(
      "Please correct the following errors.",
    );
  });

  it("opens an existing review session and announces the conflict safely", async () => {
    const user = userEvent.setup();
    const { router } = await renderHome(async () => {
      throw new ApiClientError(409, {
        code: "OPEN_REVIEW_SESSION_EXISTS",
        messageKey: "review.openSessionExists",
        sessionId: waitingReview.session.id,
        sectionId: waitingReview.session.sectionId,
      } as never);
    });

    await user.click(screen.getByRole("button", { name: "Start review" }));

    await screen.findByRole("heading", {
      level: 1,
      name: "No cards are due now",
    });
    expect(router.state.location.pathname).toBe(
      `/review/${waitingReview.session.id}`,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Your existing review session was opened.",
    );
  });

  it("sets the document language and direction from the active locale", async () => {
    const i18n = await createI18n("ar");
    const api: ApiClient = {
      bootstrap: async () => ({
        apiVersion: 1,
        csrfToken: "test-token",
        locale: "ar",
      }),
      get: async <T,>() => [] as T,
      post: async <T,>() => ({}) as T,
    };
    const router = createMemoryRouter(createRoutes({ api, i18n }), {
      initialEntries: ["/"],
    });
    render(<RouterProvider router={router} />);

    await screen.findByRole("heading", { level: 1, name: "الأقسام التعليمية" });
    await waitFor(() => {
      expect(document.documentElement.lang).toBe("ar");
      expect(document.documentElement.dir).toBe("rtl");
    });
  });
});
