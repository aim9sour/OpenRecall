import type { StudyStatistics } from "@openrecall/contracts";
import { useI18n } from "../app/I18nProvider.js";
import { formatDuration, formatStudyDay } from "./format.js";

export function ActivityTable({
  points,
}: {
  readonly points: StudyStatistics["dailyActivity"];
}) {
  const { language, t } = useI18n();

  return (
    <section aria-labelledby="daily-activity-heading" className="panel">
      <h3 id="daily-activity-heading">{t("statistics.dailyActivity")}</h3>
      {points.length === 0 ? (
        <p>{t("statistics.noActivity")}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <caption>{t("statistics.activityTableCaption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("statistics.studyDay")}</th>
                <th scope="col">{t("statistics.metric.reviewEvents")}</th>
                <th scope="col">{t("statistics.metric.uniqueItems")}</th>
                <th scope="col">
                  {t("statistics.metric.studyDurationMs")}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.studyDay}>
                  <th scope="row">
                    <time dateTime={point.studyDay}>
                      {formatStudyDay(point.studyDay, language)}
                    </time>
                  </th>
                  <td>{point.reviewEvents}</td>
                  <td>{point.uniqueItems}</td>
                  <td>
                    {formatDuration(point.durationMs, language, t)}
                    {point.durationExcluded > 0 &&
                      ` ${t("statistics.durationExcluded", {
                        count: point.durationExcluded,
                      })}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
