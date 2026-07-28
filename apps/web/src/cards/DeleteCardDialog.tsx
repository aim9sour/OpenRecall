import { useEffect, useRef, type RefObject } from "react";
import { useI18n } from "../app/I18nProvider.js";

export function DeleteCardDialog({
  busy,
  cardName,
  onCancel,
  onConfirm,
  openerRef,
}: {
  readonly busy: boolean;
  readonly cardName: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly openerRef: RefObject<HTMLButtonElement | null>;
}) {
  const firstRef = useRef<HTMLButtonElement>(null);
  const lastRef = useRef<HTMLButtonElement>(null);
  const { t } = useI18n();

  const cancel = (): void => {
    const opener = openerRef.current;
    onCancel();
    queueMicrotask(() => opener?.focus());
  };

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-card-title"
        aria-describedby="delete-card-description"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          } else if (
            event.key === "Tab" &&
            event.shiftKey &&
            document.activeElement === firstRef.current
          ) {
            event.preventDefault();
            lastRef.current?.focus();
          } else if (
            event.key === "Tab" &&
            !event.shiftKey &&
            document.activeElement === lastRef.current
          ) {
            event.preventDefault();
            firstRef.current?.focus();
          }
        }}
      >
        <h2 id="delete-card-title">{t("card.delete.title")}</h2>
        <p id="delete-card-description">
          {t("card.delete.description", { name: cardName })}
        </p>
        <div className="review-actions">
          <button
            ref={firstRef}
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {t("card.delete.confirm")}
          </button>
          <button
            ref={lastRef}
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
