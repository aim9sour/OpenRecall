import type { SectionSummary } from "@openrecall/contracts";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ApiClientError, type ApiClient } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";
import { ErrorSummary } from "../components/ErrorSummary.js";

export interface SectionManagementPanelProps {
  readonly api: ApiClient;
  readonly section: SectionSummary;
  readonly onRenamed: (section: SectionSummary) => void;
  readonly onDeleted: () => void;
}

type RenameErrorKey =
  | "section.rename.error"
  | "section.rename.conflict";
type DeleteErrorKey =
  | "section.delete.error"
  | "section.delete.conflict";

function conflictSection(
  error: ApiClientError,
  expectedSectionId: string,
): SectionSummary | undefined {
  const envelope = error.envelope as unknown;
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    !("code" in envelope) ||
    envelope.code !== "SECTION_CONFLICT" ||
    !("current" in envelope)
  ) {
    return undefined;
  }
  const current = envelope.current as Partial<SectionSummary> | null;
  if (
    current === null ||
    typeof current !== "object" ||
    current.id !== expectedSectionId ||
    typeof current.name !== "string" ||
    !Number.isSafeInteger(current.createdAtMs) ||
    !Number.isSafeInteger(current.updatedAtMs) ||
    typeof current.counts !== "object" ||
    current.counts === null ||
    !Number.isSafeInteger(current.counts.total) ||
    !Number.isSafeInteger(current.counts.new) ||
    !Number.isSafeInteger(current.counts.dueNow) ||
    !(
      current.nextDueAtMs === null ||
      Number.isSafeInteger(current.nextDueAtMs)
    )
  ) {
    return undefined;
  }
  return current as SectionSummary;
}

export function SectionManagementPanel({
  api,
  section,
  onRenamed,
  onDeleted,
}: SectionManagementPanelProps) {
  const { t } = useI18n();
  const [current, setCurrent] = useState(section);
  const [name, setName] = useState(section.name);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<RenameErrorKey | "">("");
  const [renameSaved, setRenameSaved] = useState(false);
  const renameStatusRef = useRef<HTMLDivElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<DeleteErrorKey | "">("");
  const renameErrors = useMemo(
    () =>
      renameError === ""
        ? []
        : [{
            id: "section-rename-error",
            message: t(renameError),
            targetId: "section-rename-name",
          }],
    [renameError, t],
  );
  const deleteErrors = useMemo(
    () =>
      deleteError === ""
        ? []
        : [{ id: "section-delete-error", message: t(deleteError) }],
    [deleteError, t],
  );

  useEffect(() => setCurrent(section), [section]);
  useEffect(() => {
    if (renameSaved) renameStatusRef.current?.focus();
  }, [renameSaved]);

  const rename = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setRenameSaved(false);
    setRenameError("");
    const normalizedName = name.trim();
    const characterCount = Array.from(normalizedName).length;
    if (characterCount === 0 || characterCount > 200) {
      setRenameError("section.rename.error");
      return;
    }
    setRenameBusy(true);
    try {
      const saved = await api.patch<SectionSummary>(
        `/api/v1/sections/${current.id}`,
        {
          name: normalizedName,
          expectedUpdatedAtMs: current.updatedAtMs,
        },
      );
      setCurrent(saved);
      setName(saved.name);
      onRenamed(saved);
      setRenameSaved(true);
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        const conflict = conflictSection(caught, current.id);
        if (conflict !== undefined) {
          setCurrent(conflict);
          onRenamed(conflict);
          setRenameError("section.rename.conflict");
          return;
        }
      }
      setRenameError("section.rename.error");
    } finally {
      setRenameBusy(false);
    }
  };

  const remove = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!confirmed || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await api.delete<void>(`/api/v1/sections/${current.id}`, {
        confirmed: true,
        expectedUpdatedAtMs: current.updatedAtMs,
      });
      onDeleted();
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        const conflict = conflictSection(caught, current.id);
        if (conflict !== undefined) {
          setCurrent(conflict);
          onRenamed(conflict);
          setConfirmed(false);
          setDeleteError("section.delete.conflict");
          return;
        }
      }
      setDeleteError("section.delete.error");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <section aria-labelledby="section-rename-heading" className="panel">
        <h2 id="section-rename-heading">{t("section.rename.heading")}</h2>
        <ErrorSummary
          errors={renameErrors}
          focus={renameError !== ""}
          title={t("error.summary")}
        />
        <form onSubmit={(event) => void rename(event)}>
          <label htmlFor="section-rename-name">{t("section.rename.label")}</label>
          <input
            id="section-rename-name"
            onChange={(event) => {
              setName(event.target.value);
              setRenameError("");
            }}
            required
            type="text"
            value={name}
          />
          <button disabled={renameBusy} type="submit">
            {renameBusy ? t("section.rename.saving") : t("section.rename.save")}
          </button>
        </form>
        {renameSaved && (
          <div ref={renameStatusRef} role="status" tabIndex={-1}>
            {t("section.rename.saved")}
          </div>
        )}
      </section>

      <section
        aria-labelledby="section-delete-heading"
        className="panel danger-panel"
      >
        <h2 id="section-delete-heading">{t("section.delete.heading")}</h2>
        <p>{t("section.delete.warning")}</p>
        <ErrorSummary
          errors={deleteErrors}
          focus={deleteError !== ""}
          title={t("error.summary")}
        />
        <form onSubmit={(event) => void remove(event)}>
          <label className="checkbox-label">
            <input
              checked={confirmed}
              disabled={deleteBusy}
              onChange={(event) => {
                setConfirmed(event.target.checked);
                setDeleteError("");
              }}
              type="checkbox"
            />
            {t("section.delete.confirm")}
          </label>
          <button
            className="button-danger"
            disabled={!confirmed || deleteBusy}
            type="submit"
          >
            {deleteBusy ? t("section.delete.deleting") : t("section.delete.submit")}
          </button>
        </form>
      </section>
    </>
  );
}
