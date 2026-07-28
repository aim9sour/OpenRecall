import type { StatisticsSummary } from "@openrecall/contracts";
import { useI18n } from "../app/I18nProvider.js";
import { AccessibleBarChart } from "./AccessibleBarChart.js";

export function RatingDistribution({
  summary,
}: {
  readonly summary: StatisticsSummary;
}) {
  const { t } = useI18n();
  const rows = ([1, 2, 3, 4] as const).map((rating) => ({
    key: String(rating),
    label: t(
      [
        "",
        "review.rating.again",
        "review.rating.hard",
        "review.rating.good",
        "review.rating.easy",
      ][rating]!,
    ),
    value: summary.ratingCounts[rating],
  }));

  return (
    <section aria-labelledby="rating-distribution-heading" className="panel">
      <h3 id="rating-distribution-heading">
        {t("statistics.ratingDistribution")}
      </h3>
      <p>
        {summary.reviewEvents === 0
          ? t("statistics.noRatings")
          : t("statistics.ratingSummary", {
              successful:
                summary.ratingCounts[2] +
                summary.ratingCounts[3] +
                summary.ratingCounts[4],
              total: summary.reviewEvents,
            })}
      </p>
      <AccessibleBarChart
        caption={t("statistics.ratingTableCaption")}
        dataChart="rating-distribution"
        labelHeading={t("review.summary.rating")}
        rows={rows}
        valueHeading={t("review.summary.count")}
      />
    </section>
  );
}
