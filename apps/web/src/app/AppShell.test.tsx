import { createI18n } from "@openrecall/i18n";
import {
  act,
  render,
  screen,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "../api/client.js";
import { AppShell } from "./AppShell.js";
import { I18nProvider } from "./I18nProvider.js";
import {
  beginMaintenanceNavigationBlock,
  endMaintenanceNavigationBlock,
} from "./maintenance-events.js";
import { ThemeProvider } from "./ThemeProvider.js";

describe("AppShell maintenance navigation", () => {
  it("removes primary links from navigation until database replacement settles", async () => {
    const user = userEvent.setup();
    const i18n = await createI18n("en");
    const api = {
      get: async () => ({ theme: "system", updatedAtMs: 0 }),
    } as unknown as ApiClient;
    render(
      <I18nProvider i18n={i18n}>
        <ThemeProvider api={api}>
          <MemoryRouter initialEntries={["/settings"]}>
            <Routes>
              <Route element={<AppShell />}>
                <Route
                  path="settings"
                  element={<h1 data-route-heading>Settings marker</h1>}
                />
                <Route
                  index
                  element={<h1 data-route-heading>Home marker</h1>}
                />
              </Route>
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </I18nProvider>,
    );
    const home = screen.getByRole("link", {
      name: "Home",
    }) as HTMLAnchorElement;

    act(() => beginMaintenanceNavigationBlock());
    expect(home.getAttribute("aria-disabled")).toBe("true");
    expect(home.tabIndex).toBe(-1);
    await user.click(home);
    expect(
      screen.getByRole("heading", { name: "Settings marker" }),
    ).not.toBeNull();

    act(() => endMaintenanceNavigationBlock());
    expect(home.hasAttribute("aria-disabled")).toBe(false);
    expect(home.tabIndex).toBe(0);
    await user.click(home);
    expect(
      screen.getByRole("heading", { name: "Home marker" }),
    ).not.toBeNull();
  });
});
