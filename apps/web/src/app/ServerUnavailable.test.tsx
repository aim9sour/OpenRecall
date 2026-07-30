import { createI18n } from "@openrecall/i18n";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "./I18nProvider.js";
import { ServerUnavailable } from "./ServerUnavailable.js";

describe("ServerUnavailable", () => {
  it("shows the fixed local URL, startup help, and a working retry", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const i18n = await createI18n("en");
    render(
      <I18nProvider i18n={i18n}>
        <ServerUnavailable onRetry={retry} />
      </I18nProvider>,
    );

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "OpenRecall server is stopped",
      }),
    ).not.toBeNull();
    expect(screen.getByText("http://127.0.0.1:3210")).not.toBeNull();
    expect(
      screen
        .getByRole("link", { name: "How to start OpenRecall" })
        .getAttribute("href"),
    ).toBe("#startup-instructions");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
