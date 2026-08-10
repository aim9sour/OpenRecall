import type {
  OptimizerEligibility,
  OptimizerProfile,
  OptimizerSettingsView,
  OptimizerTechnicalInfo,
  SectionSummary,
  SettingsView,
} from "@openrecall/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLoaderData, useLocation, useNavigate } from "react-router";
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
import { DisclosureSection } from "../components/DisclosureSection.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { OptimizerTrainingSettingsForm } from "../settings/OptimizerTrainingSettingsForm.js";
import { TechnicalSettingsPanel } from "../settings/TechnicalSettingsPanel.js";

export interface SettingsPageData {
  readonly localePreference: LocalePreferenceView;
  readonly sections: readonly SectionSummary[];
  readonly optimizerEligibility: OptimizerEligibility;
  readonly profiles: readonly OptimizerProfile[];
  readonly optimizerView: OptimizerSettingsView;
  readonly technicalInfo: OptimizerTechnicalInfo;
  readonly view: SettingsView;
}

export function SettingsPage({ api }: { readonly api: ApiClient }) {
  const loaded = useLoaderData() as SettingsPageData;
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [view, setView] = useState(loaded.view);
  const [optimizerView, setOptimizerView] = useState(loaded.optimizerView);
  const [scopeDraft, setScopeDraft] = useState(() => new URLSearchParams(location.search).get("sectionId") ?? "");
  const [dirtyPanels, setDirtyPanels] = useState<Record<string, boolean>>({});
  const [pendingScope, setPendingScope] = useState<string | null>(null);
  const scopeButtonRef = useRef<HTMLButtonElement>(null);
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
    setOptimizerView(loaded.optimizerView);
    setScopeDraft(selectedSectionId);
    setDirtyPanels({});
  }, [loaded.optimizerView, loaded.view, selectedSectionId]);

  const goToScope = (sectionId: string) => {
    void navigate(sectionId === "" ? "/settings" : `/settings?sectionId=${encodeURIComponent(sectionId)}`);
  };
  const chooseScope = () => {
    if (Object.values(dirtyPanels).some(Boolean)) setPendingScope(scopeDraft);
    else goToScope(scopeDraft);
  };
  const handleDirtyChange = useCallback((panelId: string, dirty: boolean) => {
    setDirtyPanels((current) => current[panelId] === dirty ? current : { ...current, [panelId]: dirty });
  }, []);

  return (
    <>
      <h1 data-route-heading tabIndex={-1}>
        {t("settings.title")}
      </h1>

      <LanguageSettingsPanel
        api={api}
        initial={loaded.localePreference}
      />

      <div className="panel">
        <label htmlFor="settings-scope">{t("settings.scope")}</label>
        <select
          value={scopeDraft}
          id="settings-scope"
          name="sectionId"
          onChange={(event) => setScopeDraft(event.target.value)}
        >
          <option value="">{t("settings.global")}</option>
          {loaded.sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.name}
            </option>
          ))}
        </select>
        <button ref={scopeButtonRef} onClick={chooseScope} type="button">{t("settings.chooseScope")}</button>
      </div>

      <SchedulerSettingsForm
        api={api}
        onDirtyChange={handleDirtyChange}
        onViewChange={setView}
        view={view}
      />
      <DisclosureSection heading={t("settings.optimizer.trainingTitle")}>
        <OptimizerTrainingSettingsForm
          api={api}
          onDirtyChange={handleDirtyChange}
          onViewChange={setOptimizerView}
          view={optimizerView}
        />
      </DisclosureSection>
      <OptimizerPanel
        api={api}
        initialEligibility={loaded.optimizerEligibility}
      />
      <DisclosureSection heading={t("settings.optimizer.technicalTitle")}>
        <TechnicalSettingsPanel info={loaded.technicalInfo} />
      </DisclosureSection>
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
      {pendingScope !== null && <ConfirmDialog
        busy={false}
        cancelLabel={t("settings.unsaved.cancel")}
        confirmLabel={t("settings.unsaved.discard")}
        description={t("settings.unsaved.description")}
        onCancel={() => setPendingScope(null)}
        onConfirm={() => { const next = pendingScope; setPendingScope(null); goToScope(next); }}
        openerRef={scopeButtonRef}
        title={t("settings.unsaved.title")}
      />}
    </>
  );
}
