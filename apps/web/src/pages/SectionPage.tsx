import type {
  SectionSummary,
  StudyStatistics,
} from "@openrecall/contracts";
import { Link, useLoaderData } from "react-router";
import { useI18n } from "../app/I18nProvider.js";
import type { ApiClient } from "../api/client.js";
import { CardList } from "../cards/CardList.js";
import { StartReviewButton } from "../review/StartReviewButton.js";
import { StatisticsDashboard } from "../statistics/StatisticsDashboard.js";

export interface SectionPageData {
  readonly section: SectionSummary;
  readonly statistics: StudyStatistics;
}

export function SectionPage({ api }: { readonly api: ApiClient }) {
  const { section, statistics } = useLoaderData() as SectionPageData;
  const { t } = useI18n();

  return (
    <>
      <p>
        <Link to="/">{t("section.backHome")}</Link>
      </p>
      <h1 data-route-heading tabIndex={-1}>
        {section.name}
      </h1>
      <section aria-labelledby="section-statistics-heading">
        <h2 id="section-statistics-heading">{t("section.statistics")}</h2>
        <StatisticsDashboard statistics={statistics} />
      </section>
      <p>
        <Link to="import">{t("import.open")}</Link>
      </p>
      <StartReviewButton api={api} sectionId={section.id} />
      <CardList api={api} sectionId={section.id} />
    </>
  );
}
