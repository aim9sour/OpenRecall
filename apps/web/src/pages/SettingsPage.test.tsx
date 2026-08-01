import { createI18n } from "@openrecall/i18n";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client.js";
import { createRoutes } from "../router.js";
import type { SettingsPageData } from "./SettingsPage.js";

describe("settings route", () => {
  it("loads the cached application locale preference once with the page data", async () => {
    const bootstrap = vi.fn(async () => ({
      apiVersion: 1 as const,
      csrfToken: "token",
      databaseRevision: 3,
      locale: "ar" as const,
      localeUpdatedAtMs: 1_500,
    }));
    const api: ApiClient = {
      bootstrap,
      get: async <T,>() => ({}) as T,
      patch: async <T,>() => ({}) as T,
      post: async <T,>() => ({}) as T,
      put: async <T,>() => ({}) as T,
      delete: async <T,>() => ({}) as T,
    };
    const routes = createRoutes({ api, i18n: await createI18n("en") });
    const settingsRoute = routes[0]?.children?.find(
      (route) => route.id === "settings",
    );
    expect(typeof settingsRoute?.loader).toBe("function");

    const loaded = (await (settingsRoute!.loader as Function)({
      request: new Request("http://openrecall.local/settings"),
      params: {},
    })) as SettingsPageData;

    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(loaded.localePreference).toEqual({
      locale: "ar",
      updatedAtMs: 1_500,
    });
  });
});
