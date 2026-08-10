import type { OptimizerScope, SettingsView } from "@openrecall/contracts";
import { createI18n } from "@openrecall/i18n";
import { act, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client.js";
import { createRoutes } from "../router.js";

vi.mock("../settings/StepRecommendationPanel.js", () => ({
  StepRecommendationPanel: ({
    onSettingsChanged,
    scope,
  }: {
    readonly onSettingsChanged: (scope: OptimizerScope) => Promise<void>;
    readonly scope: OptimizerScope;
  }) => (
    <button
      onClick={() => void onSettingsChanged(scope)}
      type="button"
    >
      Refresh scheduler settings
    </button>
  ),
}));

const sectionId = "d9428888-122b-41e1-985c-61cd3cbb3210";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function settingsView(
  requestedRetention: number,
  scopeType: "global" | "section",
): SettingsView {
  const settings = {
    requestedRetention,
    maximumIntervalDays: 36_500,
    enableFuzz: false,
    enableShortTerm: true,
    learningStepsMinutes: [1, 10],
    relearningStepsMinutes: [10],
  };
  return {
    manifest: {
      algorithmId: "FSRS-6",
      algorithmVersion: "6.0",
      upstreamPackage: "scheduler-package@current",
      adapterVersion: 1,
      controls: [{
        key: "requestedRetention",
        kind: "number",
        labelKey: "settings.scheduler.requestedRetention.label",
        descriptionKey: "settings.scheduler.requestedRetention.description",
        defaultValue: 0.9,
        min: 0.8,
        max: 0.95,
        step: 0.01,
        deprecated: false,
      }],
    },
    defaults: settings,
    selectedScope: {
      scopeType,
      sectionId: scopeType === "section" ? sectionId : null,
    },
    savedOverride: null,
    effective: {
      settings,
      settingsSource: {
        kind: "adapter-default",
        settingsId: null,
        updatedAtMs: null,
      },
      parameterSource: {
        kind: "official",
        profileId: "official-fsrs6-v1",
        eligibleExampleCount: 0,
      },
    },
  };
}

describe("SettingsPage refresh isolation", () => {
  it("rejects an old refresh after navigating away and back to the same scope", async () => {
    const user = userEvent.setup();
    const delayedGlobalRefresh = deferred<SettingsView>();
    let globalSettingsRequests = 0;
    const api: ApiClient = {
      bootstrap: async () => ({
        apiVersion: 1,
        csrfToken: "token",
        databaseRevision: 1,
        locale: "en",
        localeUpdatedAtMs: 0,
      }),
      get: async <T,>(path: string) => {
        if (path === "/api/v1/sections") {
          return [{
            id: sectionId,
            name: "Biology",
            createdAtMs: 0,
            counts: { total: 0, new: 0, dueNow: 0 },
            nextDueAtMs: null,
          }] as T;
        }
        if (path === "/api/v1/settings/appearance") {
          return { theme: "system", updatedAtMs: 0 } as T;
        }
        if (path === "/api/v1/settings") {
          globalSettingsRequests += 1;
          if (globalSettingsRequests === 1) {
            return settingsView(0.9, "global") as T;
          }
          if (globalSettingsRequests === 2) {
            return delayedGlobalRefresh.promise as T;
          }
          return settingsView(0.92, "global") as T;
        }
        if (path === `/api/v1/settings?sectionId=${sectionId}`) {
          return settingsView(0.94, "section") as T;
        }
        throw new Error("OPTIONAL_PANEL_UNAVAILABLE");
      },
      patch: async <T,>() => ({}) as T,
      post: async <T,>() => ({}) as T,
      put: async <T,>() => ({}) as T,
      delete: async <T,>() => ({}) as T,
    };
    const i18n = await createI18n("en");
    const router = createMemoryRouter(createRoutes({ api, i18n }), {
      initialEntries: ["/settings"],
    });
    render(<RouterProvider router={router} />);

    const retention = await screen.findByRole("spinbutton", {
      name: "Requested retention",
    });
    expect((retention as HTMLInputElement).value).toBe("0.9");
    await user.click(screen.getByRole("button", {
      name: "Refresh scheduler settings",
    }));
    await act(async () => {
      await router.navigate(`/settings?sectionId=${sectionId}`);
    });
    await waitFor(() => expect((screen.getByRole("spinbutton", {
      name: "Requested retention",
    }) as HTMLInputElement).value).toBe("0.94"));
    await act(async () => {
      await router.navigate("/settings");
    });
    await waitFor(() => expect((screen.getByRole("spinbutton", {
      name: "Requested retention",
    }) as HTMLInputElement).value).toBe("0.92"));

    await act(async () => delayedGlobalRefresh.resolve(
      settingsView(0.81, "global"),
    ));
    await waitFor(() => expect((screen.getByRole("spinbutton", {
      name: "Requested retention",
    }) as HTMLInputElement).value).toBe("0.92"));
  });
});
