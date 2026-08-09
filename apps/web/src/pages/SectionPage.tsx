import type { SectionSummary } from "@openrecall/contracts";
import { useEffect, useState } from "react";
import { Link, useLoaderData, useNavigate } from "react-router";
import { useI18n } from "../app/I18nProvider.js";
import type { ApiClient } from "../api/client.js";
import { CardList } from "../cards/CardList.js";
import { StartReviewButton } from "../review/StartReviewButton.js";
import { DisclosurePanel } from "../sections/DisclosurePanel.js";
import { SectionManagementPanel } from "../sections/SectionManagementPanel.js";
import { SectionStatisticsPanel } from "../statistics/SectionStatisticsPanel.js";

export interface SectionPageData {
  readonly section: SectionSummary;
}

export function SectionPage({ api }: { readonly api: ApiClient }) {
  const { section } = useLoaderData() as SectionPageData;
  return <SectionPageContent key={section.id} api={api} section={section} />;
}

function SectionPageContent({
  api,
  section,
}: {
  readonly api: ApiClient;
  readonly section: SectionSummary;
}) {
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
      <p>
        <Link to="import">{t("import.open")}</Link>
      </p>
      <StartReviewButton api={api} sectionId={currentSection.id} />
      <DisclosurePanel id="section-statistics" label={t("section.statistics")}>
        <SectionStatisticsPanel api={api} sectionId={currentSection.id} />
      </DisclosurePanel>
      <DisclosurePanel id="section-cards" label={t("card.listTitle")}>
        <CardList api={api} sectionId={currentSection.id} />
      </DisclosurePanel>
      <DisclosurePanel
        id="section-management"
        label={t("section.management.heading")}
      >
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
      </DisclosurePanel>
    </>
  );
}
