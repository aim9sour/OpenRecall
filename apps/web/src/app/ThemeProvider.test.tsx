import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client.js";
import {
  ThemeProvider,
  useTheme,
} from "./ThemeProvider.js";

function apiWithTheme(theme: "system" | "light" | "dark") {
  const get = vi.fn().mockResolvedValue({ theme, updatedAtMs: 7 });
  const put = vi
    .fn()
    .mockImplementation(async (_path: string, body: unknown) => ({
      theme: (body as { theme: string }).theme,
      updatedAtMs: 8,
    }));
  return {
    api: { get, put } as unknown as ApiClient,
    get,
    put,
  };
}

function Controls() {
  const theme = useTheme();
  return (
    <>
      <output>{`${theme.preference}/${theme.resolved}`}</output>
      {(["system", "light", "dark"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => void theme.setPreference(value)}
        >
          {value}
        </button>
      ))}
    </>
  );
}

afterEach(() => {
  delete document.documentElement.dataset["theme"];
  document.documentElement.style.colorScheme = "";
  vi.unstubAllGlobals();
});

describe("ThemeProvider", () => {
  it("follows the system until overridden and persists the preference", async () => {
    let dark = false;
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: dark,
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        addEventListener: (
          _type: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => listeners.add(listener),
        removeEventListener: (
          _type: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => listeners.delete(listener),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    const user = userEvent.setup();
    const { api, put } = apiWithTheme("system");
    render(
      <ThemeProvider api={api}>
        <Controls />
      </ThemeProvider>,
    );

    await screen.findByText("system/light");
    expect(document.documentElement.dataset["theme"]).toBe("light");
    dark = true;
    for (const listener of listeners) {
      listener({ matches: true } as MediaQueryListEvent);
    }
    await screen.findByText("system/dark");

    await user.click(screen.getByRole("button", { name: "light" }));
    await screen.findByText("light/light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(put).toHaveBeenCalledWith(
      "/api/v1/settings/appearance",
      { expectedUpdatedAtMs: 7, theme: "light" },
    );
  });

  it("loads a saved choice on a new mount", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const { api, get } = apiWithTheme("dark");
    render(
      <ThemeProvider api={api}>
        <Controls />
      </ThemeProvider>,
    );

    await waitFor(() =>
      expect(document.documentElement.dataset["theme"]).toBe("dark"),
    );
    expect(screen.getByText("dark/dark")).not.toBeNull();
    expect(get).toHaveBeenCalledWith("/api/v1/settings/appearance");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
