import { useEffect, useState, type MouseEvent } from "react";
import { Link, Outlet } from "react-router";
import { useI18n } from "./I18nProvider.js";
import {
  MAINTENANCE_NAVIGATION_END,
  MAINTENANCE_NAVIGATION_START,
} from "./maintenance-events.js";
import { RouteFocus } from "./RouteFocus.js";
import { useTheme } from "./ThemeProvider.js";

export function AppShell() {
  const { t } = useI18n();
  const theme = useTheme();
  const [navigationBlocked, setNavigationBlocked] = useState(false);

  useEffect(() => {
    const start = () => setNavigationBlocked(true);
    const end = () => setNavigationBlocked(false);
    window.addEventListener(MAINTENANCE_NAVIGATION_START, start);
    window.addEventListener(MAINTENANCE_NAVIGATION_END, end);
    return () => {
      window.removeEventListener(
        MAINTENANCE_NAVIGATION_START,
        start,
      );
      window.removeEventListener(MAINTENANCE_NAVIGATION_END, end);
    };
  }, []);

  const guardNavigation = (event: MouseEvent<HTMLAnchorElement>) => {
    if (navigationBlocked) event.preventDefault();
  };
  const guardedLinkProperties = {
    "aria-disabled": navigationBlocked || undefined,
    onClick: guardNavigation,
    tabIndex: navigationBlocked ? -1 : undefined,
  } as const;

  return (
    <>
      <a className="skip-link" href="#main-content">
        {t("skip.main")}
      </a>
      <header className="app-header">
        <div className="brand">{t("app.name")}</div>
        <nav aria-label={t("nav.primary")}>
          <ul className="nav-list">
            <li>
              <Link {...guardedLinkProperties} to="/">
                {t("nav.home")}
              </Link>
            </li>
            <li>
              <Link {...guardedLinkProperties} to="/statistics">
                {t("nav.statistics")}
              </Link>
            </li>
            <li>
              <Link {...guardedLinkProperties} to="/settings">
                {t("nav.settings")}
              </Link>
            </li>
          </ul>
        </nav>
        <div className="theme-control">
          <label htmlFor="theme-preference">{t("theme.label")}</label>
          <select
            id="theme-preference"
            value={theme.preference}
            disabled={theme.busy}
            onChange={(event) =>
              void theme.setPreference(
                event.currentTarget.value as
                  | "system"
                  | "light"
                  | "dark",
              )
            }
          >
            <option value="system">{t("theme.system")}</option>
            <option value="light">{t("theme.light")}</option>
            <option value="dark">{t("theme.dark")}</option>
          </select>
          {theme.error !== null && (
            <p role="alert">{t("theme.saveError")}</p>
          )}
        </div>
      </header>
      <main id="main-content" className="page-shell">
        <RouteFocus />
        <Outlet />
      </main>
    </>
  );
}
