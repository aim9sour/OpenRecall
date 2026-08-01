import { useEffect, useRef, type RefObject } from "react";
import { useI18n } from "../app/I18nProvider.js";

export function EndSessionDialog({
  busy,
  onCancel,
  onFinish,
  onPause,
  openerRef,
  restoreOpener = true,
}: {
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onFinish: () => void;
  readonly onPause: () => void;
  readonly openerRef: RefObject<HTMLButtonElement | null>;
  readonly restoreOpener?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstButtonRef = useRef<HTMLButtonElement>(null);
  const lastButtonRef = useRef<HTMLButtonElement>(null);
  const { t } = useI18n();

  const cancel = (): void => {
    const opener = openerRef.current;
    onCancel();
    if (restoreOpener) {
      queueMicrotask(() => opener?.focus());
    }
  };

  useEffect(() => {
    firstButtonRef.current?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    if (
      event.shiftKey &&
      document.activeElement === firstButtonRef.current
    ) {
      event.preventDefault();
      lastButtonRef.current?.focus();
    } else if (
      !event.shiftKey &&
      document.activeElement === lastButtonRef.current
    ) {
      event.preventDefault();
      firstButtonRef.current?.focus();
    }
  };

  return (
    <div className="dialog-backdrop">
      <div
        ref={dialogRef}
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-session-title"
        aria-describedby="end-session-description"
        onKeyDown={onKeyDown}
      >
        <h2 id="end-session-title">{t("review.endDialogTitle")}</h2>
        <p id="end-session-description">
          {t("review.endDialogDescription")}
        </p>
        <div className="review-actions">
          <button
            ref={firstButtonRef}
            type="button"
            disabled={busy}
            onClick={onPause}
          >
            {t("review.continueLater")}
          </button>
          <button type="button" disabled={busy} onClick={onFinish}>
            {t("review.finish")}
          </button>
          <button
            ref={lastButtonRef}
            type="button"
            disabled={busy}
            onClick={cancel}
          >
            {t("review.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
