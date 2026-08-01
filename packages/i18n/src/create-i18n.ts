import { createInstance, type i18n } from "i18next";
import {
  getLocaleDefinition,
  registeredLocaleTags,
} from "./locale-registry.js";
import type { LocaleTag } from "./types.js";

export async function createI18n(locale: LocaleTag): Promise<i18n> {
  const instance = createInstance();
  const resources = Object.fromEntries(
    registeredLocaleTags().map((tag) => [
      tag,
      { translation: getLocaleDefinition(tag).resources },
    ]),
  );

  await instance.init({
    lng: locale,
    fallbackLng: false,
    keySeparator: false,
    returnNull: false,
    interpolation: {
      escapeValue: false,
    },
    resources,
  });

  return instance;
}
