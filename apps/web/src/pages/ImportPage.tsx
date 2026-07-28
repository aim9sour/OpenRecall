import type { ImportPreviewRow } from "@openrecall/contracts";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { ApiClient } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";

const MAX_FILE_BYTES = 5 * 1_024 * 1_024;

interface PreviewResponse {
  readonly previewId: string;
  readonly digest: string;
  readonly total: number;
  readonly valid: number;
  readonly duplicate: number;
  readonly invalid: number;
  readonly rows: readonly ImportPreviewRow[];
}

function asCards(content: unknown): readonly unknown[] {
  return Array.isArray(content) ? content : [content];
}

function cardText(content: unknown, index: number, field: "front" | "back") {
  const card = asCards(content)[index];
  if (typeof card !== "object" || card === null || Array.isArray(card)) {
    return "";
  }
  const value = (card as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(new Error("FILE_READ_FAILED")));
    reader.readAsText(file);
  });
}

export function ImportPage({ api }: { readonly api: ApiClient }) {
  const { sectionId = "" } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [file, setFile] = useState<File>();
  const [content, setContent] = useState<unknown>();
  const [preview, setPreview] = useState<PreviewResponse>();
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [errorKeys, setErrorKeys] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (errorKeys.length > 0) errorRef.current?.focus();
  }, [errorKeys]);

  async function previewFile() {
    if (file === undefined) {
      setErrorKeys(["import.fileRequired"]);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setErrorKeys(["import.fileTooLarge"]);
      return;
    }
    setBusy(true);
    setErrorKeys([]);
    try {
      const parsed: unknown = JSON.parse(await readFile(file));
      const previewId = crypto.randomUUID();
      const response = await api.post<PreviewResponse>(
        `/api/v1/sections/${encodeURIComponent(sectionId)}/import/preview`,
        { previewId, content: parsed },
      );
      setContent(parsed);
      setPreview(response);
      setSelected(
        new Set(
          response.rows
            .filter((row) => row.status === "valid")
            .map((row) => row.index),
        ),
      );
    } catch {
      setErrorKeys(["import.invalidJson"]);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (preview === undefined || selected.size === 0) return;
    setBusy(true);
    setErrorKeys([]);
    try {
      await api.post(
        `/api/v1/sections/${encodeURIComponent(sectionId)}/import/commit`,
        {
          previewId: preview.previewId,
          content,
          digest: preview.digest,
          selectedIndexes: [...selected].sort((a, b) => a - b),
        },
      );
      await navigate(`/sections/${encodeURIComponent(sectionId)}`);
    } catch {
      setErrorKeys(["import.commitFailed"]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p><Link to={`/sections/${encodeURIComponent(sectionId)}`}>{t("import.backSection")}</Link></p>
      <h1 data-route-heading tabIndex={-1}>{t("import.title")}</h1>
      {errorKeys.length > 0 && (
        <div ref={errorRef} role="alert" tabIndex={-1} className="error-summary">
          <h2>{t("error.summary")}</h2>
          <ul>{errorKeys.map((key) => <li key={key}>{t(key)}</li>)}</ul>
        </div>
      )}
      <section aria-labelledby="import-file-heading" className="panel">
        <h2 id="import-file-heading">{t("import.chooseFile")}</h2>
        <label htmlFor="cards-file">{t("import.fileLabel")}</label>
        <input
          id="cards-file"
          type="file"
          accept=".json,application/json"
          onChange={(event) => {
            setFile(event.currentTarget.files?.[0]);
            setPreview(undefined);
          }}
        />
        <button type="button" disabled={busy} onClick={() => void previewFile()}>
          {t("import.preview")}
        </button>
      </section>
      {preview !== undefined && (
        <section aria-labelledby="import-preview-heading">
          <h2 id="import-preview-heading">{t("import.previewHeading")}</h2>
          <p>
            {t("import.previewCounts", {
              total: preview.total,
              valid: preview.valid,
              duplicate: preview.duplicate,
              invalid: preview.invalid,
            })}
          </p>
          <div className="table-scroll">
            <table>
              <caption>{t("import.previewTable")}</caption>
              <thead><tr>
                <th scope="col">{t("import.select")}</th>
                <th scope="col">{t("import.status")}</th>
                <th scope="col">{t("import.front")}</th>
                <th scope="col">{t("import.back")}</th>
                <th scope="col">{t("import.messages")}</th>
              </tr></thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.index}>
                    <td>{row.status === "valid" && (
                      <input
                        type="checkbox"
                        aria-label={t("import.selectCard", { number: row.index + 1 })}
                        checked={selected.has(row.index)}
                        onChange={(event) => {
                          const next = new Set(selected);
                          event.currentTarget.checked ? next.add(row.index) : next.delete(row.index);
                          setSelected(next);
                        }}
                      />
                    )}</td>
                    <td>{t(`import.status.${row.status}`)}</td>
                    <td dir="auto">{cardText(content, row.index, "front")}</td>
                    <td dir="auto">{cardText(content, row.index, "back")}</td>
                    <td><ul>{[...row.issues, ...row.warnings].map((message) => (
                      <li key={`${message.path}-${message.messageKey}`}>
                        {message.path}: {t(message.messageKey)}
                      </li>
                    ))}</ul></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" disabled={busy || selected.size === 0} onClick={() => void commit()}>
            {t("import.commit")}
          </button>
        </section>
      )}
    </>
  );
}
