import type { OptimizerSettingsView } from "@openrecall/contracts";
import { createI18n } from "@openrecall/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "../api/client.js";
import { I18nProvider } from "../app/I18nProvider.js";
import { OptimizerTrainingSettingsForm } from "./OptimizerTrainingSettingsForm.js";

const view: OptimizerSettingsView = {
  manifest: {
    upstreamPackage: "@open-spaced-repetition/binding",
    upstreamVersion: "0.5.0",
    fsrsCoreVersion: "FSRS-6",
    algorithmVersion: "6.0",
    adapterVersion: 2,
    schemaVersion: 1,
    controls: [
      { key: "numEpochs", labelKey: "settings.optimizer.numEpochs.label", descriptionKey: "settings.optimizer.numEpochs.description", choices: [3, 5, 7, 10], defaultValue: 5, deprecated: false },
      { key: "batchSize", labelKey: "settings.optimizer.batchSize.label", descriptionKey: "settings.optimizer.batchSize.description", choices: [128, 256, 512, 1024], defaultValue: 512, deprecated: false },
      { key: "maxSeqLen", labelKey: "settings.optimizer.maxSeqLen.label", descriptionKey: "settings.optimizer.maxSeqLen.description", choices: [64, 128, 256, 512], defaultValue: 256, deprecated: false },
    ],
    readOnly: { seed: 2023, learningRate: 0.04, gamma: 1 },
    capabilities: [],
  },
  defaults: { numEpochs: 5, batchSize: 512, maxSeqLen: 256 },
  selectedScope: { scopeType: "global", sectionId: null },
  savedOverride: {
    id: "optimizer-settings-global", scopeType: "global", sectionId: null,
    adapterVersion: 2, settings: { numEpochs: 5, batchSize: 512, maxSeqLen: 256 },
    createdAtMs: 0, updatedAtMs: 0,
  },
  effective: {
    settings: { numEpochs: 5, batchSize: 512, maxSeqLen: 256 },
    source: { kind: "global", settingsId: "optimizer-settings-global", updatedAtMs: 0 },
  },
};

describe("OptimizerTrainingSettingsForm", () => {
  it("isolates an unsupported optimizer manifest without rendering controls", async () => {
    const incompatibleView = {
      ...view,
      manifest: { ...view.manifest, schemaVersion: 2 },
    } as unknown as OptimizerSettingsView;
    const api = {
      bootstrap: async () => ({ apiVersion: 1 as const, csrfToken: "x", databaseRevision: 1, locale: "en" as const, localeUpdatedAtMs: 0 }),
      get: async <T,>() => ({}) as T,
      patch: async <T,>() => ({}) as T,
      post: async <T,>() => ({}) as T,
      put: async <T,>() => ({}) as T,
      delete: async <T,>() => ({}) as T,
    } satisfies ApiClient;

    render(<I18nProvider i18n={await createI18n("en")}><OptimizerTrainingSettingsForm api={api} onViewChange={() => undefined} view={incompatibleView} /></I18nProvider>);

    expect(screen.getByRole("alert").textContent).toContain("incompatible");
    expect(screen.queryByLabelText("Training epochs")).toBeNull();
  });

  it("renders manifest choices, previews exclusions, and saves a canonical draft", async () => {
    const user = userEvent.setup();
    const putCalls: Array<[string, unknown]> = [];
    const put: ApiClient["put"] = async <T,>(path: string, body: unknown) => {
      putCalls.push([path, body]);
      return view as T;
    };
    const api: ApiClient = {
      bootstrap: async () => ({ apiVersion: 1, csrfToken: "x", databaseRevision: 1, locale: "en", localeUpdatedAtMs: 0 }),
      get: async <T,>() => ({}) as T,
      patch: async <T,>() => ({}) as T,
      post: async <T,>() => ({ rawReviewCount: 500, otherwiseEligibleExampleCount: 420, excludedByMaxSeqLenCount: 20, eligibleExampleCount: 400, minimumEligibleExamples: 400, sourceReviewCutoffMs: 10, canTrain: true }) as T,
      put,
      delete: async <T,>() => ({}) as T,
    };
    render(<I18nProvider i18n={await createI18n("en")}><OptimizerTrainingSettingsForm api={api} onViewChange={() => undefined} view={view} /></I18nProvider>);
    expect(screen.getAllByRole("option")).toHaveLength(12);
    await waitFor(() => expect(screen.getByText("20")).toBeTruthy());
    await user.selectOptions(screen.getByLabelText("Training epochs"), "7");
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    expect(putCalls).toContainEqual(["/api/v1/settings/optimizer/global", {
      expectedUpdatedAtMs: 0,
      settings: { numEpochs: 7, batchSize: 512, maxSeqLen: 256 },
    }]);
  });
});
