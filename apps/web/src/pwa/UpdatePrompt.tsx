import { useState, useSyncExternalStore } from "react";
import { useI18n } from "../app/I18nProvider.js";
import type { ServiceWorkerUpdateController } from "./register-service-worker.js";

export function UpdatePrompt({
  controller,
}: {
  readonly controller: ServiceWorkerUpdateController;
}) {
  const { t } = useI18n();
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [blocked, setBlocked] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!snapshot.needRefresh && !snapshot.offlineReady) return null;

  const update = async (): Promise<void> => {
    const activeReview = document.querySelector(
      '[data-openrecall-review-active="true"]',
    );
    const dirtyEditor = document.querySelector(
      '[data-openrecall-dirty="true"]',
    );
    if (activeReview !== null || dirtyEditor !== null) {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    setFailed(false);
    try {
      await controller.requestUpdate();
    } catch {
      setFailed(true);
    }
  };

  return (
    <aside className="pwa-prompt panel" role="status" aria-live="polite">
      <p>
        {snapshot.needRefresh
          ? t("pwa.updateAvailable")
          : t("pwa.offlineReady")}
      </p>
      {blocked && <p>{t("pwa.updateBlocked")}</p>}
      {failed && <p>{t("pwa.updateFailed")}</p>}
      <div className="review-actions">
        {snapshot.needRefresh && (
          <button type="button" onClick={() => void update()}>
            {t("pwa.updateNow")}
          </button>
        )}
        <button
          className="button-secondary"
          type="button"
          onClick={() => {
            setBlocked(false);
            setFailed(false);
            controller.deferUpdate();
          }}
        >
          {t("pwa.later")}
        </button>
      </div>
    </aside>
  );
}
