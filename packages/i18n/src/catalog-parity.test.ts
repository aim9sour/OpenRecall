import { describe, expect, it } from "vitest";
import {
  COMMON_MESSAGE_KEYS,
  PLURAL_MESSAGE_KEYS,
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

      for (const key of PLURAL_MESSAGE_KEYS) {
        for (const suffix of suffixes) {
          expect(resources[`${key}_${suffix}`]?.trim()).not.toBe("");
        }
      }
    }
  });

  it("creates isolated instances with correct direction and plural behavior", async () => {
    const english = await createI18n("en");
    const arabic = await createI18n("ar");

    expect(english.dir()).toBe("ltr");
    expect(arabic.dir()).toBe("rtl");
    expect(english.t("review.joined", { count: 1 })).toBe(
      "1 card joined this session.",
    );
    expect(english.t("review.joined", { count: 2 })).toBe(
      "2 cards joined this session.",
    );
    expect(arabic.t("review.joined", { count: 0 })).toBe(
      "لم تنضم بطاقات جديدة.",
    );
    expect(arabic.t("review.joined", { count: 2 })).toBe(
      "انضمت بطاقتان إلى هذه الجلسة.",
    );
  });
});
