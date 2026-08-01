import type { SectionSummary } from "@openrecall/contracts";
import { createI18n } from "@openrecall/i18n";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError, type ApiClient } from "../api/client.js";
import { I18nProvider } from "../app/I18nProvider.js";
import { SectionManagementPanel } from "./SectionManagementPanel.js";

const section: SectionSummary = {
  id: "d9428888-122b-41e1-985c-61cd3cbb3210",
  name: "Biology",
  createdAtMs: 1_000,
  updatedAtMs: 1_500,
  counts: { total: 3, new: 1, dueNow: 1 },
  nextDueAtMs: 2_000,
};

function api(options: {
  patch?: (path: string, body: unknown) => Promise<unknown>;
  remove?: (path: string, body: unknown) => Promise<unknown>;
}): ApiClient {
  return {
    bootstrap: async () => ({
      apiVersion: 1,
      csrfToken: "token",
      databaseRevision: 1,
      locale: "en",
      localeUpdatedAtMs: 0,
    }),
    get: async <T,>() => ({}) as T,
    patch: async <T,>(path: string, body: unknown) =>
      (await options.patch?.(path, body)) as T,
    post: async <T,>() => ({}) as T,
    put: async <T,>() => ({}) as T,
    delete: async <T,>(path: string, body: unknown) =>
      (await options.remove?.(path, body)) as T,
  };
}

async function renderPanel(options: {
  patch?: (path: string, body: unknown) => Promise<unknown>;
  remove?: (path: string, body: unknown) => Promise<unknown>;
}) {
  const i18n = await createI18n("en");
  const onRenamed = vi.fn();
  const onDeleted = vi.fn();
  render(
    <I18nProvider i18n={i18n}>
      <SectionManagementPanel
        api={api(options)}
        section={section}
        onRenamed={onRenamed}
        onDeleted={onDeleted}
      />
    </I18nProvider>,
  );
  return { onDeleted, onRenamed };
}

describe("SectionManagementPanel", () => {
  it("renames with the current revision and focuses the success status", async () => {
    const user = userEvent.setup();
    const renamed = { ...section, name: "Human Biology", updatedAtMs: 1_501 };
    const patch = vi.fn(async () => renamed);
    const { onRenamed } = await renderPanel({ patch });

    const input = screen.getByRole("textbox", { name: "Section name" });
    await user.clear(input);
    await user.type(input, "Human Biology");
    await user.click(screen.getByRole("button", { name: "Save new name" }));

    expect(patch).toHaveBeenCalledWith(`/api/v1/sections/${section.id}`, {
      name: "Human Biology",
      expectedUpdatedAtMs: section.updatedAtMs,
    });
    expect(onRenamed).toHaveBeenCalledWith(renamed);
    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Section name saved.");
    expect(document.activeElement).toBe(status);
  });

  it("rejects a whitespace name locally and focuses a linked error summary", async () => {
    const user = userEvent.setup();
    const patch = vi.fn(async () => section);
    await renderPanel({ patch });

    const input = screen.getByRole("textbox", { name: "Section name" });
    await user.clear(input);
    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: "Save new name" }));

    const alert = await screen.findByRole("alert");
    expect(document.activeElement).toBe(alert);
    expect(alert.textContent).toContain("Enter a valid section name.");
    expect(patch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("link", { name: "Enter a valid section name." }));
    expect(document.activeElement).toBe(input);
    await user.type(input, "B");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("adopts a rename conflict revision while preserving the user's draft", async () => {
    const user = userEvent.setup();
    const current = { ...section, name: "Biology 2", updatedAtMs: 1_600 };
    const renamed = { ...current, name: "My draft", updatedAtMs: 1_601 };
    const patch = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiClientError(409, {
          code: "SECTION_CONFLICT",
          messageKey: "section.rename.conflict",
          current,
        } as never),
      )
      .mockResolvedValueOnce(renamed);
    const { onRenamed } = await renderPanel({ patch });

    const input = screen.getByRole("textbox", { name: "Section name" });
    await user.clear(input);
    await user.type(input, "My draft");
    await user.click(screen.getByRole("button", { name: "Save new name" }));

    expect(document.activeElement).toBe(await screen.findByRole("alert"));
    expect((input as HTMLInputElement).value).toBe("My draft");
    expect(onRenamed).toHaveBeenCalledWith(current);

    await user.click(screen.getByRole("button", { name: "Save new name" }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    expect(patch).toHaveBeenLastCalledWith(`/api/v1/sections/${section.id}`, {
      name: "My draft",
      expectedUpdatedAtMs: current.updatedAtMs,
    });
  });

  it("requires the native checkbox and prevents duplicate permanent deletion", async () => {
    const user = userEvent.setup();
    let finishDelete!: () => void;
    const remove = vi.fn(
      () => new Promise<void>((resolve) => { finishDelete = resolve; }),
    );
    const { onDeleted } = await renderPanel({ remove });

    const checkbox = screen.getByRole("checkbox", {
      name: "I understand that this section will be permanently deleted",
    });
    const button = screen.getByRole("button", {
      name: "Permanently delete section",
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);

    await user.click(checkbox);
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await user.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button);
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(`/api/v1/sections/${section.id}`, {
      confirmed: true,
      expectedUpdatedAtMs: section.updatedAtMs,
    });

    finishDelete();
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  });

  it("requires reconfirmation after a delete conflict and recovers on retry", async () => {
    const user = userEvent.setup();
    const current = { ...section, name: "Biology 2", updatedAtMs: 1_700 };
    const remove = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiClientError(409, {
          code: "SECTION_CONFLICT",
          messageKey: "section.delete.conflict",
          current,
        } as never),
      )
      .mockResolvedValueOnce(undefined);
    const { onDeleted, onRenamed } = await renderPanel({ remove });
    const checkbox = screen.getByRole("checkbox", {
      name: "I understand that this section will be permanently deleted",
    });

    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: "Permanently delete section" }));
    expect(document.activeElement).toBe(await screen.findByRole("alert"));
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(onRenamed).toHaveBeenCalledWith(current);

    await user.click(checkbox);
    expect(document.activeElement).toBe(checkbox);
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Permanently delete section" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(remove).toHaveBeenLastCalledWith(`/api/v1/sections/${section.id}`, {
      confirmed: true,
      expectedUpdatedAtMs: current.updatedAtMs,
    });
  });

  it("counts Unicode code points consistently with the repository", async () => {
    const user = userEvent.setup();
    const unicodeName = "😀".repeat(200);
    const renamed = { ...section, name: unicodeName, updatedAtMs: 1_501 };
    const patch = vi.fn(async () => renamed);
    await renderPanel({ patch });
    const input = screen.getByRole("textbox", { name: "Section name" });

    fireEvent.change(input, { target: { value: unicodeName } });
    await user.click(screen.getByRole("button", { name: "Save new name" }));

    expect(patch).toHaveBeenCalledWith(`/api/v1/sections/${section.id}`, {
      name: unicodeName,
      expectedUpdatedAtMs: section.updatedAtMs,
    });
  });
});
