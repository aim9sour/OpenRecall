import {
  createI18n,
  pseudoEnglishLocale,
  registerLocale,
} from "@openrecall/i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { createApiClient } from "./api/client.js";
import { createRoutes } from "./router.js";
import "./styles/base.css";

async function start(): Promise<void> {
  const rootElement = document.getElementById("root");
  if (rootElement === null) {
    throw new Error("ROOT_ELEMENT_MISSING");
  }

  const api = createApiClient();
  const bootstrap = await api.bootstrap();
  if (bootstrap.locale === "en-XA") {
    if (!import.meta.env.DEV) {
      throw new Error("PSEUDO_LOCALE_PRODUCTION_DISABLED");
    }
    registerLocale(pseudoEnglishLocale);
  }
  const i18n = await createI18n(bootstrap.locale);
  const router = createBrowserRouter(createRoutes({ api, i18n }));

  createRoot(rootElement).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

void start().catch(() => {
  const rootElement = document.getElementById("root");
  if (rootElement !== null) {
    rootElement.textContent = "OpenRecall could not start.";
  }
});
