import type { ApplicationLocalePreference } from "@openrecall/contracts";
import {
  getLocaleDefinition,
  isProductionLocale,
  registeredLocaleTags,
  type LocaleTag,
} from "@openrecall/i18n";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ApiClientError,
  type ApiClient,
} from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";
import { ErrorSummary } from "../components/ErrorSummary.js";
import { rememberLocale } from "../i18n/locale-storage.js";

export interface LocalePreferenceView {
  readonly locale: LocaleTag;
  readonly updatedAtMs: number;
}

type LanguageNoticeKey = "settings.language.saved";
type LanguageErrorKey =
  | "settings.language.saveError"
  | "settings.language.conflict";

function conflictPreference(
  error: ApiClientError,
): LocalePreferenceView | undefined {
  const envelope = error.envelope as unknown;
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    !("code" in envelope) ||
    envelope.code !== "APPLICATION_SETTING_CONFLICT" ||
    !("current" in envelope) ||
    typeof envelope.current !== "object" ||
    envelope.current === null ||
    !("locale" in envelope.current) ||
    typeof envelope.current.locale !== "string" ||
    !registeredLocaleTags().includes(
      envelope.current.locale as LocaleTag,
    ) ||
    !("updatedAtMs" in envelope.current) ||
    typeof envelope.current.updatedAtMs !== "number" ||
    !Number.isSafeInteger(envelope.current.updatedAtMs) ||
    envelope.current.updatedAtMs < 0
  ) {
    return undefined;
  }
  return {
    locale: envelope.current.locale as LocaleTag,
    updatedAtMs: envelope.current.updatedAtMs,
  };
}

export function LanguageSettingsPanel({
  api,
  initial,
}: {
  readonly api: ApiClient;
  readonly initial: LocalePreferenceView;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const productionLocales = registeredLocaleTags().filter(
    isProductionLocale,
  );
  const [preference, setPreference] =
    useState<LocalePreferenceView>(initial);
  const [selected, setSelected] = useState(() =>
    isProductionLocale(initial.locale) ? initial.locale : "en",
  );
  const [draftIsDirty, setDraftIsDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [noticeKey, setNoticeKey] = useState<
    LanguageNoticeKey | ""
  >("");
  const [errorKey, setErrorKey] = useState<LanguageErrorKey | "">(
    "",
  );
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (noticeKey !== "") statusRef.current?.focus();
  }, [noticeKey]);

  const activeLanguage = i18n.language;
  useEffect(() => {
    if (!draftIsDirty && isProductionLocale(activeLanguage)) {
      setSelected(activeLanguage);
    }
  }, [activeLanguage, draftIsDirty]);

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setNoticeKey("");
    setErrorKey("");
    try {
      const saved = await api.put<ApplicationLocalePreference>(
        "/api/v1/application-settings/locale",
        {
          locale: selected,
          expectedUpdatedAtMs: preference.updatedAtMs,
        },
      );
      setPreference(saved);
      await i18n.changeLanguage(saved.locale);
      rememberLocale(saved.locale);
      setDraftIsDirty(false);
      setNoticeKey("settings.language.saved");
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        const current = conflictPreference(caught);
        if (current !== undefined) {
          setPreference(current);
          setErrorKey("settings.language.conflict");
          return;
        }
      }
      setErrorKey("settings.language.saveError");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="language-settings-heading" className="panel">
      <h2 id="language-settings-heading">
        {t("settings.language.heading")}
      </h2>
      <p>{t("settings.language.description")}</p>
      <ErrorSummary
        errors={
          errorKey === ""
            ? []
            : [{ id: "language-save-error", message: t(errorKey) }]
        }
        focus={errorKey !== ""}
        title={t("error.summary")}
      />
      <form onSubmit={(event) => void save(event)}>
        <label htmlFor="application-language">
          {t("settings.language.label")}
        </label>
        <select
          id="application-language"
          onChange={(event) => {
            if (isProductionLocale(event.target.value)) {
              setSelected(event.target.value);
              setDraftIsDirty(true);
            }
          }}
          value={selected}
        >
          {productionLocales.map((locale) => (
            <option key={locale} value={locale}>
              {getLocaleDefinition(locale).displayName}
            </option>
          ))}
        </select>
        <button disabled={busy} type="submit">
          {busy
            ? t("settings.language.saving")
            : t("settings.language.save")}
        </button>
      </form>
      {noticeKey !== "" && (
        <div ref={statusRef} role="status" tabIndex={-1}>
          {t(noticeKey)}
        </div>
      )}
    </section>
  );
}
