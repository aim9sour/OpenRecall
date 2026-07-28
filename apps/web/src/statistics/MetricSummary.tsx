import type { StatisticsSummary } from "@openrecall/contracts";
import { useI18n } from "../app/I18nProvider.js";
import { formatDuration, formatProbability } from "./format.js";

export function MetricSummary({
  summary,
}: {
  readonly summary: StatisticsSummary;
}) {
  const { language, t } = useI18n();

  return (
    <dl className="statistics metric-summary">
      <div>
        <dt>{t("statistics.metric.reviewEvents")}</dt>
        <dd>{new Intl.NumberFormat(language).format(summary.reviewEvents)}</dd>
      </div>
      <div>
        <dt>{t("statistics.metric.uniqueItems")}</dt>
        <dd>{new Intl.NumberFormat(language).format(summary.uniqueItems)}</dd>
      </div>
      <div>
        <dt>{t("statistics.metric.actualRecall")}</dt>
        <dd>
          {formatProbability(summary.actualRecall, language, t)}
        </dd>
      </div>
      <div>
        <dt>{t("statistics.metric.predictedRetrievability")}</dt>
        <dd>
          {formatProbability(
            summary.meanPredictedRetrievability,
            language,
            t,
          )}
          {summary.retrievabilityExcluded > 0 && (
            <small>
              {t("statistics.excluded", {
                count: summary.retrievabilityExcluded,
              })}
            </small>
          )}
        </dd>
      </div>
      <div>
        <dt>{t("statistics.metric.studyDurationMs")}</dt>
        <dd>
          {formatDuration(summary.studyDurationMs, language, t)}
          {summary.durationExcluded > 0 && (
            <small>
              {t("statistics.durationExcluded", {
                count: summary.durationExcluded,
              })}
            </small>
          )}
        </dd>
      </div>
    </dl>
  );
}
