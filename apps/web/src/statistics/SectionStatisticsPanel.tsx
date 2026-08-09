import type { StudyStatistics } from "@openrecall/contracts";
import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";
import { StatisticsDashboard } from "./StatisticsDashboard.js";

export function SectionStatisticsPanel({
  api,
  sectionId,
}: {
  readonly api: ApiClient;
  readonly sectionId: string;
}) {
  const [statistics, setStatistics] = useState<StudyStatistics | null>(null);
  const [busy, setBusy] = useState(true);
  const [failed, setFailed] = useState(false);
  const { t } = useI18n();

  const load = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const result = await api.get<StudyStatistics>(
        `/api/v1/sections/${encodeURIComponent(sectionId)}/statistics`,
      );
      setStatistics(result);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [api, sectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (busy) return <p role="status">{t("section.statistics.loading")}</p>;

  if (failed) {
    return (
      <div role="alert">
        <p>{t("section.statistics.loadError")}</p>
        <button type="button" onClick={() => void load()}>
          {t("serverUnavailable.retry")}
        </button>
      </div>
    );
  }

  return statistics === null ? null : (
    <StatisticsDashboard statistics={statistics} />
  );
}
