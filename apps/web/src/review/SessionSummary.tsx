import type { SessionSummary as SessionSummaryValue } from "@openrecall/contracts";
import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { useI18n } from "../app/I18nProvider.js";

export function SessionSummary({
  summary,
}: {
  readonly summary: SessionSummaryValue;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const rows = [
    ["review.rating.again", summary.ratingCounts.again],
    ["review.rating.hard", summary.ratingCounts.hard],
    ["review.rating.good", summary.ratingCounts.good],
    ["review.rating.easy", summary.ratingCounts.easy],
  ] as const;

  return (
    <section>
      <h1 ref={headingRef} tabIndex={-1}>
        {t("review.completed")}
      </h1>
      <dl className="statistics">
        <div>
          <dt>{t("review.summary.events")}</dt>
          <dd>{summary.reviewEvents}</dd>
        </div>
        <div>
          <dt>{t("review.summary.unique")}</dt>
          <dd>{summary.uniqueItems}</dd>
        </div>
        <div>
          <dt>{t("review.summary.repeats")}</dt>
          <dd>{summary.repeatedWithinSession}</dd>
        </div>
        <div>
          <dt>{t("review.summary.duration")}</dt>
          <dd>{t("review.seconds", { count: Math.round(summary.elapsedActiveMs / 1_000) })}</dd>
        </div>
      </dl>
      <table aria-label={t("review.summary.ratingDistribution")}>
        <thead>
          <tr>
            <th scope="col">{t("review.summary.rating")}</th>
            <th scope="col">{t("review.summary.count")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, count]) => (
            <tr key={key}>
              <th scope="row">{t(key)}</th>
              <td>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="review-actions">
        <Link to="/">{t("nav.home")}</Link>
        <Link to={`/sections/${summary.sectionId}`}>
          {t("review.backSection")}
        </Link>
      </div>
    </section>
  );
}
