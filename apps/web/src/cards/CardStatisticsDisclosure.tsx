import type { Card } from "@openrecall/contracts";
import { useState } from "react";
import { useI18n } from "../app/I18nProvider.js";

export function CardStatisticsDisclosure({ card }: { readonly card: Card }) {
  const [expanded, setExpanded] = useState(false);
  const { language, t } = useI18n();
  const panelId = `card-statistics-${card.id}`;

  return (
    <section>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? t("card.stats.hide") : t("card.stats.show")}
      </button>
      {expanded && (
        <div id={panelId}>
          <dl className="statistics">
            <div>
              <dt>{t("card.status")}</dt>
              <dd>{t(`card.lifecycle.${card.lifecycle}`)}</dd>
            </div>
            <div>
              <dt>{t("card.presentationCount")}</dt>
              <dd>{card.presentations.length}</dd>
            </div>
            <div>
              <dt>{t("card.updated")}</dt>
              <dd>
                <time dateTime={new Date(card.updatedAtMs).toISOString()}>
                  {new Intl.DateTimeFormat(language, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(card.updatedAtMs))}
                </time>
              </dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
