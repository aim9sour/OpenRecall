import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client.js";
import { ApiClientError } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";
import {
  beginMaintenanceNavigationBlock,
  endMaintenanceNavigationBlock,
} from "../app/maintenance-events.js";

export const RESTORE_MAX_FILE_BYTES =
  2 * 1_024 * 1_024 * 1_024;

type Outcome = "success" | "failure";

function validBackupFile(file: File): boolean {
  return (
    file.size > 0 &&
    file.size <= RESTORE_MAX_FILE_BYTES &&
    file.name.toLocaleLowerCase("en-US").endsWith(".sqlite3")
  );
}

function displaySize(bytes: number, locale: string): string {
  if (bytes < 1_024) {
    return `${new Intl.NumberFormat(locale).format(bytes)} B`;
  }
  const mebibytes = bytes / (1_024 * 1_024);
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
  }).format(mebibytes)} MiB`;
}

export function RestorePanel({
  api,
}: {
  readonly api: ApiClient;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState("");
  const resultHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (outcome !== null) resultHeading.current?.focus();
  }, [outcome]);

  const chooseFile = (selected: File | null) => {
    setConfirmed(false);
    setOutcome(null);
    if (selected === null) {
      setFile(null);
      setError("");
      return;
    }
    if (!validBackupFile(selected)) {
      setFile(null);
      setError(
        selected.size > RESTORE_MAX_FILE_BYTES
          ? t("restore.tooLarge")
          : t("restore.invalidFile"),
      );
      return;
    }
    setFile(selected);
    setError("");
  };

  const restore = async () => {
    if (file === null || !confirmed || busy) return;
    setBusy(true);
    setOutcome(null);
    setError("");
    beginMaintenanceNavigationBlock();
    try {
      if (api.restore === undefined) {
        throw new Error("RESTORE_CLIENT_UNAVAILABLE");
      }
      const bootstrap = await api.bootstrap();
      const revision = bootstrap.databaseRevision;
      if (
        revision === undefined ||
        !Number.isSafeInteger(revision) ||
        revision < 1
      ) {
        throw new Error("RESTORE_REVISION_UNAVAILABLE");
      }
      await api.restore(file, revision);
      setOutcome("success");
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        const code = caught.envelope.code;
        if (code === "RESTORE_REVISION_CONFLICT") {
          setError(t("restore.revisionConflict"));
        } else if (code === "RESTORE_UPLOAD_TOO_LARGE") {
          setError(t("restore.tooLarge"));
        } else if (
          code.startsWith("RESTORE_") ||
          code === "VALIDATION_ERROR"
        ) {
          setError(t("restore.invalid"));
        } else {
          setError(t("restore.failure"));
        }
      } else {
        setError(t("restore.failure"));
      }
      setOutcome("failure");
    } finally {
      endMaintenanceNavigationBlock();
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="restore-heading" className="panel">
      <h2 id="restore-heading">{t("restore.title")}</h2>
      <p>{t("restore.description")}</p>
      <div className="settings-field">
        <label htmlFor="restore-file">{t("restore.file")}</label>
        <input
          accept=".sqlite3,application/vnd.sqlite3,application/x-sqlite3"
          disabled={busy}
          id="restore-file"
          onChange={(event) =>
            chooseFile(event.currentTarget.files?.item(0) ?? null)
          }
          type="file"
        />
      </div>

      {file !== null && (
        <section aria-labelledby="restore-summary-heading">
          <h3 id="restore-summary-heading">
            {t("restore.summary")}
          </h3>
          <p>{t("restore.selected", { name: file.name })}</p>
          <p>
            {t("restore.size", {
              size: displaySize(file.size, i18n.language),
            })}
          </p>
          <p>
            <strong>{t("restore.warning")}</strong>
          </p>
          <div className="settings-field">
            <label>
              <input
                checked={confirmed}
                disabled={busy}
                onChange={(event) =>
                  setConfirmed(event.currentTarget.checked)
                }
                type="checkbox"
              />
              {t("restore.confirm")}
            </label>
          </div>
          <button
            disabled={!confirmed || busy}
            onClick={() => void restore()}
            type="button"
          >
            {busy ? t("restore.replacing") : t("restore.action")}
          </button>
        </section>
      )}

      {outcome !== null && (
        <section
          {...(outcome === "failure"
            ? { role: "alert" as const }
            : { role: "status" as const })}
        >
          <h3 ref={resultHeading} tabIndex={-1}>
            {outcome === "success"
              ? t("restore.successTitle")
              : t("restore.failureTitle")}
          </h3>
          <p>
            {outcome === "success"
              ? t("restore.success")
              : error}
          </p>
        </section>
      )}
      {outcome === null && error !== "" && (
        <p role="alert">{error}</p>
      )}
    </section>
  );
}
