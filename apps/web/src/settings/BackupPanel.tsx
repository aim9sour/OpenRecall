import { useState } from "react";
import type { ApiClient } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";

export type SaveBackupFile = (blob: Blob, filename: string) => void;

function saveInBrowser(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function BackupPanel({
  api,
  saveFile = saveInBrowser,
}: {
  readonly api: ApiClient;
  readonly saveFile?: SaveBackupFile;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState("");

  const download = async () => {
    setBusy(true);
    setAnnouncement("");
    setError("");
    try {
      if (api.download === undefined) {
        throw new Error("BACKUP_DOWNLOAD_UNAVAILABLE");
      }
      const result = await api.download("/api/v1/backup");
      saveFile(result.blob, result.filename);
      setAnnouncement(t("backup.downloaded"));
    } catch {
      setError(t("backup.downloadError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="backup-heading" className="panel">
      <h2 id="backup-heading">{t("backup.title")}</h2>
      <p>{t("backup.description")}</p>
      <button
        disabled={busy}
        onClick={() => void download()}
        type="button"
      >
        {busy ? t("backup.preparing") : t("backup.download")}
      </button>
      {error !== "" && <p role="alert">{error}</p>}
      <p aria-live="polite" role="status">
        {announcement}
      </p>
    </section>
  );
}
