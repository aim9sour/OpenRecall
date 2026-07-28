import { createI18n } from "@openrecall/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client.js";
import { I18nProvider } from "../app/I18nProvider.js";
import { BackupPanel } from "./BackupPanel.js";

function api(
  download: NonNullable<ApiClient["download"]>,
): ApiClient {
  return {
    bootstrap: async () => ({
      apiVersion: 1,
      csrfToken: "token",
      locale: "en",
    }),
    get: async <T,>() => ({}) as T,
    post: async <T,>() => ({}) as T,
    put: async <T,>() => ({}) as T,
    delete: async <T,>() => ({}) as T,
    download,
  };
}

async function renderPanel(
  client: ApiClient,
  saveFile = vi.fn(),
) {
  const i18n = await createI18n("en");
  const result = render(
    <I18nProvider i18n={i18n}>
      <BackupPanel api={client} saveFile={saveFile} />
    </I18nProvider>,
  );
  return { ...result, saveFile };
}

describe("BackupPanel", () => {
  it("downloads through a native button and announces success without a server path", async () => {
    const user = userEvent.setup();
    const blob = new Blob(["SQLite format 3\u0000"]);
    const download = vi.fn(async () => ({
      blob,
      filename: "openrecall-manual-8000-safe.sqlite3",
    }));
    const { container, saveFile } = await renderPanel(api(download));

    const button = screen.getByRole("button", {
      name: "Download SQLite backup",
    });
    button.focus();
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(saveFile).toHaveBeenCalledWith(
        blob,
        "openrecall-manual-8000-safe.sqlite3",
      ),
    );
    expect(screen.getByRole("status").textContent).toBe(
      "SQLite backup downloaded.",
    );
    expect(document.body.textContent).not.toMatch(/[A-Z]:\\|\/tmp\//);

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      results.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);
  });

  it("announces a safe failure and remains retryable", async () => {
    const user = userEvent.setup();
    const download = vi.fn(async () => {
      throw new Error("PRIVATE_SERVER_PATH");
    });
    await renderPanel(api(download));

    await user.click(
      screen.getByRole("button", {
        name: "Download SQLite backup",
      }),
    );
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toBe(
      "The backup could not be downloaded.",
    );
    expect(document.body.textContent).not.toContain("PRIVATE_SERVER_PATH");
    expect(
      (
        screen.getByRole("button", {
          name: "Download SQLite backup",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});
