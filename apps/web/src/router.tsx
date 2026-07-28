import type {
  OptimizerEligibility,
  ReviewPageState,
  Section,
  SectionSummary,
  SettingsView,
  StudyStatistics,
} from "@openrecall/contracts";
import type { RouteObject } from "react-router";
import { ApiClientError, type ApiClient } from "./api/client.js";
import { AppShell } from "./app/AppShell.js";
import {
  I18nProvider,
  type I18nInstance,
} from "./app/I18nProvider.js";
import {
  HomePage,
  type CreateSectionActionData,
} from "./pages/HomePage.js";
import { ImportPage } from "./pages/ImportPage.js";
import { ReviewPage } from "./pages/ReviewPage.js";
import {
  SectionPage,
  type SectionPageData,
} from "./pages/SectionPage.js";
import {
  StatisticsPage,
  type StatisticsPageData,
} from "./pages/StatisticsPage.js";
import {
  SettingsPage,
  type SettingsPageData,
} from "./pages/SettingsPage.js";

function statisticsPath(
  basePath: string,
  searchParams: URLSearchParams,
): string {
  const query = new URLSearchParams();
  for (const key of ["fromStudyDay", "toStudyDay"] as const) {
    const value = searchParams.get(key);
    if (value !== null && value !== "") query.set(key, value);
  }
  const text = query.toString();
  return text === "" ? basePath : `${basePath}?${text}`;
}

export function createRoutes({
  api,
  i18n,
}: {
  readonly api: ApiClient;
  readonly i18n: I18nInstance;
}): RouteObject[] {
  return [
    {
      element: (
        <I18nProvider i18n={i18n}>
          <AppShell />
        </I18nProvider>
      ),
      children: [
        {
          id: "review",
          path: "review/:sessionId",
          loader: async ({ params }) =>
            api.get<ReviewPageState>(
              `/api/v1/review-sessions/${encodeURIComponent(params["sessionId"] ?? "")}`,
            ),
          element: <ReviewPage api={api} />,
        },
        {
          id: "home",
          index: true,
          loader: async () =>
            api.get<SectionSummary[]>("/api/v1/sections"),
          action: async ({ request }): Promise<CreateSectionActionData> => {
            const formData = await request.formData();
            const name = formData.get("name");

            try {
              await api.post<Section>("/api/v1/sections", {
                name: typeof name === "string" ? name : "",
              });
              return {};
            } catch (error) {
              if (error instanceof ApiClientError) {
                return {
                  errorMessageKeys:
                    error.envelope.fieldErrors?.map(
                      (fieldError) => fieldError.messageKey,
                    ) ?? [error.envelope.messageKey],
                };
              }
              return { errorMessageKeys: ["error.internal"] };
            }
          },
          element: <HomePage api={api} />,
        },
        {
          id: "section",
          path: "sections/:sectionId",
          loader: async ({ params }): Promise<SectionPageData> => {
            const sectionId = encodeURIComponent(params["sectionId"] ?? "");
            const [section, statistics] = await Promise.all([
              api.get<SectionSummary>(`/api/v1/sections/${sectionId}`),
              api.get<StudyStatistics>(
                `/api/v1/sections/${sectionId}/statistics`,
              ),
            ]);
            return { section, statistics };
          },
          element: <SectionPage api={api} />,
        },
        {
          id: "statistics",
          path: "statistics",
          loader: async ({ request }): Promise<StatisticsPageData> => {
            const searchParams = new URL(request.url).searchParams;
            const sectionId = searchParams.get("sectionId");
            const basePath =
              sectionId === null || sectionId === ""
                ? "/api/v1/statistics"
                : `/api/v1/sections/${encodeURIComponent(sectionId)}/statistics`;
            const [sections, statistics] = await Promise.all([
              api.get<SectionSummary[]>("/api/v1/sections"),
              api.get<StudyStatistics>(
                statisticsPath(basePath, searchParams),
              ),
            ]);
            return { sections, statistics };
          },
          element: <StatisticsPage />,
        },
        {
          id: "settings",
          path: "settings",
          loader: async ({ request }): Promise<SettingsPageData> => {
            const sectionId = new URL(request.url).searchParams.get(
              "sectionId",
            );
            const settingsPath =
              sectionId === null || sectionId === ""
                ? "/api/v1/settings"
                : `/api/v1/settings?sectionId=${encodeURIComponent(sectionId)}`;
            const eligibilityPath =
              sectionId === null || sectionId === ""
                ? "/api/v1/optimizer/eligibility?scopeType=global"
                : `/api/v1/optimizer/eligibility?scopeType=section&sectionId=${encodeURIComponent(
                    sectionId,
                  )}`;
            const [sections, view, optimizerEligibility] = await Promise.all([
              api.get<SectionSummary[]>("/api/v1/sections"),
              api.get<SettingsView>(settingsPath),
              api.get<OptimizerEligibility>(eligibilityPath),
            ]);
            return { sections, view, optimizerEligibility };
          },
          element: <SettingsPage api={api} />,
        },
        {
          id: "import",
          path: "sections/:sectionId/import",
          element: <ImportPage api={api} />,
        },
      ],
    },
  ];
}
