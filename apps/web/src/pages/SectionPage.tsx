import type { SectionSummary } from "@openrecall/contracts";
import { Link, useLoaderData } from "react-router";
import { useI18n } from "../app/I18nProvider.js";
import type { ApiClient } from "../api/client.js";
import { CardList } from "../cards/CardList.js";
import { StartReviewButton } from "../review/StartReviewButton.js";

export function SectionPage({ api }: { readonly api: ApiClient }) {
  const section = useLoaderData() as SectionSummary;
  const { t } = useI18n();

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
      <StartReviewButton api={api} sectionId={section.id} />
      <CardList api={api} sectionId={section.id} />
    </>
  );
}
