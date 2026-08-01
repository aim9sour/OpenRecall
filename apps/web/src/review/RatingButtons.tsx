import type { OutcomePreview } from "@openrecall/contracts";
import {
  formatReviewInterval,
  type LocaleTag,
} from "@openrecall/i18n";
import { useI18n } from "../app/I18nProvider.js";

const ratingKeys = {
  1: "review.rating.again",
  2: "review.rating.hard",
  3: "review.rating.good",
  4: "review.rating.easy",
} as const;

export function RatingButtons({
  disabled,
  onRate,
  outcomes,
}: {
  readonly disabled: boolean;
  readonly onRate: (rating: 1 | 2 | 3 | 4) => void;
  readonly outcomes: readonly OutcomePreview[];
}) {
  const i18n = useI18n();
  const { t } = i18n;

  return (
    <div
      className="rating-buttons"
      role="group"
      aria-label={t("review.ratingGroup")}
    >
      {outcomes.map((outcome) => {
        const interval = formatReviewInterval(
          outcome.intervalMs,
          i18n.language as LocaleTag,
        );
        return (
          <button
            key={outcome.rating}
            type="button"
            disabled={disabled}
            onClick={() => onRate(outcome.rating)}
          >
            {t(ratingKeys[outcome.rating])} — {interval}
          </button>
        );
      })}
    </div>
  );
}
