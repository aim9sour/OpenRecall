import { describe, expect, it } from "vitest";
import {
  createI18n,
  englishLocale,
  localeDefinitions,
  pseudoEnglishLocale,
  registerLocale,
} from "./index.js";

describe("development pseudo-locale", () => {
  it("expands text, preserves interpolation tokens, and is opt-in", async () => {
    expect(Object.keys(localeDefinitions)).toEqual(["ar", "en"]);
    expect(
      pseudoEnglishLocale.resources["optimizer.progress"],
    ).toContain("{{percent}}");
    expect(
      pseudoEnglishLocale.resources["optimizer.progress"]!.length,
    ).toBeGreaterThan(
      englishLocale.resources["optimizer.progress"]!.length,
    );
    expect(pseudoEnglishLocale.resources["app.name"]).toMatch(
      /^［.+］$/,
    );

    registerLocale(pseudoEnglishLocale);
    const pseudo = await createI18n("en-XA");
    expect(pseudo.t("optimizer.progress", { percent: 25 })).toMatch(
      /^［.+25.+］$/,
    );
    expect(() => registerLocale(pseudoEnglishLocale)).toThrow(
      "LOCALE_ALREADY_REGISTERED",
    );
  });
});
