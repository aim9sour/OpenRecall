import type { ReviewPageState } from "@openrecall/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLoaderData, useLocation } from "react-router";
import type { ApiClient } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";
import { RatingButtons } from "../review/RatingButtons.js";
import { SessionProgress } from "../review/SessionProgress.js";
import { useReviewEvents } from "../review/use-review-events.js";
import { useReviewShortcuts } from "../review/use-review-shortcuts.js";

function sessionIdOf(state: ReviewPageState): string {
  return state.kind === "completed"
    ? state.summary.sessionId
    : state.session.id;
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
  const [announcement, setAnnouncement] = useState(
    initialNoticeKey === null ? "" : t(initialNoticeKey),
  );
  const questionRef = useRef<HTMLHeadingElement>(null);
  const answerRef = useRef<HTMLHeadingElement>(null);
  const endButtonRef = useRef<HTMLButtonElement>(null);
  const previousRevision = useRef(
    loaderState.kind === "completed" ? -1 : loaderState.session.revision,
  );
  const claimInFlight = useRef(false);
  const sessionId = sessionIdOf(page);

  useReviewEvents(sessionId);

  useEffect(() => {
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
    if (page.kind === "question") {
      questionRef.current?.focus();
    } else if (page.kind === "answer") {
      answerRef.current?.focus();
    }
  }, [
    page.kind,
    page.kind === "question" || page.kind === "answer"
      ? page.card.entryId
      : "",
  ]);

  useEffect(() => {
    if (page.kind !== "question" || page.session.status !== "active") {
      return;
    }
    void api
      .post<void>(
        `/api/v1/review-sessions/${encodeURIComponent(page.session.id)}/current/shown`,
        {
          entryId: page.card.entryId,
          presentationId: page.card.presentationId,
        },
      )
      .catch(() => setAnnouncement(t("review.error")));
  }, [api, page, t]);

  useEffect(() => {
    if (
      page.kind !== "waiting" ||
      page.session.status !== "active" ||
      page.session.currentlyRemaining === 0 ||
      claimInFlight.current
    ) {
      return;
    }
    claimInFlight.current = true;
    void api
      .post<ReviewPageState>(
        `/api/v1/review-sessions/${encodeURIComponent(page.session.id)}/next`,
        {},
      )
      .then(setPage)
      .catch(() => setAnnouncement(t("review.error")))
      .finally(() => {
        claimInFlight.current = false;
      });
  }, [api, page, t]);

  const reveal = useCallback(() => {
    if (page.kind !== "question" || busy) {
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
  }, [api, busy, page, t]);

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

  const end = (): void => {
    if (page.kind === "completed" || busy) {
      return;
    }
    setBusy(true);
    void api
      .post<ReviewPageState>(
        `/api/v1/review-sessions/${encodeURIComponent(page.session.id)}/pause`,
        {},
      )
      .then(setPage)
      .catch(() => setAnnouncement(t("review.error")))
      .finally(() => setBusy(false));
  };

  useReviewShortcuts({
    answerVisible: page.kind === "answer",
    endButtonRef,
    onRate: rate,
    onReveal: reveal,
  });

  return (
    <>
      <div role="status" aria-atomic="true" className="sr-status">
        {announcement}
      </div>

      {page.kind !== "completed" && (
        <SessionProgress session={page.session} />
      )}

      {page.kind === "question" && (
        <section className="review-card">
          <h1 ref={questionRef} tabIndex={-1} dir="auto">
            {page.card.front}
          </h1>
          <button type="button" disabled={busy} onClick={reveal}>
            {t("review.showAnswer")}
          </button>
        </section>
      )}

      {page.kind === "answer" && (
        <section className="review-card">
          <h1 tabIndex={-1} dir="auto">
            {page.card.front}
          </h1>
          <h2 ref={answerRef} tabIndex={-1} dir="auto">
            {page.card.back}
          </h2>
          {page.card.notes !== null &&
            page.card.notes.trim() !== "" && (
            <h3 dir="auto">{page.card.notes}</h3>
            )}
          <RatingButtons
            disabled={busy || page.session.status !== "active"}
            onRate={rate}
            outcomes={page.outcomes}
          />
        </section>
      )}

      {page.kind === "waiting" && (
        <>
          <h1 data-route-heading tabIndex={-1}>
            {t("review.waiting")}
          </h1>
          <p>{t("review.waitingDescription")}</p>
        </>
      )}

      {page.kind === "completed" && (
        <>
          <h1 data-route-heading tabIndex={-1}>
            {t("review.completed")}
          </h1>
          <p>{t("review.completedEvents", { count: page.summary.reviewEvents })}</p>
          <Link to="/">{t("nav.home")}</Link>
        </>
      )}

      {page.kind !== "completed" && (
        <p>
          <button
            ref={endButtonRef}
            type="button"
            disabled={busy}
            onClick={end}
          >
            {t("review.end")}
          </button>
        </p>
      )}
    </>
  );
}
