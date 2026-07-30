import {
  createI18n,
  isDevelopmentLocale,
  isProductionLocale,
  pseudoEnglishLocale,
  registerLocale,
  type LocaleTag,
} from "@openrecall/i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { createApiClient } from "./api/client.js";
import { I18nProvider } from "./app/I18nProvider.js";
import { ServerUnavailable } from "./app/ServerUnavailable.js";
import { registerOpenRecallServiceWorker } from "./pwa/register-openrecall-service-worker.js";
import {
  inactiveServiceWorkerUpdateController,
} from "./pwa/register-service-worker.js";
import { createRoutes } from "./router.js";
import "./styles/base.css";

const localeStorageKey = "openrecall.locale";

function rememberedLocale(): LocaleTag {
  try {
    const value = localStorage.getItem(localeStorageKey);
    if (value !== null && isProductionLocale(value)) return value;
    if (
      value !== null &&
      import.meta.env.DEV &&
      isDevelopmentLocale(value)
    ) {
      return value;
    }
  } catch {
    // A blocked storage API must not prevent the local startup help.
  }
  return "ar";
}

function prepareLocale(locale: LocaleTag): void {
  if (locale === "en-XA") {
    if (!import.meta.env.DEV) {
      throw new Error("PSEUDO_LOCALE_PRODUCTION_DISABLED");
    }
    registerLocale(pseudoEnglishLocale);
  }
}

async function start(): Promise<void> {
  const rootElement = document.getElementById("root");
  if (rootElement === null) {
    throw new Error("ROOT_ELEMENT_MISSING");
  }

  const root = createRoot(rootElement);
  const api = createApiClient();
  let updates = inactiveServiceWorkerUpdateController;
  try {
    updates = registerOpenRecallServiceWorker();
  } catch {
    // A service-worker registration failure must not prevent local study.
  }

  let bootstrap: Awaited<ReturnType<typeof api.bootstrap>>;
  try {
    bootstrap = await api.bootstrap();
  } catch {
    const locale = rememberedLocale();
    prepareLocale(locale);
    const i18n = await createI18n(locale);
    root.render(
      <StrictMode>
        <I18nProvider i18n={i18n}>
          <ServerUnavailable />
        </I18nProvider>
      </StrictMode>,
    );
    return;
  }

  prepareLocale(bootstrap.locale);
  try {
    localStorage.setItem(localeStorageKey, bootstrap.locale);
  } catch {
    // Locale persistence is a convenience, not a startup dependency.
  }
  const i18n = await createI18n(bootstrap.locale);
  const router = createBrowserRouter(createRoutes({ api, i18n, updates }));

  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

void start().catch((error: unknown) => {
  const rootElement = document.getElementById("root");
  if (rootElement !== null) {
    rootElement.textContent = "OpenRecall could not start.";
  }
  console.error(error);
});
