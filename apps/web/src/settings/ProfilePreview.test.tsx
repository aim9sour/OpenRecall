import type {
  OptimizerProfileApplication,
  OptimizerProfilePreview,
} from "@openrecall/contracts";
import { createI18n } from "@openrecall/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "../api/client.js";
import { I18nProvider } from "../app/I18nProvider.js";
import { ProfilePreview } from "./ProfilePreview.js";

const profileId = "c8f65aa8-122b-41e1-985c-61cd3cbb3210";
const workload = Array.from({ length: 30 }, (_, dayOffset) => ({
  dayOffset,
  count: dayOffset === 2 ? 3 : 0,
}));
const preview: OptimizerProfilePreview = {
  profile: {
    id: profileId,
    scopeType: "global",
    sectionId: null,
    algorithmId: "FSRS-6",
    algorithmVersion: "6.0",
    adapterVersion: 1,
    eligibleExampleCount: 450,
    reviewCutoffMs: 5_000,
    status: "candidate",
    createdAtMs: 6_000,
    packageVersion: "0.5.0",
    metricLogLoss: 0.2,
    metricRmseBins: 0.1,
  },
  previousProfile: {
    id: "official-fsrs6-v1",
    scopeType: "official",
    sectionId: null,
    algorithmId: "FSRS-6",
    algorithmVersion: "6.0",
    adapterVersion: 1,
    eligibleExampleCount: 0,
    reviewCutoffMs: null,
    status: "active",
    createdAtMs: 0,
    packageVersion: null,
    metricLogLoss: null,
    metricRmseBins: null,
  },
  affectedItemCount: 20,
  reviewCount: 900,
  sourceMatches: true,
  revisionToken: "a".repeat(64),
  dueShift: { earlier: 6, later: 8, unchanged: 6 },
  oldWorkload: workload,
  newWorkload: workload.map((point) => ({
    ...point,
    count: point.dayOffset === 3 ? 4 : 0,
  })),
};
const application: OptimizerProfileApplication = {
  id: "d8f65aa8-122b-41e1-985c-61cd3cbb3210",
  profileId,
  previousProfileId: "official-fsrs6-v1",
  scopeType: "global",
  sectionId: null,
  sourceReviewCutoffMs: 5_000,
  backupFilename: "openrecall-automatic-7000-a.sqlite3",
  appliedAtMs: 7_000,
  affectedItemCount: 20,
};

function api(previewResponse: OptimizerProfilePreview = preview) {
  const calls: Array<{ path: string; body: unknown }> = [];
  const post: ApiClient["post"] = async <T,>(
    path: string,
    body: unknown,
  ) => {
    calls.push({ path, body });
    return (
      path.endsWith("/preview") ? previewResponse : application
    ) as T;
  };
  const client: ApiClient = {
    bootstrap: async () => ({
      apiVersion: 1,
      csrfToken: "token",
      databaseRevision: 1,
      locale: "en",
      localeUpdatedAtMs: 0,
    }),
    get: async <T,>() => [] as T,
    patch: async <T,>() => ({}) as T,
    post,
    put: async <T,>() => ({}) as T,
    delete: async <T,>() => ({}) as T,
  };
  return { calls, client };
}

async function renderPreview(client: ApiClient) {
  const i18n = await createI18n("en");
  return render(
    <I18nProvider i18n={i18n}>
      <ProfilePreview api={client} profileId={profileId} />
    </I18nProvider>,
  );
}

describe("ProfilePreview", () => {
  it("shows complete metadata, shift counts, and two captioned 30-day tables", async () => {
    const user = userEvent.setup();
    const { client } = api();
    const { container } = await renderPreview(client);
    await user.click(
      screen.getByRole("button", { name: "Preview schedule changes" }),
    );

    expect(await screen.findByText("Schedule change preview")).not.toBeNull();
    expect(screen.getByText("20")).not.toBeNull();
    expect(screen.getByText("900")).not.toBeNull();
    expect(screen.getByText("0.5.0")).not.toBeNull();
    expect(screen.getAllByText("6.0")).toHaveLength(2);
    expect(screen.getAllByText("6", { selector: "dd" })).toHaveLength(2);
    expect(screen.getByText("8", { selector: "dd" })).not.toBeNull();
    expect(
      screen.getByRole("table", {
        name: "Current 30-day workload",
      }).querySelectorAll("tbody tr"),
    ).toHaveLength(30);
    expect(
      screen.getByRole("table", {
        name: "Candidate 30-day workload",
      }).querySelectorAll("tbody tr"),
    ).toHaveLength(30);

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      results.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);
  });

  it("never applies automatically and requires explicit snapshot confirmation", async () => {
    const user = userEvent.setup();
    const { calls, client } = api();
    await renderPreview(client);
    await user.click(
      screen.getByRole("button", { name: "Preview schedule changes" }),
    );
    await screen.findByText("Schedule change preview");
    const apply = screen.getByRole("button", {
      name: "Apply candidate parameters",
    }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(calls).toEqual([
      {
        path: `/api/v1/optimizer/profiles/${profileId}/preview`,
        body: {},
      },
    ]);

    await user.click(
      screen.getByRole("checkbox", {
        name: /I understand that schedules will change/i,
      }),
    );
    await user.click(apply);
    await waitFor(() =>
      expect(calls.at(-1)).toEqual({
        path: `/api/v1/optimizer/profiles/${profileId}/apply`,
        body: { revisionToken: preview.revisionToken },
      }),
    );
    expect(
      screen.getByRole("status").textContent,
    ).toContain("Parameters applied");
  });

  it("blocks a stale-source preview and supports rollback through the same confirmation UI", async () => {
    const user = userEvent.setup();
    const stale = {
      ...preview,
      profile: { ...preview.profile, status: "superseded" as const },
      sourceMatches: false,
    };
    const { client, calls } = api(stale);
    const i18n = await createI18n("en");
    render(
      <I18nProvider i18n={i18n}>
        <ProfilePreview
          action="rollback"
          api={client}
          profileId={profileId}
        />
      </I18nProvider>,
    );
    await user.click(
      screen.getByRole("button", {
        name: "Preview rollback schedule",
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Review history changed",
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Restore these parameters",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(calls).toEqual([
      {
        path: `/api/v1/optimizer/profiles/${profileId}/preview`,
        body: {},
      },
    ]);
  });
});
