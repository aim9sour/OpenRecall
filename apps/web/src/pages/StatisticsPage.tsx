import type {
  SectionSummary,
  StudyStatistics,
} from "@openrecall/contracts";
import { useEffect, useRef } from "react";
import {
  Form,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";
import { useI18n } from "../app/I18nProvider.js";
import { StatisticsDashboard } from "../statistics/StatisticsDashboard.js";

export interface StatisticsPageData {
  readonly sections: readonly SectionSummary[];
  readonly statistics: StudyStatistics;
}

export function StatisticsPage() {
  const { sections, statistics } = useLoaderData() as StatisticsPageData;
  const location = useLocation();
  const navigation = useNavigation();
  const { t } = useI18n();
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousSearchRef = useRef(location.search);
  const search = new URLSearchParams(location.search);

  useEffect(() => {
    if (
      navigation.state === "idle" &&
      previousSearchRef.current !== location.search
    ) {
      previousSearchRef.current = location.search;
      resultsHeadingRef.current?.focus();
    }
  }, [location.search, navigation.state, statistics]);

  return (
    <>
      <h1 data-route-heading tabIndex={-1}>
        {t("statistics.title")}
      </h1>
      <Form className="panel filter-form" key={location.search} method="get">
        <h2>{t("statistics.filters")}</h2>
        <label htmlFor="statistics-section">
          {t("statistics.section")}
        </label>
        <select
          defaultValue={search.get("sectionId") ?? ""}
          id="statistics-section"
          name="sectionId"
        >
          <option value="">{t("statistics.allSections")}</option>
          {sections.map((section) => (
            <option key={section.id} value={section.id}>
              {section.name}
            </option>
          ))}
        </select>
        <label htmlFor="statistics-from">
          {t("statistics.fromStudyDay")}
        </label>
        <input
          defaultValue={search.get("fromStudyDay") ?? ""}
          id="statistics-from"
          name="fromStudyDay"
          type="date"
        />
        <label htmlFor="statistics-to">{t("statistics.toStudyDay")}</label>
        <input
          defaultValue={search.get("toStudyDay") ?? ""}
          id="statistics-to"
          name="toStudyDay"
          type="date"
        />
        <button type="submit">{t("statistics.applyFilters")}</button>
      </Form>

      <section aria-labelledby="statistics-results-heading">
        <h2
          id="statistics-results-heading"
          ref={resultsHeadingRef}
          tabIndex={-1}
        >
          {t("statistics.results")}
        </h2>
        <StatisticsDashboard statistics={statistics} />
      </section>
    </>
  );
}
