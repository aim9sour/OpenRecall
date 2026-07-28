import type {
  OptimizerEligibility,
  SectionSummary,
  SettingsView,
} from "@openrecall/contracts";
import { useEffect, useState } from "react";
import { Form, useLoaderData, useLocation } from "react-router";
import type { ApiClient } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";
import { SchedulerSettingsForm } from "../settings/SchedulerSettingsForm.js";
import { OptimizerPanel } from "../settings/OptimizerPanel.js";

export interface SettingsPageData {
  readonly sections: readonly SectionSummary[];
  readonly optimizerEligibility: OptimizerEligibility;
  readonly view: SettingsView;
}

export function SettingsPage({ api }: { readonly api: ApiClient }) {
  const loaded = useLoaderData() as SettingsPageData;
  const location = useLocation();
  const { t } = useI18n();
  const [view, setView] = useState(loaded.view);
  const selectedSectionId =
    new URLSearchParams(location.search).get("sectionId") ?? "";

  useEffect(() => {
    setView(loaded.view);
  }, [loaded.view]);

  return (
    <>
      <h1 data-route-heading tabIndex={-1}>
        {t("settings.title")}
      </h1>

      <Form className="panel" key={location.search} method="get">
        <label htmlFor="settings-scope">{t("settings.scope")}</label>
        <select
          defaultValue={selectedSectionId}
          id="settings-scope"
          name="sectionId"
        >
          <option value="">{t("settings.global")}</option>
          {loaded.sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.name}
            </option>
          ))}
        </select>
        <button type="submit">{t("settings.chooseScope")}</button>
      </Form>

      <SchedulerSettingsForm
        api={api}
        onViewChange={setView}
        view={view}
      />
      <OptimizerPanel
        api={api}
        initialEligibility={loaded.optimizerEligibility}
      />
    </>
  );
}
