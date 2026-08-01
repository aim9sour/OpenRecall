import type { OutcomePreview } from "@openrecall/contracts";
import { createI18n, type LocaleTag } from "@openrecall/i18n";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../app/I18nProvider.js";
import { RatingButtons } from "./RatingButtons.js";

const outcomes: readonly OutcomePreview[] = [
  { rating: 1, dueAtMs: 1, intervalMs: 30 * 60_000 },
  { rating: 2, dueAtMs: 2, intervalMs: 2 * 3_600_000 },
  { rating: 3, dueAtMs: 3, intervalMs: 3 * 86_400_000 },
  { rating: 4, dueAtMs: 4, intervalMs: 60 * 86_400_000 },
];

async function renderRatings(locale: LocaleTag) {
  const i18n = await createI18n(locale);
  return render(
    <I18nProvider i18n={i18n}>
      <RatingButtons
        disabled={false}
        onRate={vi.fn()}
        outcomes={outcomes}
      />
    </I18nProvider>,
  );
}

describe("RatingButtons interval labels", () => {
  it("uses human-scale English units", async () => {
    await renderRatings("en");

    for (const name of [
      "Again — 30 minutes",
      "Hard — 2 hours",
      "Good — 3 days",
      "Easy — 2 months",
    ]) {
      expect(screen.getByRole("button", { name })).not.toBeNull();
    }
  });

  it("uses locale-aware Arabic units", async () => {
    await renderRatings("ar");

    for (const name of [
      "مرة أخرى — ٣٠ دقيقة",
      "صعب — ساعتان",
      "جيد — ٣ أيام",
      "سهل — شهران",
    ]) {
      expect(screen.getByRole("button", { name })).not.toBeNull();
    }
  });
});
