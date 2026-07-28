import type { Section, SectionSummary } from "@openrecall/contracts";
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
import { SectionPage } from "./pages/SectionPage.js";

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
          element: <HomePage />,
        },
        {
          id: "section",
          path: "sections/:sectionId",
          loader: async ({ params }) =>
            api.get<SectionSummary>(
              `/api/v1/sections/${encodeURIComponent(params["sectionId"] ?? "")}`,
            ),
          element: <SectionPage />,
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
