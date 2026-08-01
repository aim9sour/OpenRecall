import { createI18n } from "@openrecall/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  type ApiClient,
} from "../api/client.js";
import { I18nProvider } from "../app/I18nProvider.js";
import { LanguageSettingsPanel } from "./LanguageSettingsPanel.js";

type PutImplementation = (
  path: string,
  body: unknown,
) => Promise<unknown>;

function api(put: PutImplementation): ApiClient {
  return {
    bootstrap: async () => ({
      apiVersion: 1,
      csrfToken: "token",
      databaseRevision: 1,
      locale: "en",
      localeUpdatedAtMs: 1_500,
    }),
    get: async <T,>() => ({}) as T,
    post: async <T,>() => ({}) as T,
    put: async <T,>(path: string, body: unknown) =>
      (await put(path, body)) as T,
    delete: async <T,>() => ({}) as T,
  };
}

async function renderPanel(put: PutImplementation) {
  const i18n = await createI18n("en");
  const result = render(
    <I18nProvider i18n={i18n}>
      <LanguageSettingsPanel
        api={api(put)}
        initial={{ locale: "en", updatedAtMs: 1_500 }}
      />
    </I18nProvider>,
  );
  return { ...result, i18n };
}

describe("LanguageSettingsPanel", () => {
  beforeEach(() => localStorage.clear());

  it("saves a supported language, switches immediately, and focuses its status", async () => {
    const user = userEvent.setup();
    const put = vi.fn(async () => ({ locale: "ar", updatedAtMs: 1_501 }));
    await renderPanel(put);

    expect(screen.getByRole("option", { name: "العربية" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "English" })).not.toBeNull();
    await user.selectOptions(screen.getByLabelText("Language"), "ar");
    await user.click(
      screen.getByRole("button", { name: "Save language" }),
    );

    expect(put).toHaveBeenCalledWith(
      "/api/v1/application-settings/locale",
      { locale: "ar", expectedUpdatedAtMs: 1_500 },
    );
    const status = await screen.findByRole("status");
    expect(document.activeElement).toBe(status);
    expect(status.textContent).toBe("تم حفظ اللغة.");
    expect(document.documentElement.dir).toBe("rtl");
    expect(localStorage.getItem("openrecall.locale")).toBe("ar");

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "openrecall.locale",
        newValue: "en",
        storageArea: localStorage,
      }),
    );
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Language") as HTMLSelectElement).value,
      ).toBe("en");
      expect(screen.getByRole("status").textContent).toBe(
        "Language saved.",
      );
      expect(document.documentElement.dir).toBe("ltr");
    });
  });

  it("keeps the draft and focuses an error without changing language when saving fails", async () => {
    const user = userEvent.setup();
    const put = vi.fn(async () => {
      throw new Error("offline");
    });
    const { i18n } = await renderPanel(put);

    await user.selectOptions(screen.getByLabelText("Language"), "ar");
    await user.click(
      screen.getByRole("button", { name: "Save language" }),
    );

    const alert = await screen.findByRole("alert");
    expect(document.activeElement).toBe(alert);
    expect(
      (screen.getByLabelText("Language") as HTMLSelectElement).value,
    ).toBe("ar");
    expect(i18n.language).toBe("en");
    expect(localStorage.getItem("openrecall.locale")).toBeNull();
  });

  it("adopts a conflict revision while preserving the selected draft for retry", async () => {
    const user = userEvent.setup();
    const put = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiClientError(409, {
          code: "APPLICATION_SETTING_CONFLICT",
          messageKey: "settings.language.conflict",
          current: { locale: "en", updatedAtMs: 1_600 },
        } as never),
      )
      .mockResolvedValueOnce({ locale: "ar", updatedAtMs: 1_601 });
    await renderPanel(put);

    await user.selectOptions(screen.getByLabelText("Language"), "ar");
    await user.click(
      screen.getByRole("button", { name: "Save language" }),
    );

    const alert = await screen.findByRole("alert");
    expect(document.activeElement).toBe(alert);
    expect(
      (screen.getByLabelText("Language") as HTMLSelectElement).value,
    ).toBe("ar");

    await user.click(
      screen.getByRole("button", { name: "Save language" }),
    );
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put).toHaveBeenLastCalledWith(
      "/api/v1/application-settings/locale",
      { locale: "ar", expectedUpdatedAtMs: 1_600 },
    );
  });
});
