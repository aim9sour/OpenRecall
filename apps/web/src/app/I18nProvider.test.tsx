import {
  createI18n,
  formatNumber,
  type LocaleTag,
} from "@openrecall/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider, useI18n } from "./I18nProvider.js";

function Consumer() {
  const i18n = useI18n();
  return (
    <p>
      {i18n.t("nav.home")} —{" "}
      {formatNumber(1_234, i18n.language as LocaleTag)}
    </p>
  );
}

describe("I18nProvider", () => {
  it("reacts to language changes without remounting its consumers", async () => {
    const i18n = await createI18n("en");
    render(
      <I18nProvider i18n={i18n}>
        <Consumer />
      </I18nProvider>,
    );
    expect(screen.getByText("Home — 1,234")).not.toBeNull();

    await i18n.changeLanguage("ar");

    await waitFor(() => {
      expect(screen.getByText("الرئيسية — ١٬٢٣٤")).not.toBeNull();
      expect(document.documentElement.lang).toBe("ar");
      expect(document.documentElement.dir).toBe("rtl");
      expect(document.title).toBe("أوبن ريكول");
    });
  });
});
