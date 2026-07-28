import type {
  OptimizerEligibility,
  OptimizerRun,
} from "@openrecall/contracts";
import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";

const ACTIVE_STATUSES = new Set<OptimizerRun["status"]>([
  "queued",
  "running",
]);

export function OptimizerPanel({
  api,
  initialEligibility,
  pollIntervalMs = 1_000,
}: {
  readonly api: ApiClient;
  readonly initialEligibility: OptimizerEligibility;
  readonly pollIntervalMs?: number;
}) {
  const { t } = useI18n();
  const [eligibility, setEligibility] = useState(initialEligibility);
  const [run, setRun] = useState<OptimizerRun | null>(
    initialEligibility.activeRun,
  );
  const [announcement, setAnnouncement] = useState("");
  const [requestError, setRequestError] = useState("");
  const [starting, setStarting] = useState(false);
  const [pollTick, setPollTick] = useState(0);
  const lastAnnouncedBucket = useRef(0);

  useEffect(() => {
    setEligibility(initialEligibility);
    setRun(initialEligibility.activeRun);
    setAnnouncement("");
    setRequestError("");
    lastAnnouncedBucket.current = 0;
  }, [initialEligibility]);

  useEffect(() => {
    if (run === null || !ACTIVE_STATUSES.has(run.status)) return;
    let disposed = false;
    const timer = setTimeout(() => {
      void api
        .get<OptimizerRun>(
          `/api/v1/optimizer/runs/${encodeURIComponent(run.id)}`,
        )
        .then((updated) => {
          if (!disposed) {
            setRequestError("");
            setRun(updated);
            setPollTick((current) => current + 1);
          }
        })
        .catch(() => {
          if (!disposed) {
            setRequestError(t("optimizer.pollError"));
            setPollTick((current) => current + 1);
          }
        });
    }, Math.max(1, pollIntervalMs));
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [api, pollIntervalMs, pollTick, run, t]);

  useEffect(() => {
    if (run === null) return;
    if (ACTIVE_STATUSES.has(run.status)) {
      const bucket = Math.floor(run.progress * 10);
      if (
        bucket > 0 &&
        bucket > lastAnnouncedBucket.current &&
        bucket < 10
      ) {
        lastAnnouncedBucket.current = bucket;
        setAnnouncement(
          t("optimizer.progressAnnouncement", {
            percent: bucket * 10,
          }),
        );
      }
      return;
    }
    if (run.status === "succeeded") {
      setAnnouncement(t("optimizer.candidateReady"));
    } else if (run.status === "cancelled") {
      setAnnouncement(t("optimizer.cancelled"));
    } else if (run.status === "failed") {
      setAnnouncement(t("optimizer.failed"));
    }
  }, [run, t]);

  const start = async () => {
    setStarting(true);
    setRequestError("");
    lastAnnouncedBucket.current = 0;
    try {
      const started = await api.post<OptimizerRun>(
        "/api/v1/optimizer/runs",
        eligibility.scope,
      );
      setRun(started);
      setAnnouncement(t("optimizer.started"));
    } catch {
      setRequestError(t("optimizer.startError"));
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (run === null) return;
    setRequestError("");
    try {
      const updated = await api.post<OptimizerRun>(
        `/api/v1/optimizer/runs/${encodeURIComponent(run.id)}/cancel`,
        {},
      );
      setRun(updated);
      setAnnouncement(t("optimizer.cancelling"));
    } catch {
      setRequestError(t("optimizer.cancelError"));
    }
  };

  const active = run !== null && ACTIVE_STATUSES.has(run.status);
  const progressPercent =
    run === null ? 0 : Math.round(run.progress * 100);

  return (
    <section aria-labelledby="optimizer-heading" className="panel">
      <h2 id="optimizer-heading">{t("optimizer.title")}</h2>
      <p>{t("optimizer.description")}</p>

      <dl className="statistics">
        <div>
          <dt>{t("optimizer.rawReviews")}</dt>
          <dd>{eligibility.rawReviewCount}</dd>
        </div>
        <div>
          <dt>{t("optimizer.eligibleExamples")}</dt>
          <dd>{eligibility.eligibleExampleCount}</dd>
        </div>
        <div>
          <dt>{t("optimizer.minimum")}</dt>
          <dd>{eligibility.minimumEligibleExamples}</dd>
        </div>
      </dl>

      {eligibility.scope.scopeType === "section" &&
        eligibility.parameterSource.kind === "global" && (
          <p>{t("optimizer.sectionGlobalFallback")}</p>
        )}
      {eligibility.scope.scopeType === "section" &&
        eligibility.parameterSource.kind === "official" && (
          <p>{t("optimizer.sectionOfficialFallback")}</p>
        )}
      {!eligibility.canTrain && (
        <p>{t("optimizer.insufficientDescription")}</p>
      )}

      {run !== null && (
        <div className="optimizer-run">
          <h3>{t("optimizer.currentRun")}</h3>
          <p>
            {t("optimizer.status")}: {t(`optimizer.status.${run.status}`)}
          </p>
          <label htmlFor="optimizer-progress">
            {t("optimizer.progress", { percent: progressPercent })}
          </label>
          <progress
            id="optimizer-progress"
            max={100}
            value={progressPercent}
          >
            {progressPercent}%
          </progress>
          {run.status === "succeeded" && (
            <>
              <p>{t("optimizer.candidateReady")}</p>
              <dl className="statistics">
                <div>
                  <dt>{t("optimizer.logLoss")}</dt>
                  <dd>{run.metricLogLoss}</dd>
                </div>
                <div>
                  <dt>{t("optimizer.rmseBins")}</dt>
                  <dd>{run.metricRmseBins}</dd>
                </div>
              </dl>
            </>
          )}
          {run.status === "failed" && (
            <p>
              {t("optimizer.failed")} {run.errorCode}
            </p>
          )}
        </div>
      )}

      <div className="review-actions">
        <button
          disabled={!eligibility.canTrain || active || starting}
          onClick={() => void start()}
          type="button"
        >
          {starting ? t("optimizer.starting") : t("optimizer.train")}
        </button>
        {active && (
          <button onClick={() => void cancel()} type="button">
            {t("optimizer.cancel")}
          </button>
        )}
      </div>

      {requestError !== "" && <p role="alert">{requestError}</p>}
      <p
        aria-live="polite"
        className="sr-status"
        data-testid="optimizer-live"
      >
        {announcement}
      </p>
    </section>
  );
}
