import type {
  OptimizerEligibility,
  OptimizerProfile,
  SectionSummary,
  SettingsView,
} from "@openrecall/contracts";
import { useEffect, useState } from "react";
import { Form, useLoaderData, useLocation } from "react-router";
import type { ApiClient } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";
import { SchedulerSettingsForm } from "../settings/SchedulerSettingsForm.js";
import { BackupPanel } from "../settings/BackupPanel.js";
import { OptimizerPanel } from "../settings/OptimizerPanel.js";
import { ProfilePreview } from "../settings/ProfilePreview.js";
import { RestorePanel } from "../settings/RestorePanel.js";
import {
  LanguageSettingsPanel,
  type LocalePreferenceView,
} from "../settings/LanguageSettingsPanel.js";

export interface SettingsPageData {
  readonly localePreference: LocalePreferenceView;
  readonly sections: readonly SectionSummary[];
  readonly optimizerEligibility: OptimizerEligibility;
  readonly profiles: readonly OptimizerProfile[];
  readonly view: SettingsView;
}

export function SettingsPage({ api }: { readonly api: ApiClient }) {
  const loaded = useLoaderData() as SettingsPageData;
  const location = useLocation();
  const { t } = useI18n();
  const [view, setView] = useState(loaded.view);
  const selectedSectionId =
    new URLSearchParams(location.search).get("sectionId") ?? "";
  const selectableProfiles = loaded.profiles.filter((profile) => {
    if (profile.status === "active" || profile.scopeType === "official") {
      return false;
    }
    return selectedSectionId === ""
      ? profile.scopeType === "global"
      : profile.scopeType === "section" &&
          profile.sectionId === selectedSectionId;
  });

  useEffect(() => {
    setView(loaded.view);
  }, [loaded.view]);

  return (
    <>
      <h1 data-route-heading tabIndex={-1}>
        {t("settings.title")}
      </h1>

      <LanguageSettingsPanel
        api={api}
        initial={loaded.localePreference}
      />

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
      {selectableProfiles.length > 0 && (
        <section
          aria-labelledby="parameter-profile-history"
          className="panel"
        >
          <h2 id="parameter-profile-history">
            {t("optimizer.profiles.title")}
          </h2>
          <p>{t("optimizer.profiles.description")}</p>
          {selectableProfiles.map((profile) => (
            <article key={profile.id}>
              <h3>{profile.id}</h3>
              <p>
                {profile.status === "candidate"
                  ? t("optimizer.profiles.candidate")
                  : t("optimizer.profiles.previous")}
              </p>
              <ProfilePreview
                action={
                  profile.status === "candidate"
                    ? "apply"
                    : "rollback"
                }
                api={api}
                profileId={profile.id}
              />
            </article>
          ))}
        </section>
      )}
      <BackupPanel api={api} />
      <RestorePanel api={api} />
    </>
  );
}
