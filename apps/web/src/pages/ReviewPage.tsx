import type { ReviewPageState } from "@openrecall/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLoaderData, useLocation } from "react-router";
import type { ApiClient } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";
import { RatingButtons } from "../review/RatingButtons.js";
import { SessionProgress } from "../review/SessionProgress.js";
import { EndSessionDialog } from "../review/EndSessionDialog.js";
import { SessionSummary } from "../review/SessionSummary.js";
import { WaitingState } from "../review/WaitingState.js";
import { useReviewEvents } from "../review/use-review-events.js";
import { useReviewShortcuts } from "../review/use-review-shortcuts.js";

const MAX_CLIENT_TIMER_DELAY_MS = 2_147_000_000;
const CLAIM_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;

function sessionIdOf(state: ReviewPageState): string {
  return state.kind === "completed"
    ? state.summary.sessionId
    : state.session.id;
}

function reviewContentKey(state: ReviewPageState): string {
  return state.kind === "question" || state.kind === "answer"
    ? `${state.kind}:${state.card.entryId}`
    : state.kind;
}

export function ReviewPage({ api }: { readonly api: ApiClient }) {
  const loaderState = useLoaderData() as ReviewPageState;
  const { t } = useI18n();
  const location = useLocation();
  const navigationState: unknown = location.state;
  const initialNoticeKey =
    typeof navigationState === "object" &&
    navigationState !== null &&
    "reviewNoticeKey" in navigationState &&
    typeof navigationState.reviewNoticeKey === "string"
      ? navigationState.reviewNoticeKey
      : null;
  const [page, setPage] = useState(loaderState);
  const [busy, setBusy] = useState(false);
  const [shownEntryId, setShownEntryId] = useState<string | null>(null);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [claimWakeRevision, setClaimWakeRevision] = useState(0);
  const [announcement, setAnnouncement] = useState(
    initialNoticeKey === null ? "" : t(initialNoticeKey),
  );
  const questionRef = useRef<HTMLParagraphElement>(null);
  const answerRef = useRef<HTMLParagraphElement>(null);
  const pausedHeadingRef = useRef<HTMLHeadingElement>(null);
  const endButtonRef = useRef<HTMLButtonElement>(null);
  const previousRevision = useRef(
    loaderState.kind === "completed" ? -1 : loaderState.session.revision,
  );
  const claimInFlight = useRef<Promise<void> | null>(null);
  const claimGeneration = useRef(0);
  const interactionBlocked = useRef(false);
  const dueDeadline = useRef<{
    readonly key: string;
    readonly atPerformanceMs: number;
  } | null>(null);
  const dialogOpenedContentKey = useRef<string | null>(null);
  const dialogWasOpen = useRef(false);
  const sessionId = sessionIdOf(page);
  const activeReview =
    page.kind !== "completed" && page.session.status === "active";

  useReviewEvents(sessionId);

  useEffect(() => {
    claimGeneration.current += 1;
    setPage(loaderState);
  }, [loaderState]);

  useEffect(() => {
    if (page.kind === "completed") {
      return;
    }
    if (
      page.session.revision !== previousRevision.current &&
      page.session.newlyJoined > 0
    ) {
      setAnnouncement(
        t("review.joined", { count: page.session.newlyJoined }),
      );
    }
    previousRevision.current = page.session.revision;
  }, [page, t]);

  useEffect(() => {
    if (endDialogOpen) {
      dialogWasOpen.current = true;
      return;
    }
    if (dialogWasOpen.current) {
      dialogWasOpen.current = false;
      if (
        (page.kind === "question" || page.kind === "answer") &&
        page.session.status === "paused"
      ) {
        pausedHeadingRef.current?.focus();
        return;
      }
      if (dialogOpenedContentKey.current === reviewContentKey(page)) {
        return;
      }
    }
    if (
      (page.kind === "question" || page.kind === "answer") &&
      page.session.status === "paused"
    ) {
      pausedHeadingRef.current?.focus();
    } else if (page.kind === "question") {
      questionRef.current?.focus();
    } else if (page.kind === "answer") {
      answerRef.current?.focus();
    }
  }, [
    page.kind,
    page.kind === "question" || page.kind === "answer"
      ? page.card.entryId
      : "",
    page.kind === "question" || page.kind === "answer"
      ? page.session.status
      : "",
    endDialogOpen,
  ]);

  useEffect(() => {
    if (page.kind !== "question" || page.session.status !== "active") {
      return;
    }
    const entryId = page.card.entryId;
    void api
      .post<void>(
        `/api/v1/review-sessions/${encodeURIComponent(page.session.id)}/current/shown`,
        {
          entryId,
          presentationId: page.card.presentationId,
        },
      )
      .then(() => setShownEntryId(entryId))
      .catch(() => setAnnouncement(t("review.error")));
  }, [api, page, t]);

  useEffect(() => {
    if (
      page.kind !== "waiting" ||
      page.session.status !== "active"
    ) {
      return;
    }

    const delayMs =
      page.session.currentlyRemaining > 0
        ? 0
        : page.nextDueAtMs === null
          ? null
          : Math.max(
              0,
              page.nextDueAtMs - page.session.remainingSnapshotAtMs,
            );
    if (delayMs === null) {
      return;
    }

    const deadlineKey = [
      page.session.id,
      page.session.revision,
      page.session.remainingSnapshotAtMs,
      page.nextDueAtMs,
      page.session.currentlyRemaining,
    ].join(":");
    if (dueDeadline.current?.key !== deadlineKey) {
      dueDeadline.current = {
        key: deadlineKey,
        atPerformanceMs: window.performance.now() + delayMs,
      };
    }

    let cancelled = false;
    let timer: number | undefined;

    const claim = async (
      attempt: number,
      generation: number,
    ): Promise<void> => {
      if (
        cancelled ||
        interactionBlocked.current ||
        generation !== claimGeneration.current
      ) {
        return;
      }
      const existingClaim = claimInFlight.current;
      if (existingClaim !== null) {
        await existingClaim;
        if (
          !cancelled &&
          !interactionBlocked.current &&
          generation === claimGeneration.current
        ) {
          void claim(attempt, generation);
        }
        return;
      }
      const operation = (async (): Promise<void> => {
        try {
          const state = await api.post<ReviewPageState>(
            `/api/v1/review-sessions/${encodeURIComponent(page.session.id)}/next`,
            {},
          );
          if (!cancelled && generation === claimGeneration.current) {
            setPage(state);
          }
        } catch {
          if (cancelled || generation !== claimGeneration.current) {
            return;
          }
          setAnnouncement(t("review.error"));
          const retryDelay = CLAIM_RETRY_DELAYS_MS[attempt];
          if (retryDelay !== undefined) {
            timer = window.setTimeout(
              () => void claim(attempt + 1, generation),
              retryDelay,
            );
          }
        }
      })();
      const trackedOperation = operation.finally(() => {
        if (claimInFlight.current === trackedOperation) {
          claimInFlight.current = null;
        }
      });
      claimInFlight.current = trackedOperation;
      await trackedOperation;
    };

    const waitForDue = (): void => {
      if (cancelled) {
        return;
      }
      const deadline = dueDeadline.current;
      if (deadline === null || deadline.key !== deadlineKey) {
        return;
      }
      const remainingMs = Math.max(
        0,
        deadline.atPerformanceMs - window.performance.now(),
      );
      if (remainingMs === 0) {
        if (!interactionBlocked.current) {
          void claim(0, claimGeneration.current);
        }
        return;
      }
      timer = window.setTimeout(
        waitForDue,
        Math.min(remainingMs, MAX_CLIENT_TIMER_DELAY_MS),
      );
    };

    waitForDue();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [api, claimWakeRevision, page, t]);

  const reveal = useCallback(() => {
    if (
      page.kind !== "question" ||
      shownEntryId !== page.card.entryId ||
      busy
    ) {
      return;
    }
    setBusy(true);
    void api
      .post<ReviewPageState>(
        `/api/v1/review-sessions/${encodeURIComponent(page.session.id)}/current/reveal`,
        { entryId: page.card.entryId },
      )
      .then(setPage)
      .catch(() => setAnnouncement(t("review.error")))
      .finally(() => setBusy(false));
  }, [api, busy, page, shownEntryId, t]);

  const rate = useCallback(
    (rating: 1 | 2 | 3 | 4) => {
      if (
        page.kind !== "answer" ||
        page.session.status !== "active" ||
        busy
      ) {
        return;
      }
      setBusy(true);
      void api
        .post<ReviewPageState>(
          `/api/v1/review-sessions/${encodeURIComponent(page.session.id)}/current/rate`,
          {
            entryId: page.card.entryId,
            learningItemId: page.card.learningItemId,
            rating,
            expectedStateRevision: page.card.stateRevision,
            idempotencyKey: crypto.randomUUID(),
          },
        )
        .then(setPage)
        .catch(() => setAnnouncement(t("review.error")))
        .finally(() => setBusy(false));
    },
    [api, busy, page, t],
  );

  const pause = (): void => {
    if (page.kind === "completed" || busy) {
      return;
    }
    setBusy(true);
    void api
      .post<ReviewPageState>(
        `/api/v1/review-sessions/${encodeURIComponent(page.session.id)}/pause`,
        {},
      )
      .then((state) => {
        setPage(state);
        setEndDialogOpen(false);
      })
      .catch(() => setAnnouncement(t("review.error")))
      .finally(() => setBusy(false));
  };

  const resume = (): void => {
    if (page.kind === "completed" || busy) {
      return;
    }
    interactionBlocked.current = false;
    setBusy(true);
    void api
      .post<ReviewPageState>(
        `/api/v1/review-sessions/${encodeURIComponent(page.session.id)}/resume`,
        {},
      )
      .then(setPage)
      .catch(() => setAnnouncement(t("review.error")))
      .finally(() => setBusy(false));
  };

  const finish = (): void => {
    if (page.kind === "completed" || busy) {
      return;
    }
    setBusy(true);
    void api
      .post<ReviewPageState>(
        `/api/v1/review-sessions/${encodeURIComponent(page.session.id)}/finish`,
        {},
      )
      .then((state) => {
        setPage(state);
        setEndDialogOpen(false);
      })
      .catch(() => setAnnouncement(t("review.error")))
      .finally(() => setBusy(false));
  };

  useReviewShortcuts({
    answerVisible: page.kind === "answer",
    endButtonRef,
    onRate: rate,
    onReveal: reveal,
  });

  const openEndDialog = (): void => {
    dialogOpenedContentKey.current = reviewContentKey(page);
    claimGeneration.current += 1;
    interactionBlocked.current = true;
    setEndDialogOpen(true);
  };

  const cancelEndDialog = (): void => {
    interactionBlocked.current = false;
    setEndDialogOpen(false);
    if (
      dueDeadline.current !== null &&
      dueDeadline.current.atPerformanceMs <= window.performance.now()
    ) {
      setClaimWakeRevision((revision) => revision + 1);
    }
  };

  return (
    <div data-openrecall-review-active={activeReview ? "true" : "false"}>
      <div role="status" aria-atomic="true" className="sr-status">
        {announcement}
      </div>

      {page.kind !== "completed" && (
        <SessionProgress session={page.session} />
      )}

      {page.kind === "question" && (
        <section className="review-card">
          <h1>{t("review.question")}</h1>
          <p
            ref={questionRef}
            tabIndex={-1}
            dir="auto"
            className="review-card-content"
            data-review-content="question"
          >
            {page.card.front}
          </p>
          <button
            type="button"
            disabled={busy || shownEntryId !== page.card.entryId}
            onClick={reveal}
          >
            {t("review.showAnswer")}
          </button>
        </section>
      )}

      {page.kind === "answer" && (
        <section className="review-card">
          <h1>{t("review.question")}</h1>
          <p
            dir="auto"
            className="review-card-content"
            data-review-content="question"
          >
            {page.card.front}
          </p>
          <h2>{t("review.answer")}</h2>
          <p
            ref={answerRef}
            tabIndex={-1}
            dir="auto"
            className="review-card-content"
            data-review-content="answer"
          >
            {page.card.back}
          </p>
          {page.card.notes !== null &&
            page.card.notes.trim() !== "" && (
              <>
                <h2>{t("review.notes")}</h2>
                <p
                  dir="auto"
                  className="review-card-content"
                  data-review-content="notes"
                >
                  {page.card.notes}
                </p>
              </>
            )}
          <RatingButtons
            disabled={busy || page.session.status !== "active"}
            onRate={rate}
            outcomes={page.outcomes}
          />
        </section>
      )}

      {page.kind === "waiting" && (
        <WaitingState
          endButtonRef={endButtonRef}
          nextDueAtMs={page.nextDueAtMs}
          paused={page.session.status === "paused"}
          onEnd={openEndDialog}
          onResume={resume}
        />
      )}

      {page.kind === "completed" && (
        <SessionSummary summary={page.summary} />
      )}

      {(page.kind === "question" || page.kind === "answer") &&
        page.session.status === "paused" && (
          <section className="panel">
            <h2 ref={pausedHeadingRef} tabIndex={-1}>
              {t("review.paused")}
            </h2>
            <button type="button" disabled={busy} onClick={resume}>
              {t("review.resume")}
            </button>
          </section>
        )}

      {(page.kind === "question" || page.kind === "answer") &&
        page.session.status !== "paused" && (
        <p>
          <button
            ref={endButtonRef}
            type="button"
            disabled={busy}
            onClick={openEndDialog}
          >
            {t("review.end")}
          </button>
        </p>
      )}

      {endDialogOpen && page.kind !== "completed" && (
        <EndSessionDialog
          busy={busy}
          openerRef={endButtonRef}
          restoreOpener={
            dialogOpenedContentKey.current === reviewContentKey(page)
          }
          onCancel={cancelEndDialog}
          onFinish={finish}
          onPause={pause}
        />
      )}
    </div>
  );
}
