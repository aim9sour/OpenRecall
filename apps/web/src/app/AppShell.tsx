import { Link, Outlet } from "react-router";
import { useI18n } from "./I18nProvider.js";
import { RouteFocus } from "./RouteFocus.js";

export function AppShell() {
  const { t } = useI18n();

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
              <Link to="/">{t("nav.home")}</Link>
            </li>
            <li>
              <Link to="/statistics">{t("nav.statistics")}</Link>
            </li>
            <li>
              <span aria-disabled="true">{t("nav.settings")}</span>
            </li>
          </ul>
        </nav>
      </header>
      <main id="main-content" className="page-shell">
        <RouteFocus />
        <Outlet />
      </main>
    </>
  );
}
