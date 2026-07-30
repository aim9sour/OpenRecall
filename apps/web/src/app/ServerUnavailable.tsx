import { useI18n } from "./I18nProvider.js";

export function ServerUnavailable({
  onRetry = () => window.location.reload(),
}: {
  readonly onRetry?: () => void;
}) {
  const { t } = useI18n();

  return (
    <main className="page-shell server-unavailable">
      <section className="panel" aria-labelledby="server-unavailable-title">
        <h1 id="server-unavailable-title">
          {t("serverUnavailable.title")}
        </h1>
        <p>{t("serverUnavailable.description")}</p>
        <p>
          <code>http://127.0.0.1:3210</code>
        </p>
        <div className="review-actions">
          <button type="button" onClick={onRetry}>
            {t("serverUnavailable.retry")}
          </button>
          <a href="#startup-instructions">
            {t("serverUnavailable.helpLink")}
          </a>
        </div>
      </section>
      <section
        id="startup-instructions"
        className="panel"
        aria-labelledby="startup-instructions-title"
      >
        <h2 id="startup-instructions-title">
          {t("serverUnavailable.helpTitle")}
        </h2>
        <p>{t("serverUnavailable.helpBody")}</p>
        <pre>
          <code>pnpm --filter @openrecall/server start</code>
        </pre>
      </section>
    </main>
  );
}
