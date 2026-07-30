import {
  useEffect,
  useId,
  useRef,
  type RefObject,
} from "react";

export function ConfirmDialog({
  busy,
  cancelLabel,
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  openerRef,
  title,
}: {
  readonly busy: boolean;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  readonly description: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly openerRef: RefObject<HTMLButtonElement | null>;
  readonly title: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const lastRef = useRef<HTMLButtonElement>(null);
  const supportsNativeModal =
    typeof HTMLDialogElement !== "undefined" &&
    typeof HTMLDialogElement.prototype.showModal === "function";

  const cancel = (): void => {
    onCancel();
    queueMicrotask(() => openerRef.current?.focus());
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    }
    firstRef.current?.focus();
    return () => {
      if (dialog?.open && typeof dialog.close === "function") {
        dialog.close();
      }
      queueMicrotask(() => openerRef.current?.focus());
    };
  }, [openerRef]);

  return (
    <dialog
      ref={dialogRef}
      className="dialog-panel"
      open={supportsNativeModal ? undefined : true}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
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
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      <div className="review-actions">
        <button
          ref={firstRef}
          className="button-danger"
          type="button"
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button
          ref={lastRef}
          className="button-secondary"
          type="button"
          disabled={busy}
          onClick={cancel}
        >
          {cancelLabel}
        </button>
      </div>
    </dialog>
  );
}
