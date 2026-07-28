import type { StudyStatistics } from "@openrecall/contracts";
import { useI18n } from "../app/I18nProvider.js";
import { AccessibleBarChart } from "./AccessibleBarChart.js";
import { formatStudyDay } from "./format.js";

export function WorkloadForecast({
  points,
}: {
  readonly points: StudyStatistics["workloadForecast"];
}) {
  const { language, t } = useI18n();
  const rows = points.map((point) => ({
    key: point.studyDay,
    label: (
      <time dateTime={point.studyDay}>
        {formatStudyDay(point.studyDay, language)}
      </time>
    ),
    value: point.count,
  }));

  return (
    <section aria-labelledby="workload-heading" className="panel">
      <h3 id="workload-heading">{t("statistics.workload")}</h3>
      <p>{t("statistics.workloadSummary")}</p>
      <AccessibleBarChart
        caption={t("statistics.workloadTableCaption")}
        dataChart="workload-forecast"
        labelHeading={t("statistics.studyDay")}
        rows={rows}
        valueHeading={t("statistics.dueCards")}
      />
    </section>
  );
}
