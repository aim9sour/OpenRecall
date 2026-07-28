import type { ReviewPageState } from "@openrecall/contracts";
import { useState } from "react";
import { useNavigate } from "react-router";
import { ApiClientError, type ApiClient } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";

function sessionIdOf(state: ReviewPageState): string {
  return state.kind === "completed"
    ? state.summary.sessionId
    : state.session.id;
}

function conflictDetails(error: ApiClientError): {
  readonly messageKey: string;
  readonly sessionId: string;
} | null {
  const envelope: unknown = error.envelope;
  if (
    error.status !== 409 ||
    typeof envelope !== "object" ||
    envelope === null ||
    !("code" in envelope) ||
    envelope.code !== "OPEN_REVIEW_SESSION_EXISTS" ||
    !("sessionId" in envelope) ||
    typeof envelope.sessionId !== "string"
  ) {
    return null;
  }
  return {
    sessionId: envelope.sessionId,
    messageKey:
      "messageKey" in envelope && typeof envelope.messageKey === "string"
        ? envelope.messageKey
        : "review.openSessionExists",
  };
}

export function StartReviewButton({
  api,
  sectionId,
}: {
  readonly api: ApiClient;
  readonly sectionId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const navigate = useNavigate();
  const { t } = useI18n();

  const start = (): void => {
    if (busy) {
      return;
    }
    setBusy(true);
    setErrorMessage("");
    void api
      .post<ReviewPageState>("/api/v1/review-sessions", { sectionId })
      .then((state) => navigate(`/review/${sessionIdOf(state)}`))
      .catch((error: unknown) => {
        if (error instanceof ApiClientError) {
          const conflict = conflictDetails(error);
          if (conflict !== null) {
            void navigate(`/review/${conflict.sessionId}`, {
              state: { reviewNoticeKey: conflict.messageKey },
            });
            return;
          }
        }
        setErrorMessage(t("review.startError"));
      })
      .finally(() => setBusy(false));
  };

  return (
    <>
      <button type="button" disabled={busy} onClick={start}>
        {busy ? t("review.starting") : t("section.startReview")}
      </button>
      {errorMessage !== "" && <p role="alert">{errorMessage}</p>}
    </>
  );
}
