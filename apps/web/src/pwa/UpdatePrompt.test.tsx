import { createI18n } from "@openrecall/i18n";
import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../app/I18nProvider.js";
import { createServiceWorkerUpdateController } from "./register-service-worker.js";
import { UpdatePrompt } from "./UpdatePrompt.js";

async function promptHarness() {
  let needRefresh: (() => void) | undefined;
  const activate = vi.fn(async () => undefined);
  const controller = createServiceWorkerUpdateController(
    (options) => {
      needRefresh = options.onNeedRefresh;
      return activate;
    },
  );
  const i18n = await createI18n("en");
  return { activate, controller, i18n, showUpdate: () => needRefresh?.() };
}

describe("UpdatePrompt", () => {
  it("announces politely, defers without activation, and updates once when safe", async () => {
    const user = userEvent.setup();
    const harness = await promptHarness();
    render(
      <I18nProvider i18n={harness.i18n}>
        <UpdatePrompt
          activeReview={false}
          controller={harness.controller}
        />
      </I18nProvider>,
    );
    act(() => harness.showUpdate());

    const announcement = screen.getByRole("status");
    expect(announcement.getAttribute("aria-live")).toBe("polite");
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(harness.activate).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();

    act(() => harness.showUpdate());
    await user.click(
      screen.getByRole("button", { name: "Update now" }),
    );
    expect(harness.activate).toHaveBeenCalledOnce();
  });

  it("blocks activation during a review or a dirty editor", async () => {
    const user = userEvent.setup();
    const harness = await promptHarness();
    const { rerender } = render(
      <I18nProvider i18n={harness.i18n}>
        <UpdatePrompt
          activeReview
          controller={harness.controller}
        />
      </I18nProvider>,
    );
    act(() => harness.showUpdate());

    await user.click(
      screen.getByRole("button", { name: "Update now" }),
    );
    expect(harness.activate).not.toHaveBeenCalled();
    expect(screen.getByText(/finish or pause/i)).not.toBeNull();

    rerender(
      <I18nProvider i18n={harness.i18n}>
        <form data-openrecall-dirty="true">
          <UpdatePrompt
            activeReview={false}
            controller={harness.controller}
          />
        </form>
      </I18nProvider>,
    );
    await user.click(
      screen.getByRole("button", { name: "Update now" }),
    );
    expect(harness.activate).not.toHaveBeenCalled();

    rerender(
      <I18nProvider i18n={harness.i18n}>
        <UpdatePrompt
          activeReview={false}
          controller={harness.controller}
        />
      </I18nProvider>,
    );
    await user.click(
      screen.getByRole("button", { name: "Update now" }),
    );
    expect(harness.activate).toHaveBeenCalledOnce();
  });
});
