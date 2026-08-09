import type { SessionSummary as SessionSummaryValue } from "@openrecall/contracts";
import { createI18n } from "@openrecall/i18n";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../app/I18nProvider.js";
import { SessionSummary } from "./SessionSummary.js";
import { WaitingState } from "./WaitingState.js";

async function renderEnglish(node: React.ReactNode) {
  const i18n = await createI18n("en");
  return render(
    <I18nProvider i18n={i18n}>
      <MemoryRouter>{node}</MemoryRouter>
    </I18nProvider>,
  );
}

describe("WaitingState", () => {
  it("shows an exact next due instant or the absence of one", async () => {
    const { container, rerender } = await renderEnglish(
      <WaitingState
        nextDueAtMs={1_735_732_800_000}
        paused={false}
        onEnd={() => {}}
        onResume={() => {}}
      />,
    );

    const time = container.querySelector("time");
    if (time === null) {
      throw new Error("EXPECTED_TIME_ELEMENT");
    }
    expect(time.getAttribute("datetime")).toBe(
      "2025-01-01T12:00:00.000Z",
    );
    expect(time.textContent?.trim()).not.toBe("");

    const i18n = await createI18n("en");
    rerender(
      <I18nProvider i18n={i18n}>
        <MemoryRouter>
          <WaitingState
            nextDueAtMs={null}
            paused={false}
            onEnd={() => {}}
            onResume={() => {}}
          />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(screen.getByText("No future review is scheduled.")).not.toBeNull();
  });

  it("keeps a paused session resumable after a fresh render", async () => {
    const onResume = vi.fn();
    await renderEnglish(
      <WaitingState
        nextDueAtMs={2_000}
        paused
        onEnd={() => {}}
        onResume={onResume}
      />,
    );

    await userEvent.setup().click(
      screen.getByRole("button", { name: "Resume review" }),
    );
    expect(onResume).toHaveBeenCalledOnce();
  });
});

describe("SessionSummary", () => {
  it("shows immutable-log totals, rating distribution, and return links", async () => {
    const summary: SessionSummaryValue = {
      sessionId: "c9f65aa8-122b-41e1-985c-61cd3cbb3210",
      sectionId: "d9428888-122b-41e1-985c-61cd3cbb3210",
      completedAtMs: 2_000,
      reviewEvents: 5,
      uniqueItems: 3,
      repeatedWithinSession: 2,
      elapsedActiveMs: 12_000,
      ratingCounts: { again: 1, hard: 1, good: 2, easy: 1 },
    };
    await renderEnglish(<SessionSummary summary={summary} />);

    expect(screen.getByText("Review events").parentElement?.textContent).toContain(
      "5",
    );
    expect(screen.getByRole("table", { name: "Rating distribution" })).not.toBeNull();
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe(
      "/",
    );
    expect(
      screen.getByRole("link", { name: "Back to section" }).getAttribute("href"),
    ).toBe(`/sections/${summary.sectionId}`);
  });
});
