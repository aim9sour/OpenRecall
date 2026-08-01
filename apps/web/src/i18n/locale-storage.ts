import {
  isDevelopmentLocale,
  isProductionLocale,
  type LocaleTag,
  type ProductionLocaleTag,
} from "@openrecall/i18n";

export const LOCALE_STORAGE_KEY = "openrecall.locale";

export function readRememberedLocale(): LocaleTag {
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (value !== null && isProductionLocale(value)) return value;
    if (
      value !== null &&
      import.meta.env.DEV &&
      isDevelopmentLocale(value)
    ) {
      return value;
    }
  } catch {
    // Storage is optional and may be blocked by browser policy.
  }
  return "ar";
}

export function rememberLocale(locale: LocaleTag): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage is a convenience and must not block a language change.
  }
}

export function subscribeToRememberedLocale(
  listener: (locale: ProductionLocaleTag) => void,
): () => void {
  const handleStorage = (event: StorageEvent): void => {
    try {
      if (
        event.storageArea === localStorage &&
        event.key === LOCALE_STORAGE_KEY &&
        event.newValue !== null &&
        isProductionLocale(event.newValue)
      ) {
        listener(event.newValue);
      }
    } catch {
      // A blocked Storage object cannot produce a usable preference.
    }
  };
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}
