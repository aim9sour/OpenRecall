import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { createI18n } from "@openrecall/i18n";
import { subscribeToRememberedLocale } from "../i18n/locale-storage.js";

export type I18nInstance = Awaited<ReturnType<typeof createI18n>>;

interface I18nContextValue {
  readonly i18n: I18nInstance;
  readonly language: string;
}

const I18nContext = createContext<I18nContextValue | undefined>(
  undefined,
);

export function I18nProvider({
  children,
  i18n,
}: {
  readonly children: ReactNode;
  readonly i18n: I18nInstance;
}) {
  const [language, setLanguage] = useState(i18n.language);

  useEffect(() => {
    const changed = (next: string): void => setLanguage(next);
    i18n.on("languageChanged", changed);
    return () => i18n.off("languageChanged", changed);
  }, [i18n]);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.documentElement.dir = i18n.dir();
    document.title = i18n.t("app.name");
  }, [i18n, language]);

  useEffect(
    () =>
      subscribeToRememberedLocale((locale) => {
        void i18n.changeLanguage(locale);
      }),
    [i18n],
  );

  return (
    <I18nContext.Provider value={{ i18n, language }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nInstance {
  const context = useContext(I18nContext);
  if (context === undefined) {
    throw new Error("I18N_PROVIDER_MISSING");
  }
  return context.i18n;
}
