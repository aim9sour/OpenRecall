import type {
  OptimizerSettingsView,
  OptimizerTrainingPreflight,
  OptimizerTrainingSettings,
} from "@openrecall/contracts";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ApiClient } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";
import { SettingHelp } from "./SettingHelp.js";

function same(left: OptimizerTrainingSettings, right: OptimizerTrainingSettings): boolean {
  return left.numEpochs === right.numEpochs && left.batchSize === right.batchSize && left.maxSeqLen === right.maxSeqLen;
}

export function OptimizerTrainingSettingsForm({ api, onDirtyChange, onViewChange, view }: {
  readonly api: ApiClient;
  readonly onDirtyChange?: (panelId: string, dirty: boolean) => void;
  readonly onViewChange: (view: OptimizerSettingsView) => void;
  readonly view: OptimizerSettingsView;
}) {
  const { t } = useI18n();
  const baseline = useMemo(() => view.savedOverride?.settings ?? view.effective.settings, [view]);
  const [draft, setDraft] = useState<OptimizerTrainingSettings>(baseline);
  const [preflight, setPreflight] = useState<OptimizerTrainingPreflight | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setDraft(baseline); setNotice(""); }, [baseline]);
  useEffect(() => { onDirtyChange?.("optimizer-training", !same(draft, baseline)); }, [baseline, draft, onDirtyChange]);

  const refreshPreflight = async (settings = draft) => {
    try {
      setPreflight(await api.post<OptimizerTrainingPreflight>("/api/v1/optimizer/preflight", {
        scope: view.selectedScope,
        settings,
      }));
    } catch {
      setNotice(t("settings.optimizer.preflightError"));
    }
  };

  useEffect(() => { void refreshPreflight(baseline); }, [baseline, view.selectedScope.sectionId, view.selectedScope.scopeType]);

  const persist = async (settings: OptimizerTrainingSettings) => {
    const path = view.selectedScope.scopeType === "global"
      ? "/api/v1/settings/optimizer/global"
      : `/api/v1/settings/optimizer/sections/${encodeURIComponent(view.selectedScope.sectionId ?? "")}`;
    const updated = await api.put<OptimizerSettingsView>(path, {
      expectedUpdatedAtMs: view.savedOverride?.updatedAtMs,
      settings,
    });
    onViewChange(updated);
    setNotice(t("settings.saved"));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setNotice("");
    try { await persist(draft); } catch { setNotice(t("settings.saveError")); } finally { setBusy(false); }
  };

  const inherit = async () => {
    if (view.selectedScope.scopeType !== "section" || view.selectedScope.sectionId === null || view.savedOverride === null) return;
    setBusy(true); setNotice("");
    try {
      const updated = await api.delete<OptimizerSettingsView>(
        `/api/v1/settings/optimizer/sections/${encodeURIComponent(view.selectedScope.sectionId)}`,
        { expectedUpdatedAtMs: view.savedOverride.updatedAtMs },
      );
      onViewChange(updated); setNotice(t("settings.resetDone"));
    } catch { setNotice(t("settings.saveError")); } finally { setBusy(false); }
  };

  return <>
    {view.selectedScope.scopeType === "section" && view.savedOverride === null && <p>{t("settings.optimizer.inherited")}</p>}
    <form onSubmit={(event) => void save(event)}>
      {view.manifest.controls.map((control) => {
        const id = `optimizer-setting-${control.key}`;
        return <div className="settings-field" key={control.key}>
          <label htmlFor={id}>{t(control.labelKey)}</label>
          <select
            disabled={busy}
            id={id}
            onChange={(event) => setDraft((current) => ({ ...current, [control.key]: Number(event.target.value) }))}
            value={draft[control.key]}
          >
            {control.choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
          </select>
          <SettingHelp label={t("settings.explain", { setting: t(control.labelKey) })}>{t(control.descriptionKey)}</SettingHelp>
        </div>;
      })}
      <div className="review-actions">
        <button disabled={busy} type="submit">{busy ? t("form.submitting") : t("settings.save")}</button>
        <button disabled={busy} onClick={() => void refreshPreflight()} type="button">{t("settings.optimizer.refreshPreflight")}</button>
        <button disabled={busy} onClick={() => { setDraft(view.defaults); void persist(view.defaults).catch(() => setNotice(t("settings.saveError"))); }} type="button">{t("settings.optimizer.restoreOfficial")}</button>
        {view.selectedScope.scopeType === "section" && view.savedOverride !== null && <button disabled={busy} onClick={() => void inherit()} type="button">{t("settings.optimizer.useGeneral")}</button>}
      </div>
    </form>
    {preflight !== null && <dl className="statistics">
      <div><dt>{t("optimizer.rawReviews")}</dt><dd>{preflight.rawReviewCount}</dd></div>
      <div><dt>{t("settings.optimizer.otherwiseEligible")}</dt><dd>{preflight.otherwiseEligibleExampleCount}</dd></div>
      <div><dt>{t("settings.optimizer.excluded")}</dt><dd>{preflight.excludedByMaxSeqLenCount}</dd></div>
      <div><dt>{t("optimizer.eligibleExamples")}</dt><dd>{preflight.eligibleExampleCount}</dd></div>
    </dl>}
    <p aria-live="polite" className="sr-status">{notice}</p>
  </>;
}
