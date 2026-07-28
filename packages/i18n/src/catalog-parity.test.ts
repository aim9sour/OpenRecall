import { describe, expect, it } from "vitest";
import {
  COMMON_MESSAGE_KEYS,
  createI18n,
  localeDefinitions,
  requiredPluralSuffixes,
  SUPPORTED_LOCALES,
} from "./index.js";

describe("locale catalog", () => {
  it("covers every common message in Arabic and English", () => {
    for (const locale of Object.values(localeDefinitions)) {
      for (const key of COMMON_MESSAGE_KEYS) {
        expect(locale.resources[key]?.trim()).not.toBe("");
      }
    }
  });

  it("covers every plural category required by each locale", () => {
    for (const tag of SUPPORTED_LOCALES) {
      const suffixes = requiredPluralSuffixes[tag];
      const resources: Readonly<Record<string, string>> =
        localeDefinitions[tag].resources;

      for (const suffix of suffixes) {
        expect(resources[`section.cardsCount_${suffix}`]?.trim()).not.toBe("");
      }
    }
  });

  it("creates isolated instances with correct direction and plural behavior", async () => {
    const english = await createI18n("en");
    const arabic = await createI18n("ar");

    expect(english.dir()).toBe("ltr");
    expect(arabic.dir()).toBe("rtl");
    expect(english.t("section.cardsCount", { count: 1 })).toBe("1 card");
    expect(english.t("section.cardsCount", { count: 2 })).toBe("2 cards");
    expect(arabic.t("section.cardsCount", { count: 0 })).toBe("لا توجد بطاقات");
    expect(arabic.t("section.cardsCount", { count: 2 })).toBe("بطاقتان");
  });
});
