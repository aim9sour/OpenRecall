import type { RefObject } from "react";
import { useI18n } from "../app/I18nProvider.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";

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
  const { t } = useI18n();

  return (
    <ConfirmDialog
      busy={busy}
      title={t("card.delete.title")}
      description={t("card.delete.description", { name: cardName })}
      confirmLabel={t("card.delete.confirm")}
      cancelLabel={t("review.cancel")}
      openerRef={openerRef}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
