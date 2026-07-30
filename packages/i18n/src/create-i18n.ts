import { createInstance, type i18n } from "i18next";
import { getLocaleDefinition } from "./locale-registry.js";
import type { LocaleTag } from "./types.js";

export async function createI18n(locale: LocaleTag): Promise<i18n> {
  const instance = createInstance();
  const definition = getLocaleDefinition(locale);

  await instance.init({
    lng: locale,
    fallbackLng: false,
    keySeparator: false,
    returnNull: false,
    interpolation: {
      escapeValue: false,
    },
    resources: {
      [locale]: {
        translation: definition.resources,
      },
    },
  });

  return instance;
}
