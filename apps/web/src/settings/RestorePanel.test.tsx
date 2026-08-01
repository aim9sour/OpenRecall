import { createI18n } from "@openrecall/i18n";
import {
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  type ApiClient,
} from "../api/client.js";
import { I18nProvider } from "../app/I18nProvider.js";
import {
  MAINTENANCE_NAVIGATION_END,
  MAINTENANCE_NAVIGATION_START,
} from "../app/maintenance-events.js";
import { RestorePanel } from "./RestorePanel.js";

function client(
  restore: NonNullable<ApiClient["restore"]>,
): ApiClient {
  return {
    bootstrap: async () => ({
      apiVersion: 1,
      csrfToken: "token",
      databaseRevision: 1,
      locale: "en",
      localeUpdatedAtMs: 0,
    }),
    get: async <T,>() => ({}) as T,
    patch: async <T,>() => ({}) as T,
    post: async <T,>() => ({}) as T,
    put: async <T,>() => ({}) as T,
    delete: async <T,>() => ({}) as T,
    restore,
  };
}

async function renderPanel(api: ApiClient) {
  const i18n = await createI18n("en");
  return render(
    <I18nProvider i18n={i18n}>
      <RestorePanel api={api} />
    </I18nProvider>,
  );
}

describe("RestorePanel", () => {
  it("requires file review and explicit confirmation, blocks navigation, and focuses success", async () => {
    const user = userEvent.setup();
    let complete:
      | ((value: {
          databaseRevision: number;
          restoredUserVersion: number;
          preRestoreBackupFilename: string;
        }) => void)
      | undefined;
    const restore = vi.fn(
      () =>
        new Promise<{
          databaseRevision: number;
          restoredUserVersion: number;
          preRestoreBackupFilename: string;
        }>((resolve) => {
          complete = resolve;
        }),
    );
    const started = vi.fn();
    const ended = vi.fn();
    window.addEventListener(MAINTENANCE_NAVIGATION_START, started);
    window.addEventListener(MAINTENANCE_NAVIGATION_END, ended);
    const { container } = await renderPanel(client(restore));

    try {
      const file = new File(
        ["SQLite format 3\u0000"],
        "openrecall-backup.sqlite3",
        { type: "application/vnd.sqlite3" },
      );
      await user.upload(
        screen.getByLabelText("SQLite backup file"),
        file,
      );
      expect(
        screen.getByText("File: openrecall-backup.sqlite3"),
      ).not.toBeNull();
      const action = screen.getByRole("button", {
        name: "Restore this backup",
      }) as HTMLButtonElement;
      expect(action.disabled).toBe(true);
      await user.click(
        screen.getByRole("checkbox", {
          name: /current database will be replaced/i,
        }),
      );
      expect(action.disabled).toBe(false);
      await user.click(action);

      expect(started).toHaveBeenCalledOnce();
      expect(ended).not.toHaveBeenCalled();
      expect(restore).toHaveBeenCalledWith(file, 1);
      expect(
        (
          screen.getByRole("button", {
            name: "Restoring database…",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);

      complete?.({
        databaseRevision: 2,
        restoredUserVersion: 5,
        preRestoreBackupFilename: "safe.sqlite3",
      });
      const heading = await screen.findByRole("heading", {
        name: "Database restored",
      });
      await waitFor(() =>
        expect(document.activeElement).toBe(heading),
      );
      expect(ended).toHaveBeenCalledOnce();
      expect(document.body.textContent).not.toContain("safe.sqlite3");

      const results = await axe.run(container, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(
        results.violations.filter(
          ({ impact }) =>
            impact === "serious" || impact === "critical",
        ),
      ).toEqual([]);
    } finally {
      window.removeEventListener(
        MAINTENANCE_NAVIGATION_START,
        started,
      );
      window.removeEventListener(MAINTENANCE_NAVIGATION_END, ended);
    }
  });

  it("focuses a safe failure and rejects an invalid local file before upload", async () => {
    const user = userEvent.setup();
    const restore = vi.fn(async () => {
      throw new ApiClientError(400, {
        code: "RESTORE_FILE_INVALID",
        messageKey: "restore.invalid",
      });
    });
    await renderPanel(client(restore));

    await user.upload(
      screen.getByLabelText("SQLite backup file"),
      new File(["not sqlite"], "notes.txt", {
        type: "application/vnd.sqlite3",
      }),
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Choose a non-empty file whose name ends in .sqlite3.",
    );
    expect(restore).not.toHaveBeenCalled();

    const valid = new File(
      ["SQLite format 3\u0000"],
      "backup.sqlite3",
    );
    await user.upload(
      screen.getByLabelText("SQLite backup file"),
      valid,
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /current database will be replaced/i,
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Restore this backup",
      }),
    );

    const heading = await screen.findByRole("heading", {
      name: "Database not restored",
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(heading),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "This is not a valid OpenRecall SQLite backup.",
    );
    expect(document.body.textContent).not.toContain(
      "RESTORE_FILE_INVALID",
    );
  });
});
