import type { OutcomePreview } from "@openrecall/contracts";
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
  const { t } = useI18n();

  return (
    <div
      className="rating-buttons"
      role="group"
      aria-label={t("review.ratingGroup")}
    >
      {outcomes.map((outcome) => {
        const minutes = Math.max(
          1,
          Math.ceil(outcome.intervalMs / 60_000),
        );
        return (
          <button
            key={outcome.rating}
            type="button"
            disabled={disabled}
            onClick={() => onRate(outcome.rating)}
          >
            {t(ratingKeys[outcome.rating])} —{" "}
            {t("review.minutes", { count: minutes })}
          </button>
        );
      })}
    </div>
  );
}
