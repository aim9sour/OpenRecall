import type { Card, CardStatistics } from "@openrecall/contracts";
import { useState } from "react";
import type { ApiClient } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";
import {
  formatDateTime,
  formatDuration,
  formatProbability,
} from "../statistics/format.js";

export function CardStatisticsDisclosure({
  api,
  card,
}: {
  readonly api: ApiClient;
  readonly card: Card;
}) {
  const [expanded, setExpanded] = useState(false);
  const [statistics, setStatistics] = useState<CardStatistics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { language, t } = useI18n();
  const panelId = `card-statistics-${card.id}`;

  const load = async (cursor: string | null): Promise<void> => {
    setBusy(true);
    setError("");
    try {
      const query =
        cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`;
      const incoming = await api.get<CardStatistics>(
        `/api/v1/cards/${card.id}/statistics${query}`,
      );
      setStatistics((current) =>
        cursor === null || current === null
          ? incoming
          : {
              ...incoming,
              history: {
                items: [...current.history.items, ...incoming.history.items],
                nextCursor: incoming.history.nextCursor,
              },
            },
      );
    } catch {
      setError(t("card.stats.loadError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => {
          setExpanded((value) => !value);
          if (!expanded && statistics === null && !busy) void load(null);
        }}
      >
        {expanded ? t("card.stats.hide") : t("card.stats.show")}
      </button>
      {expanded && (
        <div
          aria-busy={busy}
          className="card-statistics"
          id={panelId}
        >
          {busy && statistics === null && (
            <p role="status">{t("card.stats.loading")}</p>
          )}
          {error !== "" && <p role="alert">{error}</p>}
          {statistics !== null && (
            <>
              <dl className="statistics">
                <div>
                  <dt>{t("card.status")}</dt>
                  <dd>{t(`card.lifecycle.${statistics.lifecycle}`)}</dd>
                </div>
                <div>
                  <dt>{t("card.stats.memoryState")}</dt>
                  <dd>
                    {statistics.currentState === null
                      ? t("statistics.notEnoughData")
                      : t(
                          `card.stats.state.${statistics.currentState.memoryState}`,
                        )}
                  </dd>
                </div>
                <div>
                  <dt>{t("card.stats.due")}</dt>
                  <dd>
                    {formatDateTime(
                      statistics.currentState?.dueAtMs ?? null,
                      language,
                      t,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("card.stats.retrievability")}</dt>
                  <dd>
                    {formatProbability(
                      statistics.currentState?.retrievability ?? null,
                      language,
                      t,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("card.stats.stability")}</dt>
                  <dd>{statistics.currentState?.stability ?? t("statistics.notEnoughData")}</dd>
                </div>
                <div>
                  <dt>{t("card.stats.difficulty")}</dt>
                  <dd>{statistics.currentState?.difficulty ?? t("statistics.notEnoughData")}</dd>
                </div>
                <div>
                  <dt>{t("card.stats.repetitions")}</dt>
                  <dd>{statistics.currentState?.repetitions ?? 0}</dd>
                </div>
                <div>
                  <dt>{t("card.stats.lapses")}</dt>
                  <dd>{statistics.currentState?.lapses ?? 0}</dd>
                </div>
                <div>
                  <dt>{t("card.stats.lastReview")}</dt>
                  <dd>
                    {formatDateTime(
                      statistics.lastReview?.ratedAtMs ?? null,
                      language,
                      t,
                    )}
                  </dd>
                </div>
              </dl>

              <div className="table-scroll">
                <table>
                  <caption>{t("card.stats.exposureCaption")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("card.stats.presentation")}</th>
                      <th scope="col">{t("card.status")}</th>
                      <th scope="col">{t("card.stats.showCount")}</th>
                      <th scope="col">{t("card.stats.firstShown")}</th>
                      <th scope="col">{t("card.stats.lastShown")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statistics.presentations.map((presentation, index) => (
                      <tr key={presentation.presentationId}>
                        <th scope="row">
                          {index === 0
                            ? t("card.primary")
                            : t("card.variant", { number: index })}
                        </th>
                        <td>
                          {t(
                            `card.stats.presentationLifecycle.${presentation.lifecycle}`,
                          )}
                        </td>
                        <td>{presentation.showCount}</td>
                        <td>
                          {formatDateTime(
                            presentation.firstShownAtMs,
                            language,
                            t,
                          )}
                        </td>
                        <td>
                          {formatDateTime(
                            presentation.lastShownAtMs,
                            language,
                            t,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="table-scroll">
                <table>
                  <caption>{t("card.stats.historyCaption")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("card.stats.reviewedAt")}</th>
                      <th scope="col">{t("import.front")}</th>
                      <th scope="col">{t("import.back")}</th>
                      <th scope="col">{t("card.notes")}</th>
                      <th scope="col">{t("review.summary.rating")}</th>
                      <th scope="col">
                        {t("card.stats.retrievabilityBefore")}
                      </th>
                      <th scope="col">
                        {t("statistics.metric.studyDurationMs")}
                      </th>
                      <th scope="col">{t("card.stats.resultingDue")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statistics.history.items.map((item) => (
                      <tr key={item.id}>
                        <th scope="row">
                          {formatDateTime(item.ratedAtMs, language, t)}
                        </th>
                        <td dir="auto">{item.frontSnapshot}</td>
                        <td dir="auto">{item.backSnapshot}</td>
                        <td dir="auto">
                          {item.notesSnapshot ?? t("statistics.notAvailable")}
                        </td>
                        <td>
                          {t(
                            `review.rating.${["", "again", "hard", "good", "easy"][item.rating]}`,
                          )}
                        </td>
                        <td>
                          {formatProbability(
                            item.retrievabilityBefore,
                            language,
                            t,
                          )}
                        </td>
                        <td>
                          {item.durationMs === null
                            ? t("statistics.notAvailable")
                            : formatDuration(item.durationMs, language, t)}
                        </td>
                        <td>
                          {formatDateTime(
                            item.resultingDueAtMs,
                            language,
                            t,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {statistics.history.nextCursor !== null && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void load(statistics.history.nextCursor)
                  }
                >
                  {t("card.stats.moreHistory")}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
