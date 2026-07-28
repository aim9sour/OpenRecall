import type { StudyStatistics } from "@openrecall/contracts";
import { Link } from "react-router";
import { useI18n } from "../app/I18nProvider.js";
import { ActivityTable } from "./ActivityTable.js";
import { MetricSummary } from "./MetricSummary.js";
import { RatingDistribution } from "./RatingDistribution.js";
import { WorkloadForecast } from "./WorkloadForecast.js";

export function StatisticsDashboard({
  statistics,
}: {
  readonly statistics: StudyStatistics;
}) {
  const { t } = useI18n();

  return (
    <>
      <MetricSummary summary={statistics.summary} />

      <section aria-labelledby="state-counts-heading" className="panel">
        <h3 id="state-counts-heading">{t("statistics.currentState")}</h3>
        <dl className="statistics">
          {(
            [
              ["total", "stats.total"],
              ["dueNow", "stats.due"],
              ["new", "stats.new"],
              ["learning", "statistics.state.learning"],
              ["review", "statistics.state.review"],
              ["relearning", "statistics.state.relearning"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <dt>{t(label)}</dt>
              <dd>{statistics.stateCounts[key]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <RatingDistribution summary={statistics.summary} />
      <ActivityTable points={statistics.dailyActivity} />
      <WorkloadForecast points={statistics.workloadForecast} />

      {statistics.sections.length > 0 && (
        <section aria-labelledby="section-progress-heading" className="panel">
          <h3 id="section-progress-heading">
            {t("statistics.sectionProgress")}
          </h3>
          <div className="table-scroll">
            <table>
              <caption>{t("statistics.sectionProgressCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("statistics.section")}</th>
                  <th scope="col">{t("stats.total")}</th>
                  <th scope="col">{t("stats.due")}</th>
                  <th scope="col">{t("statistics.state.review")}</th>
                </tr>
              </thead>
              <tbody>
                {statistics.sections.map((section) => (
                  <tr key={section.sectionId}>
                    <th scope="row">
                      <Link to={`/sections/${section.sectionId}`}>
                        {section.name}
                      </Link>
                    </th>
                    <td>{section.total}</td>
                    <td>{section.dueNow}</td>
                    <td>{section.review}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
