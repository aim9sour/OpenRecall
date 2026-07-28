import type { SessionProgress as SessionProgressValue } from "@openrecall/contracts";
import { useI18n } from "../app/I18nProvider.js";

export function SessionProgress({
  session,
}: {
  readonly session: SessionProgressValue;
}) {
  const { t } = useI18n();
  const total =
    session.completedAppearances + session.currentlyRemaining;
  const summary = t("review.progress", {
    completed: session.completedAppearances,
    remaining: session.currentlyRemaining,
    newCount: session.newRemaining,
    repeated: session.repeatedWithinSession,
  });

  return (
    <section className="review-progress" aria-label={t("review.progressLabel")}>
      <p id="review-progress-summary">{summary}</p>
      <progress
        aria-describedby="review-progress-summary"
        max={Math.max(1, total)}
        value={session.completedAppearances}
      />
    </section>
  );
}
