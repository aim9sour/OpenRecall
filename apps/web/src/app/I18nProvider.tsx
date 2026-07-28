import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import type { createI18n } from "@openrecall/i18n";

export type I18nInstance = Awaited<ReturnType<typeof createI18n>>;

const I18nContext = createContext<I18nInstance | undefined>(undefined);

export function I18nProvider({
  children,
  i18n,
}: {
  readonly children: ReactNode;
  readonly i18n: I18nInstance;
}) {
  useEffect(() => {
    document.documentElement.lang = i18n.language;
    document.documentElement.dir = i18n.dir();
    document.title = i18n.t("app.name");
  }, [i18n]);

  return <I18nContext.Provider value={i18n}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nInstance {
  const i18n = useContext(I18nContext);
  if (i18n === undefined) {
    throw new Error("I18N_PROVIDER_MISSING");
  }
  return i18n;
}
