import type {
  OptimizerEligibility,
  OptimizerRun,
} from "@openrecall/contracts";
import { createI18n } from "@openrecall/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "../api/client.js";
import { I18nProvider } from "../app/I18nProvider.js";
import { OptimizerPanel } from "./OptimizerPanel.js";

const sectionId = "d9428888-122b-41e1-985c-61cd3cbb3210";

function run(
  status: OptimizerRun["status"],
  progress: number,
): OptimizerRun {
  return {
    id: "a8f65aa8-122b-41e1-985c-61cd3cbb3210",
    scopeType: "section",
    sectionId,
    status,
    rawReviewCount: 500,
    eligibleExampleCount: 400,
    sourceReviewCutoffMs: 5_000,
    packageVersion: "0.5.0",
    algorithmVersion: "6.0",
    progress,
    resultProfileId:
      status === "succeeded"
        ? "b9f65aa8-122b-41e1-985c-61cd3cbb3210"
        : null,
    metricLogLoss: status === "succeeded" ? 0.2 : null,
    metricRmseBins: status === "succeeded" ? 0.1 : null,
    errorCode: null,
    createdAtMs: 1_000,
    startedAtMs: 1_000,
    finishedAtMs: status === "succeeded" ? 2_000 : null,
  };
}

function eligibility(
  eligibleExampleCount: number,
  activeRun: OptimizerRun | null = null,
): OptimizerEligibility {
  return {
    scope: { scopeType: "section", sectionId },
    rawReviewCount: 500,
    eligibleExampleCount,
    minimumEligibleExamples: 400,
    sourceReviewCutoffMs: 5_000,
    canTrain: eligibleExampleCount >= 400,
    parameterSource: {
      kind: "global",
      profileId: "global-profile",
      eligibleExampleCount: 450,
    },
    activeRun,
  };
}

function api(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    bootstrap: async () => ({
      apiVersion: 1,
      csrfToken: "token",
      databaseRevision: 1,
      locale: "en",
      localeUpdatedAtMs: 0,
    }),
    get: async <T,>() => ({}) as T,
    patch: async <T,>() => ({}) as T,
    post: async <T,>() => ({}) as T,
    put: async <T,>() => ({}) as T,
    delete: async <T,>() => ({}) as T,
    ...overrides,
  };
}

async function renderPanel(
  initialEligibility: OptimizerEligibility,
  client = api(),
) {
  const i18n = await createI18n("en");
  return render(
    <I18nProvider i18n={i18n}>
      <OptimizerPanel
        api={client}
        initialEligibility={initialEligibility}
        pollIntervalMs={5}
      />
    </I18nProvider>,
  );
}

describe("OptimizerPanel", () => {
  it("distinguishes raw/eligible data, explains fallback, and disables unsafe training", async () => {
    const { container } = await renderPanel(eligibility(399));

    expect(screen.getByText("Raw review events")).not.toBeNull();
    expect(screen.getByText("500")).not.toBeNull();
    expect(screen.getByText("Eligible training examples")).not.toBeNull();
    expect(screen.getByText("399")).not.toBeNull();
    expect(
      screen.getByText(
        "This section currently uses trained general parameters until it has enough eligible examples.",
      ),
    ).not.toBeNull();
    expect(
      (screen.getByRole("button", {
        name: "Train parameters",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);

    const results = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(
      results.violations.filter(
        ({ impact }) => impact === "serious" || impact === "critical",
      ),
    ).toEqual([]);
  });

  it("polls only while active and announces progress no more often than each 10 percent", async () => {
    const user = userEvent.setup();
    const sequence = [
      run("running", 0.05),
      run("running", 0.09),
      run("running", 0.11),
      run("running", 0.19),
      run("running", 0.2),
      run("succeeded", 1),
    ];
    const getCalls: string[] = [];
    const get: ApiClient["get"] = async <T,>(path: string) => {
      getCalls.push(path);
      return sequence.shift() as T;
    };
    const postCalls: Array<{ path: string; body: unknown }> = [];
    const post: ApiClient["post"] = async <T,>(
      path: string,
      body: unknown,
    ) => {
      postCalls.push({ path, body });
      return run("running", 0) as T;
    };
    await renderPanel(eligibility(400), api({ get, post }));
    const live = screen.getByTestId("optimizer-live");
    const announcements: string[] = [];
    const observer = new MutationObserver(() => {
      const text = live.textContent?.trim() ?? "";
      if (text !== "") announcements.push(text);
    });
    observer.observe(live, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    await user.click(
      screen.getByRole("button", { name: "Train parameters" }),
    );
    await screen.findByText("Candidate parameters are ready for preview.");
    await waitFor(() =>
      expect(live.textContent).toBe(
        "Candidate parameters are ready for preview.",
      ),
    );
    observer.disconnect();

    expect(postCalls).toEqual([
      {
        path: "/api/v1/optimizer/runs",
        body: { scopeType: "section", sectionId },
      },
    ]);
    expect(announcements).toContain("Training progress 10%.");
    expect(announcements).toContain("Training progress 20%.");
    expect(announcements).not.toContain("Training progress 5%.");
    expect(announcements).not.toContain("Training progress 9%.");
    expect(announcements).not.toContain("Training progress 19%.");
    expect(
      announcements.at(-1),
    ).toBe("Candidate parameters are ready for preview.");
    const callsAtCompletion = getCalls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getCalls).toHaveLength(callsAtCompletion);
    expect(document.body.textContent).not.toMatch(
      /parameters (?:were )?applied/i,
    );
  });

  it("offers cancellation as a native keyboard button", async () => {
    const user = userEvent.setup();
    const active = run("running", 0.4);
    const postCalls: Array<{ path: string; body: unknown }> = [];
    const post: ApiClient["post"] = async <T,>(
      path: string,
      body: unknown,
    ) => {
      postCalls.push({ path, body });
      return active as T;
    };
    const get: ApiClient["get"] = async <T,>() => active as T;
    await renderPanel(
      eligibility(400, active),
      api({ get, post }),
    );
    const cancel = screen.getByRole("button", {
      name: "Cancel training",
    });
    cancel.focus();
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(postCalls).toEqual([
        {
          path: `/api/v1/optimizer/runs/${active.id}/cancel`,
          body: {},
        },
      ]),
    );
  });
});
