import type { SectionSummary } from "@openrecall/contracts";
import { Link, useLoaderData } from "react-router";
import { useI18n } from "../app/I18nProvider.js";

export function SectionPage() {
  const section = useLoaderData() as SectionSummary;
  const { t } = useI18n();
  const reviewDescriptionId = `section-review-unavailable-${section.id}`;

  return (
    <>
      <p>
        <Link to="/">{t("section.backHome")}</Link>
      </p>
      <h1 data-route-heading tabIndex={-1}>
        {section.name}
      </h1>
      <section aria-labelledby="section-statistics-heading" className="panel">
        <h2 id="section-statistics-heading">{t("section.statistics")}</h2>
        <dl className="statistics">
          <div>
            <dt>{t("stats.total")}</dt>
            <dd>{section.counts.total}</dd>
          </div>
          <div>
            <dt>{t("stats.new")}</dt>
            <dd>{section.counts.new}</dd>
          </div>
          <div>
            <dt>{t("stats.due")}</dt>
            <dd>{section.counts.dueNow}</dd>
          </div>
        </dl>
      </section>
      <p>
        <Link to="import">{t("import.open")}</Link>
      </p>
      <button
        type="button"
        disabled
        aria-describedby={reviewDescriptionId}
      >
        {t("section.startReview")}
      </button>
      <p id={reviewDescriptionId}>{t("section.reviewUnavailable")}</p>
    </>
  );
}
