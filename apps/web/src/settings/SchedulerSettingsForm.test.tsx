import type {
  SchedulerSettings,
  SettingsView,
} from "@openrecall/contracts";
import { createI18n } from "@openrecall/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client.js";
import { I18nProvider } from "../app/I18nProvider.js";
import { SchedulerSettingsForm } from "./SchedulerSettingsForm.js";

const sectionId = "d9428888-122b-41e1-985c-61cd3cbb3210";
const defaults: SchedulerSettings = {
  requestedRetention: 0.9,
  maximumIntervalDays: 36_500,
  enableFuzz: false,
  enableShortTerm: true,
  learningStepsMinutes: [1, 10],
  relearningStepsMinutes: [10],
};
const controls: SettingsView["manifest"]["controls"] = [
  {
    key: "requestedRetention",
    kind: "number",
    labelKey: "settings.scheduler.requestedRetention.label",
    descriptionKey: "settings.scheduler.requestedRetention.description",
    defaultValue: 0.9,
    min: 0.8,
    max: 0.95,
    step: 0.01,
    deprecated: false,
  },
  {
    key: "maximumIntervalDays",
    kind: "integer",
    labelKey: "settings.scheduler.maximumIntervalDays.label",
    descriptionKey: "settings.scheduler.maximumIntervalDays.description",
    defaultValue: 36_500,
    min: 1,
    max: 36_500,
    step: 1,
    deprecated: false,
  },
  {
    key: "enableFuzz",
    kind: "boolean",
    labelKey: "settings.scheduler.enableFuzz.label",
    descriptionKey: "settings.scheduler.enableFuzz.description",
    defaultValue: false,
    deprecated: false,
  },
  {
    key: "enableShortTerm",
    kind: "boolean",
    labelKey: "settings.scheduler.enableShortTerm.label",
    descriptionKey: "settings.scheduler.enableShortTerm.description",
    defaultValue: true,
    deprecated: false,
  },
  {
    key: "learningStepsMinutes",
    kind: "steps",
    labelKey: "settings.scheduler.learningStepsMinutes.label",
    descriptionKey: "settings.scheduler.learningStepsMinutes.description",
    defaultValue: [1, 10],
    maxMinutes: 1_439,
    deprecated: false,
  },
  {
    key: "relearningStepsMinutes",
    kind: "steps",
    labelKey: "settings.scheduler.relearningStepsMinutes.label",
    descriptionKey: "settings.scheduler.relearningStepsMinutes.description",
    defaultValue: [10],
    maxMinutes: 1_439,
    deprecated: false,
  },
];

function view(
  scopeType: "global" | "section",
  hasOverride: boolean,
): SettingsView {
  return {
    manifest: {
      algorithmId: "FSRS-6",
      algorithmVersion: "6.0",
      upstreamPackage: "scheduler-package@current",
      adapterVersion: 1,
      controls,
    },
    defaults,
    selectedScope: {
      scopeType,
      sectionId: scopeType === "section" ? sectionId : null,
    },
    savedOverride: hasOverride
      ? {
          id: `${scopeType}-settings`,
          scopeType,
          sectionId: scopeType === "section" ? sectionId : null,
          adapterVersion: 1,
          settings: defaults,
          updatedAtMs: 10,
        }
      : null,
    effective: {
      settings: defaults,
      settingsSource:
        scopeType === "section"
          ? {
              kind: "global",
              settingsId: "global-settings",
              updatedAtMs: 0,
            }
          : {
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

function api(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    bootstrap: async () => ({
      apiVersion: 1,
      csrfToken: "token",
      databaseRevision: 1,
      locale: "en",
      localeUpdatedAtMs: 0,
    }),
    get: async <T,>() => ({}) as T,
    post: async <T,>() => ({}) as T,
    put: async <T,>() => ({}) as T,
    delete: async <T,>() => ({}) as T,
    ...overrides,
  };
}

async function renderForm(
  settingsView: SettingsView,
  client: ApiClient = api(),
) {
  const i18n = await createI18n("en");
  const onViewChange = vi.fn();
  const result = render(
    <I18nProvider i18n={i18n}>
      <SchedulerSettingsForm
        api={client}
        onViewChange={onViewChange}
        view={settingsView}
      />
    </I18nProvider>,
  );
  return { ...result, onViewChange };
}

describe("SchedulerSettingsForm", () => {
  it("renders translated manifest controls with native bounds and accessible errors", async () => {
    const user = userEvent.setup();
    const { container } = await renderForm(view("global", true));

    const retention = screen.getByRole("spinbutton", {
      name: "Requested retention",
    });
    expect(retention.getAttribute("min")).toBe("0.8");
    expect(retention.getAttribute("max")).toBe("0.95");
    expect(retention.getAttribute("step")).toBe("0.01");
    expect(
      screen.getByText(/Higher retention usually increases daily workload/),
    ).not.toBeNull();

    const learningSteps = screen.getByRole("textbox", {
      name: "Learning steps",
    });
    await user.clear(learningSteps);
    await user.type(learningSteps, "10, 1");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    const summary = await screen.findByRole("alert");
    expect(document.activeElement).toBe(summary);
    const errorLink = screen.getByRole("link", {
      name: "Learning steps: enter strictly increasing whole minutes.",
    });
    expect(errorLink.getAttribute("href")).toBe(
      "#setting-learningStepsMinutes",
    );
    await user.click(errorLink);
    expect(document.activeElement).toBe(learningSteps);

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      results.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);
  });

  it("states inheritance and reset deletes only the selected section override", async () => {
    const user = userEvent.setup();
    const inherited = view("section", false);
    const explicit = view("section", true);
    const deleteCalls: Array<{ path: string; body: unknown }> = [];
    const remove: ApiClient["delete"] = async <T,>(
      path: string,
      body: unknown,
    ) => {
      deleteCalls.push({ path, body });
      return inherited as T;
    };
    const { onViewChange, rerender } = await renderForm(
      inherited,
      api({ delete: remove }),
    );

    expect(
      screen.getByText("This section inherits the global scheduler settings."),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Reset section override" }),
    ).toBeNull();

    const i18n = await createI18n("en");
    rerender(
      <I18nProvider i18n={i18n}>
        <SchedulerSettingsForm
          api={api({ delete: remove })}
          onViewChange={onViewChange}
          view={explicit}
        />
      </I18nProvider>,
    );
    await user.click(
      screen.getByRole("button", { name: "Reset section override" }),
    );

    await waitFor(() =>
      expect(deleteCalls).toEqual([
        {
          path: `/api/v1/settings/scheduler/sections/${sectionId}`,
          body: { expectedUpdatedAtMs: 10 },
        },
      ]),
    );
    expect(onViewChange).toHaveBeenCalledWith(inherited);
  });
});
