import type {
  SectionSummary,
  StudyStatistics,
} from "@openrecall/contracts";
import { useEffect, useState } from "react";
import { Link, useLoaderData, useNavigate } from "react-router";
import { useI18n } from "../app/I18nProvider.js";
import type { ApiClient } from "../api/client.js";
import { CardList } from "../cards/CardList.js";
import { StartReviewButton } from "../review/StartReviewButton.js";
import { SectionManagementPanel } from "../sections/SectionManagementPanel.js";
import { StatisticsDashboard } from "../statistics/StatisticsDashboard.js";

export interface SectionPageData {
  readonly section: SectionSummary;
  readonly statistics: StudyStatistics;
}

export function SectionPage({ api }: { readonly api: ApiClient }) {
  const { section, statistics } = useLoaderData() as SectionPageData;
  const [currentSection, setCurrentSection] = useState(section);
  const navigate = useNavigate();
  const { t } = useI18n();

  useEffect(() => setCurrentSection(section), [section]);

  return (
    <>
      <p>
        <Link to="/">{t("section.backHome")}</Link>
      </p>
      <h1 data-route-heading tabIndex={-1}>
        {currentSection.name}
      </h1>
      <section aria-labelledby="section-statistics-heading">
        <h2 id="section-statistics-heading">{t("section.statistics")}</h2>
        <StatisticsDashboard statistics={statistics} />
      </section>
      <p>
        <Link to="import">{t("import.open")}</Link>
      </p>
      <StartReviewButton api={api} sectionId={currentSection.id} />
      <CardList api={api} sectionId={currentSection.id} />
      <h2>{t("section.management.heading")}</h2>
      <SectionManagementPanel
        api={api}
        section={currentSection}
        onRenamed={setCurrentSection}
        onDeleted={() => {
          navigate("/", {
            replace: true,
            state: { announcementKey: "section.delete.success" },
          });
        }}
      />
    </>
  );
}
