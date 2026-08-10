import type {
  SchedulerControl,
  SchedulerSettings,
  SettingsView,
} from "@openrecall/contracts";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { ApiClient } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";
import { normalizeLocalizedNumber } from "./normalize-localized-number.js";
import { SettingHelp } from "./SettingHelp.js";

interface Draft {
  readonly requestedRetention: string;
  readonly maximumIntervalDays: string;
  readonly enableFuzz: boolean;
  readonly enableShortTerm: boolean;
  readonly learningStepsMinutes: string;
  readonly relearningStepsMinutes: string;
}

type FieldKey = SchedulerControl["key"];
type Errors = Partial<Record<FieldKey, string>>;

function toDraft(settings: SchedulerSettings): Draft {
  return {
    requestedRetention: String(settings.requestedRetention),
    maximumIntervalDays: String(settings.maximumIntervalDays),
    enableFuzz: settings.enableFuzz,
    enableShortTerm: settings.enableShortTerm,
    learningStepsMinutes: settings.learningStepsMinutes.join(", "),
    relearningStepsMinutes: settings.relearningStepsMinutes.join(", "),
  };
}

function parseSteps(value: string, maxMinutes: number): number[] | null {
  if (value.trim() === "") return [];
  const normalized = value.split(",").map((part) => normalizeLocalizedNumber(part.trim()));
  if (normalized.some((part) => part === null)) return null;
  const steps = normalized.map((part) => Number(part));
  let previous = 0;
  for (const step of steps) {
    if (
      !Number.isInteger(step) ||
      step < 1 ||
      step > maxMinutes ||
      step <= previous
    ) {
      return null;
    }
    previous = step;
  }
  return steps;
}

function numericControl(
  control: SchedulerControl,
): control is Extract<
  SchedulerControl,
  { kind: "number" | "integer" }
> {
  return control.kind === "number" || control.kind === "integer";
}

export function SchedulerSettingsForm({
  api,
  onViewChange,
  view,
  onDirtyChange,
}: {
  readonly api: ApiClient;
  readonly onViewChange: (view: SettingsView) => void;
  readonly view: SettingsView;
  readonly onDirtyChange?: (panelId: string, dirty: boolean) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() =>
    toDraft(view.savedOverride?.settings ?? view.effective.settings),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(
      toDraft(view.savedOverride?.settings ?? view.effective.settings),
    );
    setErrors({});
  }, [view]);

  useEffect(() => {
    const baseline = toDraft(view.savedOverride?.settings ?? view.effective.settings);
    onDirtyChange?.("scheduler", JSON.stringify(draft) !== JSON.stringify(baseline));
  }, [draft, onDirtyChange, view]);

  useEffect(() => {
    if (Object.keys(errors).length > 0) summaryRef.current?.focus();
  }, [errors]);

  const labels = new Map(
    view.manifest.controls.map((control) => [
      control.key,
      t(control.labelKey),
    ]),
  );

  const validate = (): SchedulerSettings | null => {
    const nextErrors: Errors = {};
    const retentionControl = view.manifest.controls.find(
      (control) => control.key === "requestedRetention",
    );
    const intervalControl = view.manifest.controls.find(
      (control) => control.key === "maximumIntervalDays",
    );
    const learningControl = view.manifest.controls.find(
      (control) => control.key === "learningStepsMinutes",
    );
    const relearningControl = view.manifest.controls.find(
      (control) => control.key === "relearningStepsMinutes",
    );
    if (
      retentionControl === undefined ||
      intervalControl === undefined ||
      learningControl === undefined ||
      relearningControl === undefined ||
      !numericControl(retentionControl) ||
      !numericControl(intervalControl) ||
      learningControl.kind !== "steps" ||
      relearningControl.kind !== "steps"
    ) {
      setErrors({});
      setNotice(t("settings.manifestInvalid"));
      return null;
    }

    const normalizedRetention = normalizeLocalizedNumber(draft.requestedRetention);
    const requestedRetention = normalizedRetention === null ? Number.NaN : Number(normalizedRetention);
    if (
      !Number.isFinite(requestedRetention) ||
      requestedRetention < retentionControl.min ||
      requestedRetention > retentionControl.max
    ) {
      nextErrors.requestedRetention = t("settings.error.numberBounds");
    }
    const normalizedInterval = normalizeLocalizedNumber(draft.maximumIntervalDays);
    const maximumIntervalDays = normalizedInterval === null ? Number.NaN : Number(normalizedInterval);
    if (
      !Number.isInteger(maximumIntervalDays) ||
      maximumIntervalDays < intervalControl.min ||
      maximumIntervalDays > intervalControl.max
    ) {
      nextErrors.maximumIntervalDays = t("settings.error.integerBounds");
    }
    const learningStepsMinutes = parseSteps(
      draft.learningStepsMinutes,
      learningControl.maxMinutes,
    );
    if (learningStepsMinutes === null) {
      nextErrors.learningStepsMinutes = t(
        "settings.error.stepsIncreasing",
      );
    }
    const relearningStepsMinutes = parseSteps(
      draft.relearningStepsMinutes,
      relearningControl.maxMinutes,
    );
    if (relearningStepsMinutes === null) {
      nextErrors.relearningStepsMinutes = t(
        "settings.error.stepsIncreasing",
      );
    }
    setErrors(nextErrors);
    if (
      Object.keys(nextErrors).length > 0 ||
      learningStepsMinutes === null ||
      relearningStepsMinutes === null
    ) {
      return null;
    }
    return {
      requestedRetention,
      maximumIntervalDays,
      enableFuzz: draft.enableFuzz,
      enableShortTerm: draft.enableShortTerm,
      learningStepsMinutes,
      relearningStepsMinutes,
    };
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice("");
    const settings = validate();
    if (settings === null) return;
    setBusy(true);
    try {
      const path =
        view.selectedScope.scopeType === "global"
          ? "/api/v1/settings/scheduler/global"
          : `/api/v1/settings/scheduler/sections/${encodeURIComponent(
              view.selectedScope.sectionId ?? "",
            )}`;
      const updated = await api.put<SettingsView>(path, {
        expectedUpdatedAtMs: view.savedOverride?.updatedAtMs ?? null,
        settings,
      });
      onViewChange(updated);
      setNotice(t("settings.saved"));
    } catch {
      setNotice(t("settings.saveError"));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (
      view.selectedScope.scopeType !== "section" ||
      view.selectedScope.sectionId === null ||
      view.savedOverride === null
    ) {
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const updated = await api.delete<SettingsView>(
        `/api/v1/settings/scheduler/sections/${encodeURIComponent(
          view.selectedScope.sectionId,
        )}`,
        { expectedUpdatedAtMs: view.savedOverride.updatedAtMs },
      );
      onViewChange(updated);
      setNotice(t("settings.resetDone"));
    } catch {
      setNotice(t("settings.saveError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="scheduler-settings-heading" className="panel">
      <h2 id="scheduler-settings-heading">{t("settings.scheduler.title")}</h2>

      {view.selectedScope.scopeType === "section" &&
        view.savedOverride === null && (
          <p>{t("settings.sectionInherited")}</p>
        )}

      <dl className="settings-version-list">
        <div>
          <dt>{t("settings.algorithm")}</dt>
          <dd>
            {view.manifest.algorithmId} {view.manifest.algorithmVersion}
          </dd>
        </div>
        <div>
          <dt>{t("settings.package")}</dt>
          <dd>{view.manifest.upstreamPackage}</dd>
        </div>
        <div>
          <dt>{t("settings.adapterVersion")}</dt>
          <dd>{view.manifest.adapterVersion}</dd>
        </div>
        <div>
          <dt>{t("settings.settingsSource")}</dt>
          <dd>{t(`settings.source.${view.effective.settingsSource.kind}`)}</dd>
        </div>
        <div>
          <dt>{t("settings.parameterSource")}</dt>
          <dd>{t(`settings.source.${view.effective.parameterSource.kind}`)}</dd>
        </div>
      </dl>

      <p>{t("settings.futureRatingsNotice")}</p>
      <p>{t("settings.stepsNotice")}</p>

      {Object.keys(errors).length > 0 && (
        <div
          className="error-summary"
          ref={summaryRef}
          role="alert"
          tabIndex={-1}
        >
          <h3>{t("error.summary")}</h3>
          <ul>
            {(Object.entries(errors) as Array<[FieldKey, string]>).map(
              ([key, message]) => (
                <li key={key}>
                  <a
                    href={`#setting-${key}`}
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(`setting-${key}`)?.focus();
                    }}
                  >
                    {labels.get(key)}: {message}
                  </a>
                </li>
              ),
            )}
          </ul>
        </div>
      )}

      <form noValidate onSubmit={(event) => void save(event)}>
        {view.manifest.controls
          .filter((control) => !control.deprecated)
          .map((control) => {
            const id = `setting-${control.key}`;
            const errorId = `${id}-error`;

            if (control.kind === "boolean") {
              return (
                <div className="settings-field" key={control.key}>
                  <label htmlFor={id}>
                    <input
                      aria-errormessage={errors[control.key] === undefined ? undefined : errorId}
                      aria-invalid={errors[control.key] === undefined ? undefined : true}
                      checked={draft[control.key]}
                      disabled={busy}
                      id={id}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          [control.key]: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    {t(control.labelKey)}
                  </label>
                  <SettingHelp label={t("settings.explain", { setting: t(control.labelKey) })}>{t(control.descriptionKey)}</SettingHelp>
                  {errors[control.key] !== undefined && (
                    <p aria-live="polite" id={errorId}>{errors[control.key]}</p>
                  )}
                </div>
              );
            }

            return (
              <div className="settings-field" key={control.key}>
                <label htmlFor={id}>{t(control.labelKey)}</label>
                {control.kind === "steps" ? (
                  <input
                    aria-errormessage={errors[control.key] === undefined ? undefined : errorId}
                    aria-invalid={errors[control.key] === undefined ? undefined : true}
                    disabled={busy}
                    id={id}
                    inputMode="numeric"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [control.key]: event.target.value,
                      }))
                    }
                    type="text"
                    value={draft[control.key]}
                  />
                ) : (
                  <input
                    aria-errormessage={errors[control.key] === undefined ? undefined : errorId}
                    aria-invalid={errors[control.key] === undefined ? undefined : true}
                    disabled={busy}
                    id={id}
                    max={control.max}
                    min={control.min}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [control.key]: event.target.value,
                      }))
                    }
                    step={control.step}
                    type="number"
                    value={draft[control.key]}
                  />
                )}
                <SettingHelp label={t("settings.explain", { setting: t(control.labelKey) })}>{t(control.descriptionKey)}</SettingHelp>
                {errors[control.key] !== undefined && (
                  <p aria-live="polite" id={errorId}>{errors[control.key]}</p>
                )}
              </div>
            );
          })}

        <div className="review-actions">
          <button disabled={busy} type="submit">
            {busy ? t("form.submitting") : t("settings.save")}
          </button>
          {view.selectedScope.scopeType === "section" &&
            view.savedOverride !== null && (
              <button
                disabled={busy}
                onClick={() => void reset()}
                type="button"
              >
                {t("settings.resetSection")}
              </button>
            )}
        </div>
      </form>
      <p aria-live="polite" className="sr-status">
        {notice}
      </p>
    </section>
  );
}
