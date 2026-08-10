import type {
  OptimizerScope,
  SchedulerSettings,
  StepRecommendationPart,
  StepRecommendationRun,
  StepRecommendationValues,
  StepRatingStatistics,
} from "@openrecall/contracts";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { ApiClientError, type ApiClient } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";

const ACTIVE_STATUSES = new Set<StepRecommendationRun["status"]>([
  "queued",
  "running",
]);

type PendingAction =
  | { readonly kind: "apply"; readonly parts: readonly StepRecommendationPart[] }
  | { readonly kind: "restore" };

function groupEntries(
  run: StepRecommendationRun,
): readonly [string, StepRatingStatistics | null][] {
  if (run.result === null) return [];
  return [
    ["again", run.result.statistics.again],
    ["hard", run.result.statistics.hard],
    ["good", run.result.statistics.good],
    ["againThenGood", run.result.statistics.againThenGood],
    ["goodThenAgain", run.result.statistics.goodThenAgain],
    ["relearning", run.result.statistics.relearning],
  ];
}

export function StepRecommendationPanel({
  api,
  currentSettings,
  onSettingsChanged,
  pollIntervalMs = 1_000,
  scope,
}: {
  readonly api: ApiClient;
  readonly currentSettings: SchedulerSettings;
  readonly onSettingsChanged: (scope: OptimizerScope) => Promise<void> | void;
  readonly pollIntervalMs?: number;
  readonly scope: OptimizerScope;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const [opened, setOpened] = useState(false);
  const [run, setRun] = useState<StepRecommendationRun | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [requestError, setRequestError] = useState("");
  const [starting, setStarting] = useState(false);
  const [pollTick, setPollTick] = useState(0);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const analyzeRef = useRef<HTMLButtonElement>(null);
  const dialogOpenerRef = useRef<HTMLButtonElement>(null);
  const lastTerminalRef = useRef("");
  const scopeKey = `${scope.scopeType}:${scope.sectionId ?? ""}`;
  const activeScopeKeyRef = useRef(scopeKey);
  const requestGenerationRef = useRef(0);
  activeScopeKeyRef.current = scopeKey;

  const number = new Intl.NumberFormat(i18n.language);
  const percent = new Intl.NumberFormat(i18n.language, {
    style: "percent",
    maximumFractionDigits: 1,
  });

  const formatDuration = (rawSeconds: number): string => {
    const seconds = Math.max(0, Math.floor(rawSeconds));
    const unit = (value: number, singular: string, plural: string) =>
      t(value === 1 ? singular : plural, { count: number.format(value) });
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const remainingSeconds = seconds % 60;
    const parts: string[] = [];
    if (days > 0) {
      parts.push(unit(days, "optimizer.steps.duration.day", "optimizer.steps.duration.days"));
    }
    if (hours > 0) {
      parts.push(unit(hours, "optimizer.steps.duration.hour", "optimizer.steps.duration.hours"));
    }
    if (minutes > 0) {
      parts.push(unit(minutes, "optimizer.steps.duration.minute", "optimizer.steps.duration.minutes"));
    }
    if (remainingSeconds > 0 || parts.length === 0) {
      parts.push(unit(
        remainingSeconds,
        "optimizer.steps.duration.second",
        "optimizer.steps.duration.seconds",
      ));
    }
    return new Intl.ListFormat(i18n.language, {
      style: "long",
      type: "unit",
    }).format(parts);
  };

  const formatMinutes = (minutes: readonly number[]): string => {
    if (minutes.length === 0) return t("optimizer.steps.none");
    return new Intl.ListFormat(i18n.language, {
      style: "long",
      type: "conjunction",
    }).format(minutes.map((value) => formatDuration(value * 60)));
  };

  useEffect(() => {
    if (expanded) analyzeRef.current?.focus();
  }, [expanded]);

  useEffect(() => {
    requestGenerationRef.current += 1;
    setRun(null);
    setAnnouncement("");
    setRequestError("");
    setStarting(false);
    setStale(false);
    setPending(null);
    setMutationBusy(false);
    lastTerminalRef.current = "";
  }, [scopeKey]);

  const beginRequest = () => ({
    generation: ++requestGenerationRef.current,
    scopeKey,
  });
  const requestIsCurrent = (request: ReturnType<typeof beginRequest>) =>
    request.generation === requestGenerationRef.current &&
    request.scopeKey === activeScopeKeyRef.current;

  useEffect(() => {
    if (run === null || !ACTIVE_STATUSES.has(run.status)) return;
    let disposed = false;
    const timer = setTimeout(() => {
      void api
        .get<StepRecommendationRun>(
          `/api/v1/optimizer/step-recommendations/${encodeURIComponent(run.id)}`,
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
            setRequestError(t("optimizer.steps.pollError"));
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
    if (run === null || ACTIVE_STATUSES.has(run.status)) return;
    const key = `${run.id}:${run.status}`;
    if (lastTerminalRef.current === key) return;
    lastTerminalRef.current = key;
    if (run.status === "succeeded") {
      setAnnouncement(t("optimizer.steps.complete"));
    } else if (run.status === "cancelled") {
      setAnnouncement(t("optimizer.steps.cancelled"));
    } else {
      setAnnouncement(t("optimizer.steps.failed"));
    }
  }, [run, t]);

  const start = async () => {
    const request = beginRequest();
    setStarting(true);
    setRequestError("");
    setStale(false);
    lastTerminalRef.current = "";
    try {
      const started = await api.post<StepRecommendationRun>(
        "/api/v1/optimizer/step-recommendations",
        { scope },
      );
      if (!requestIsCurrent(request)) return;
      setRun(started);
      setAnnouncement(t("optimizer.steps.started"));
    } catch {
      if (!requestIsCurrent(request)) return;
      setRequestError(t("optimizer.steps.startError"));
    } finally {
      if (requestIsCurrent(request)) setStarting(false);
    }
  };

  const cancel = async () => {
    if (run === null) return;
    const request = beginRequest();
    setRequestError("");
    try {
      const updated = await api.post<StepRecommendationRun>(
        `/api/v1/optimizer/step-recommendations/${encodeURIComponent(run.id)}/cancel`,
        {},
      );
      if (!requestIsCurrent(request)) return;
      setRun(updated);
      setAnnouncement(t("optimizer.steps.cancelling"));
    } catch {
      if (!requestIsCurrent(request)) return;
      setRequestError(t("optimizer.steps.cancelError"));
    }
  };

  const openAction = (
    action: PendingAction,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    dialogOpenerRef.current = event.currentTarget;
    setPending(action);
  };

  const partsLabel = (parts: readonly StepRecommendationPart[]): string => {
    if (parts.length === 2) return t("optimizer.steps.parts.both");
    return parts[0] === "learning"
      ? t("optimizer.steps.parts.learning")
      : t("optimizer.steps.parts.relearning");
  };

  const handleApiConflict = (error: unknown): boolean => {
    if (!(error instanceof ApiClientError) || error.status !== 409) {
      return false;
    }
    if (error.envelope.code === "STEP_RECOMMENDATION_STALE") {
      setStale(true);
      setRequestError(t("optimizer.steps.stale"));
      setAnnouncement(t("optimizer.steps.stale"));
      return true;
    }
    if (error.envelope.code === "STEP_RECOMMENDATION_NOT_APPLICABLE") {
      setRequestError(t("optimizer.steps.notApplicable"));
      return true;
    }
    if (error.envelope.code === "STEP_RECOMMENDATION_RESTORE_STALE") {
      setRequestError(t("optimizer.steps.restoreStale"));
      return true;
    }
    if (error.envelope.code === "STEP_RECOMMENDATION_CONFLICT") {
      setStale(true);
      setRequestError(t("optimizer.steps.conflict"));
      return true;
    }
    return false;
  };

  const refreshSettings = async (
    expectedScope: OptimizerScope,
    request: ReturnType<typeof beginRequest>,
  ) => {
    try {
      await onSettingsChanged(expectedScope);
    } catch {
      if (requestIsCurrent(request)) {
        setRequestError(t("optimizer.steps.refreshError"));
      }
    }
  };

  const confirmAction = async () => {
    if (run === null || pending === null) return;
    const request = beginRequest();
    const expectedScope = scope;
    setMutationBusy(true);
    setRequestError("");
    const action = pending;
    try {
      if (action.kind === "apply") {
        const updated = await api.post<StepRecommendationRun>(
          `/api/v1/optimizer/step-recommendations/${encodeURIComponent(run.id)}/apply`,
          { parts: action.parts, revisionToken: run.revisionToken },
        );
        if (!requestIsCurrent(request)) return;
        setRun(updated);
        setAnnouncement(t("optimizer.steps.applied", {
          parts: partsLabel(action.parts),
        }));
      } else {
        const updated = await api.post<StepRecommendationRun>(
          `/api/v1/optimizer/step-recommendations/${encodeURIComponent(run.id)}/restore`,
          { revisionToken: run.revisionToken },
        );
        if (!requestIsCurrent(request)) return;
        setRun(updated);
        setAnnouncement(t("optimizer.steps.restored"));
      }
      setPending(null);
      await refreshSettings(expectedScope, request);
    } catch (error) {
      if (!requestIsCurrent(request)) return;
      setPending(null);
      if (!handleApiConflict(error)) {
        setRequestError(
          action.kind === "apply"
            ? t("optimizer.steps.applyError")
            : t("optimizer.steps.restoreError"),
        );
      }
    } finally {
      if (requestIsCurrent(request)) setMutationBusy(false);
    }
  };

  const active = run !== null && ACTIVE_STATUSES.has(run.status);
  const succeeded = run?.status === "succeeded" && run.result !== null;
  const alreadyApplied = run?.appliedAtMs !== null && run?.appliedAtMs !== undefined;
  const canApply = (part: StepRecommendationPart): boolean =>
    succeeded &&
    !stale &&
    !alreadyApplied &&
    (run.result?.[part].applicableMinutes.length ?? 0) > 0;

  const renderValues = (
    part: StepRecommendationPart,
    values: StepRecommendationValues,
  ) => (
    <section className="step-recommendation-values">
      <h4>{t(`optimizer.steps.parts.${part}`)}</h4>
      {values.rawSeconds.length === 0 ? (
        <p>{t("optimizer.steps.noRecommendation")}</p>
      ) : (
        <dl>
          <div>
            <dt>{t("optimizer.steps.officialRecommendation")}</dt>
            <dd>{new Intl.ListFormat(i18n.language).format(
              values.rawSeconds.map(formatDuration),
            )}</dd>
          </div>
          <div>
            <dt>{t("optimizer.steps.savedValue")}</dt>
            <dd>{formatMinutes(values.applicableMinutes)}</dd>
          </div>
        </dl>
      )}
      {values.belowResolutionSeconds.length > 0 && (
        <p>{t("optimizer.steps.belowResolution")}</p>
      )}
    </section>
  );

  const pendingDescription = (() => {
    if (pending === null || run === null) return "";
    if (pending.kind === "restore") {
      return t("optimizer.steps.restoreDescription");
    }
    const oldValues = pending.parts.map((part) =>
      formatMinutes(
        part === "learning"
          ? currentSettings.learningStepsMinutes
          : currentSettings.relearningStepsMinutes,
      ),
    ).join("; ");
    const newValues = pending.parts.map((part) =>
      formatMinutes(run.result?.[part].applicableMinutes ?? []),
    ).join("; ");
    return t("optimizer.steps.applyDescription", {
      old: oldValues,
      next: newValues,
      parts: partsLabel(pending.parts),
    });
  })();

  return (
    <section className="panel">
      <h2>
        <button
          aria-controls={panelId}
          aria-expanded={expanded}
          className="disclosure-toggle"
          onClick={() => {
            setOpened(true);
            setExpanded((current) => !current);
          }}
          type="button"
        >
          {t("optimizer.steps.title")}
        </button>
      </h2>
      {opened && (
        <div hidden={!expanded} id={panelId}>
          <p>{t("optimizer.steps.description")}</p>
          <p>{t("optimizer.steps.threshold")}</p>
          <div className="review-actions">
            <button
              ref={analyzeRef}
              disabled={active || starting}
              onClick={() => void start()}
              type="button"
            >
              {starting
                ? t("optimizer.steps.starting")
                : stale
                  ? t("optimizer.steps.analyzeAgain")
                  : t("optimizer.steps.analyze")}
            </button>
            {active && (
              <button onClick={() => void cancel()} type="button">
                {t("optimizer.steps.cancel")}
              </button>
            )}
          </div>

          {active && <p>{t("optimizer.steps.analyzing")}</p>}
          {run?.status === "failed" && (
            <p>{t("optimizer.steps.failedDetail", { code: run.errorCode ?? "" })}</p>
          )}

          {succeeded && run.result !== null && (
            <div className="step-recommendation-results">
              <h3>{t("optimizer.steps.results")}</h3>
              <dl className="statistics">
                <div><dt>{t("optimizer.steps.rawReviews")}</dt><dd>{number.format(run.result.rawReviewCount)}</dd></div>
                <div><dt>{t("optimizer.steps.validReviews")}</dt><dd>{number.format(run.result.validReviewCount)}</dd></div>
                <div><dt>{t("optimizer.steps.validSequences")}</dt><dd>{number.format(run.result.validSequenceCount)}</dd></div>
                <div><dt>{t("optimizer.steps.excludedSequences")}</dt><dd>{number.format(run.result.excludedSequenceCount)}</dd></div>
              </dl>

              <h4>{t("optimizer.steps.currentValues")}</h4>
              <dl>
                <div><dt>{t("optimizer.steps.parts.learning")}</dt><dd>{formatMinutes(currentSettings.learningStepsMinutes)}</dd></div>
                <div><dt>{t("optimizer.steps.parts.relearning")}</dt><dd>{formatMinutes(currentSettings.relearningStepsMinutes)}</dd></div>
              </dl>
              <div className="step-recommendation-grid">
                {renderValues("learning", run.result.learning)}
                {renderValues("relearning", run.result.relearning)}
              </div>

              <h4>{t("optimizer.steps.exclusions")}</h4>
              <dl className="statistics">
                {(Object.entries(run.result.exclusions) as Array<
                  [keyof typeof run.result.exclusions, number]
                >).map(([reason, count]) => (
                  <div key={reason}>
                    <dt>{t(`optimizer.steps.exclusion.${reason}`)}</dt>
                    <dd>{number.format(count)}</dd>
                  </div>
                ))}
              </dl>

              <div className="step-statistics-groups">
                {groupEntries(run).map(([group, stats]) => stats === null ? null : (
                  <section key={group}>
                    <h4>{t("optimizer.steps.groupHeading", {
                      group: t(`optimizer.steps.group.${group}`),
                    })}</h4>
                    <dl className="statistics">
                      <div><dt>{t("optimizer.steps.samples")}</dt><dd>{number.format(stats.count)}</dd></div>
                      <div><dt>{t("optimizer.steps.delayQ1")}</dt><dd>{formatDuration(stats.delayQ1Seconds)}</dd></div>
                      <div><dt>{t("optimizer.steps.delayQ2")}</dt><dd>{formatDuration(stats.delayQ2Seconds)}</dd></div>
                      <div><dt>{t("optimizer.steps.delayQ3")}</dt><dd>{formatDuration(stats.delayQ3Seconds)}</dd></div>
                      <div><dt>{t("optimizer.steps.retention")}</dt><dd>{percent.format(stats.retention)}</dd></div>
                      <div><dt>{t("optimizer.steps.stability")}</dt><dd>{formatDuration(stats.stabilitySeconds)}</dd></div>
                    </dl>
                  </section>
                ))}
              </div>

              {!alreadyApplied ? (
                <div className="review-actions">
                  <button disabled={!canApply("learning")} onClick={(event) => openAction({ kind: "apply", parts: ["learning"] }, event)} type="button">{t("optimizer.steps.applyLearning")}</button>
                  <button disabled={!canApply("relearning")} onClick={(event) => openAction({ kind: "apply", parts: ["relearning"] }, event)} type="button">{t("optimizer.steps.applyRelearning")}</button>
                  <button disabled={!canApply("learning") || !canApply("relearning")} onClick={(event) => openAction({ kind: "apply", parts: ["learning", "relearning"] }, event)} type="button">{t("optimizer.steps.applyBoth")}</button>
                </div>
              ) : run.restoredAtMs === null ? (
                <button onClick={(event) => openAction({ kind: "restore" }, event)} type="button">{t("optimizer.steps.restore")}</button>
              ) : (
                <p>{t("optimizer.steps.restored")}</p>
              )}
            </div>
          )}

          {requestError !== "" && <p role="alert">{requestError}</p>}
          <p aria-live="polite" className="sr-status" data-testid="step-live">
            {announcement}
          </p>
        </div>
      )}
      {pending !== null && (
        <ConfirmDialog
          busy={mutationBusy}
          cancelLabel={t("optimizer.steps.dialogCancel")}
          confirmLabel={
            pending.kind === "apply"
              ? t("optimizer.steps.confirmApply")
              : t("optimizer.steps.confirmRestore")
          }
          description={pendingDescription}
          onCancel={() => setPending(null)}
          onConfirm={() => void confirmAction()}
          openerRef={dialogOpenerRef}
          title={
            pending.kind === "apply"
              ? t("optimizer.steps.applyTitle")
              : t("optimizer.steps.restoreTitle")
          }
        />
      )}
    </section>
  );
}
