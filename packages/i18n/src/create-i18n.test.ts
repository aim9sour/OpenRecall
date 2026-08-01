import { describe, expect, it } from "vitest";
import { createI18n } from "./create-i18n.js";

describe("createI18n", () => {
  it("loads every registered production catalog for runtime switching", async () => {
    const i18n = await createI18n("en");

    await i18n.changeLanguage("ar");

    expect(i18n.t("nav.home")).toBe("الرئيسية");
  });
});
