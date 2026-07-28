import { useEffect, useRef, type RefObject } from "react";
import { Link } from "react-router";
import { useI18n } from "../app/I18nProvider.js";

export function WaitingState({
  endButtonRef,
  nextDueAtMs,
  onEnd,
  onResume,
  paused,
}: {
  readonly endButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly nextDueAtMs: number | null;
  readonly onEnd: () => void;
  readonly onResume: () => void;
  readonly paused: boolean;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const i18n = useI18n();

  useEffect(() => {
    headingRef.current?.focus();
  }, [paused]);

  return (
    <section>
      <h1 ref={headingRef} tabIndex={-1}>
        {paused ? i18n.t("review.paused") : i18n.t("review.waiting")}
      </h1>
      {nextDueAtMs === null ? (
        <p>{i18n.t("review.noFutureDue")}</p>
      ) : (
        <p>
          {i18n.t("review.nextDue")}{" "}
          <time dateTime={new Date(nextDueAtMs).toISOString()}>
            {new Intl.DateTimeFormat(i18n.language, {
              dateStyle: "full",
              timeStyle: "long",
            }).format(new Date(nextDueAtMs))}
          </time>
        </p>
      )}
      <div className="review-actions">
        {paused ? (
          <button type="button" onClick={onResume}>
            {i18n.t("review.resume")}
          </button>
        ) : (
          <button ref={endButtonRef} type="button" onClick={onEnd}>
            {i18n.t("review.end")}
          </button>
        )}
        <Link to="/">{i18n.t("nav.home")}</Link>
      </div>
    </section>
  );
}
