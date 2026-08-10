import type {
  OptimizerScope,
  SchedulerSettings,
  StepRecommendationRun,
} from "@openrecall/contracts";
import { createI18n } from "@openrecall/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import {
  ApiClientError,
  type ApiClient,
} from "../api/client.js";
import { I18nProvider } from "../app/I18nProvider.js";
import { StepRecommendationPanel } from "./StepRecommendationPanel.js";

const scope: OptimizerScope = {
  scopeType: "global",
  sectionId: null,
};
const settings: SchedulerSettings = {
  requestedRetention: 0.9,
  maximumIntervalDays: 36_500,
  enableFuzz: false,
  enableShortTerm: true,
  learningStepsMinutes: [1, 10],
  relearningStepsMinutes: [10],
};
const fingerprint = "a".repeat(64);
const exclusions = {
  invalidCardId: 0,
  invalidTimestamp: 0,
  invalidRating: 0,
  invalidState: 0,
  missingDuration: 0,
  nonIncreasingOrder: 0,
};

function run(status: StepRecommendationRun["status"]): StepRecommendationRun {
  const succeeded = status === "succeeded";
  return {
    id: "a8f65aa8-122b-41e1-985c-61cd3cbb3210",
    scope,
    status,
    sourceReviewCutoffMs: 5_000,
    sourceFingerprint: fingerprint,
    revisionToken: "b".repeat(64),
    inputSnapshot: {
      schedulerSettings: settings,
      weights: Array.from({ length: 21 }, () => 0.1),
      parameterProfileId: "official-fsrs6-v1",
      selectedScopeRevisionMs: 0,
      effectiveSettingsSource: {
        kind: "global",
        settingsId: "scheduler-settings-global",
        updatedAtMs: 0,
      },
      packageVersion: "0.5.0",
      algorithmVersion: "6.0",
      adapterVersion: 1,
      schemaVersion: 1,
      rawReviewCount: 200,
      validReviewCount: 198,
      validSequenceCount: 100,
      excludedSequenceCount: 1,
      exclusions: { ...exclusions, missingDuration: 1 },
      sourceReviewCutoffMs: 5_000,
      sourceFingerprint: fingerprint,
    },
    result: succeeded ? {
      learning: {
        rawSeconds: [80, 5_806],
        applicableMinutes: [1, 96],
        belowResolutionSeconds: [],
      },
      relearning: {
        rawSeconds: [30],
        applicableMinutes: [],
        belowResolutionSeconds: [30],
      },
      statistics: {
        again: {
          count: 100,
          delayQ1Seconds: 50,
          delayQ2Seconds: 60,
          delayQ3Seconds: 70,
          retentionQ1: 0.8,
          retentionQ2: 0.85,
          retentionQ3: 0.9,
          retentionQ4: 0.95,
          retention: 0.875,
          stabilitySeconds: 80,
        },
        hard: null,
        good: null,
        againThenGood: null,
        goodThenAgain: null,
        relearning: null,
      },
      rawReviewCount: 200,
      validReviewCount: 198,
      validSequenceCount: 100,
      excludedSequenceCount: 1,
      exclusions: { ...exclusions, missingDuration: 1 },
    } : null,
    errorCode: null,
    appliedParts: null,
    priorSteps: null,
    appliedSteps: null,
    appliedAtMs: null,
    restoredAtMs: null,
    createdAtMs: 1_000,
    startedAtMs: 1_000,
    finishedAtMs: succeeded ? 2_000 : null,
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
    get: async <T,>() => run("succeeded") as T,
    post: async <T,>() => run("running") as T,
    patch: async <T,>() => ({}) as T,
    put: async <T,>() => ({}) as T,
    delete: async <T,>() => ({}) as T,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function renderPanel(
  client: ApiClient,
  language: "en" | "ar" = "en",
  onSettingsChanged = vi.fn(async () => undefined),
  pollIntervalMs = 1,
  initialScope: OptimizerScope = scope,
) {
  const i18n = await createI18n(language);
  const panel = (selectedScope: OptimizerScope) => (
    <I18nProvider i18n={i18n}>
      <StepRecommendationPanel
        api={client}
        currentSettings={settings}
        onSettingsChanged={onSettingsChanged}
        pollIntervalMs={pollIntervalMs}
        scope={selectedScope}
      />
    </I18nProvider>
  );
  const rendered = render(panel(initialScope));
  return {
    ...rendered,
    i18n,
    onSettingsChanged,
    rerenderScope(selectedScope: OptimizerScope) {
      rendered.rerender(panel(selectedScope));
    },
  };
}

describe("StepRecommendationPanel", () => {
  it("is collapsed by default, focuses analysis on open, and has no axe violations", async () => {
    const user = userEvent.setup();
    const rendered = await renderPanel(api());
    const disclosure = screen.getByRole("button", {
      name: "Learning-step recommendations",
    });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Analyze learning steps" }))
      .toBeNull();

    await user.click(disclosure);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Analyze learning steps" }),
    );
    expect((await axe.run(rendered.container)).violations).toEqual([]);
  });

  it("polls an indeterminate run and announces completion without statistics noise", async () => {
    const user = userEvent.setup();
    const get: ApiClient["get"] = async <T,>(_path: string) =>
      run("succeeded") as T;
    await renderPanel(api({ get }));
    await user.click(screen.getByRole("button", { name: "Learning-step recommendations" }));
    await user.click(screen.getByRole("button", { name: "Analyze learning steps" }));

    expect(screen.getByText("Analyzing learning steps")).toBeDefined();
    expect(screen.queryByRole("progressbar")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("step-live").textContent)
      .toContain("Learning-step analysis complete."));
    expect(screen.getByTestId("step-live").textContent).not.toContain("100");
    expect(screen.getByRole("heading", { name: "Again statistics" })).toBeDefined();
    expect(screen.getByText("1 minute, 20 seconds", { selector: "dd" })).toBeDefined();
    expect(screen.getByText("1 minute", { selector: "dd" })).toBeDefined();
    expect((screen.getByRole("button", { name: "Apply relearning steps" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/below OpenRecall's one-minute resolution/i)).toBeDefined();
  });

  it("uses one polite live region while analysis is active", async () => {
    const user = userEvent.setup();
    const rendered = await renderPanel(api(), "en", undefined, 10_000);
    await user.click(screen.getByRole("button", { name: "Learning-step recommendations" }));
    await user.click(screen.getByRole("button", { name: "Analyze learning steps" }));

    const liveRegions = rendered.container.querySelectorAll(
      '[aria-live], [role="status"]',
    );
    expect(liveRegions).toHaveLength(1);
    expect(liveRegions[0]?.textContent).toContain("Learning-step analysis started.");
    expect(screen.getByText("Analyzing learning steps")).toBeDefined();
  });

  it("keeps every nonzero unit in exact upstream recommendations", async () => {
    const user = userEvent.setup();
    const completed = run("succeeded");
    const exact = {
      ...completed,
      result: completed.result === null ? null : {
        ...completed.result,
        learning: {
          rawSeconds: [3_661, 86_461],
          applicableMinutes: [61, 1_441],
          belowResolutionSeconds: [],
        },
      },
    } satisfies StepRecommendationRun;
    await renderPanel(api({
      post: async <T,>() => exact as T,
    }));
    await user.click(screen.getByRole("button", { name: "Learning-step recommendations" }));
    await user.click(screen.getByRole("button", { name: "Analyze learning steps" }));

    const official = screen.getAllByText("Official recommendation")[0]
      ?.parentElement?.textContent ?? "";
    const saved = screen.getAllByText("Value OpenRecall can save")[0]
      ?.parentElement?.textContent ?? "";
    expect(official).toMatch(/1 hour.*1 minute.*1 second/u);
    expect(official).toMatch(/1 day.*1 minute.*1 second/u);
    expect(saved).toMatch(/1 hour.*1 minute/u);
    expect(saved).toMatch(/1 day.*1 minute/u);
    expect(saved).not.toContain("second");
  });

  it("discards a delayed start response after the settings scope changes", async () => {
    const user = userEvent.setup();
    const pendingStart = deferred<StepRecommendationRun>();
    const rendered = await renderPanel(api({
      post: async <T,>() => pendingStart.promise as Promise<T>,
    }), "en", undefined, 10_000);
    await user.click(screen.getByRole("button", { name: "Learning-step recommendations" }));
    await user.click(screen.getByRole("button", { name: "Analyze learning steps" }));

    rendered.rerenderScope({
      scopeType: "section",
      sectionId: "f9a78234-0de7-450c-aed4-991bf0565a3d",
    });
    await waitFor(() => expect(
      (screen.getByRole("button", { name: "Analyze learning steps" }) as HTMLButtonElement).disabled,
    ).toBe(false));
    pendingStart.resolve(run("running"));
    await pendingStart.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByRole("button", { name: "Cancel learning-step analysis" })).toBeNull();
    expect(screen.queryByText("Analyzing learning steps")).toBeNull();
  });

  it("does not refresh settings when a delayed apply resolves for an old scope", async () => {
    const user = userEvent.setup();
    const completed = run("succeeded");
    const pendingApply = deferred<StepRecommendationRun>();
    const onSettingsChanged = vi.fn(async () => undefined);
    const post: ApiClient["post"] = async <T,>(path: string) =>
      (path.endsWith("/apply") ? pendingApply.promise : Promise.resolve(completed)) as Promise<T>;
    const rendered = await renderPanel(api({ post }), "en", onSettingsChanged);
    await user.click(screen.getByRole("button", { name: "Learning-step recommendations" }));
    await user.click(screen.getByRole("button", { name: "Analyze learning steps" }));
    await user.click(screen.getByRole("button", { name: "Apply learning steps" }));
    await user.click(screen.getByRole("button", { name: "Confirm learning-step application" }));

    rendered.rerenderScope({
      scopeType: "section",
      sectionId: "f9a78234-0de7-450c-aed4-991bf0565a3d",
    });
    pendingApply.resolve({
      ...completed,
      appliedParts: ["learning"],
      priorSteps: { learning: [1, 10], relearning: [10] },
      appliedSteps: { learning: [1, 96], relearning: [10] },
      appliedAtMs: 3_000,
    });
    await pendingApply.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onSettingsChanged).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Analysis results" })).toBeNull();
  });

  it("cancels an active analysis and announces the terminal state", async () => {
    const user = userEvent.setup();
    const calls: string[] = [];
    const post: ApiClient["post"] = async <T,>(path: string, _body: unknown) => {
      calls.push(path);
      return (path.endsWith("/cancel") ? run("cancelled") : run("running")) as T;
    };
    await renderPanel(api({ post }), "en", undefined, 10_000);
    await user.click(screen.getByRole("button", { name: "Learning-step recommendations" }));
    await user.click(screen.getByRole("button", { name: "Analyze learning steps" }));
    await user.click(screen.getByRole("button", { name: "Cancel learning-step analysis" }));

    await waitFor(() => expect(screen.getByTestId("step-live").textContent)
      .toContain("Learning-step analysis cancelled."));
    expect(calls.at(-1)).toContain("/cancel");
    expect(screen.queryByRole("button", { name: "Cancel learning-step analysis" })).toBeNull();
  });

  it("shows an exact old/new confirmation, applies learning only, and refreshes settings", async () => {
    const user = userEvent.setup();
    const completed = run("succeeded");
    const applied = {
      ...completed,
      revisionToken: "c".repeat(64),
      appliedParts: ["learning" as const],
      priorSteps: { learning: [1, 10], relearning: [10] },
      appliedSteps: { learning: [1, 96], relearning: [10] },
      appliedAtMs: 3_000,
    };
    const calls: Array<{ path: string; body: unknown }> = [];
    const post: ApiClient["post"] = async <T,>(path: string, body: unknown) => {
      calls.push({ path, body });
      return (path.endsWith("/apply") ? applied : completed) as T;
    };
    const onSettingsChanged = vi.fn(async () => undefined);
    await renderPanel(api({ post }), "en", onSettingsChanged);
    await user.click(screen.getByRole("button", { name: "Learning-step recommendations" }));
    await user.click(screen.getByRole("button", { name: "Analyze learning steps" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Apply learning steps" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "Apply learning steps" }));

    expect(screen.getByRole("dialog").textContent).toContain("1 minute and 10 minutes");
    expect(screen.getByRole("dialog").textContent).toMatch(/1 minute and 1 hour,? 36 minutes/u);
    await user.click(screen.getByRole("button", { name: "Confirm learning-step application" }));
    await waitFor(() => expect(onSettingsChanged).toHaveBeenCalledWith(scope));
    expect(calls.at(-1)).toEqual({
      path: `/api/v1/optimizer/step-recommendations/${completed.id}/apply`,
      body: { parts: ["learning"], revisionToken: completed.revisionToken },
    });
    expect(screen.getByTestId("step-live").textContent).toContain("Learning steps applied.");
    expect(screen.getByRole("button", { name: "Restore previous learning steps" })).toBeDefined();
  });

  it("keeps results visible and offers analysis again after a stale conflict", async () => {
    const user = userEvent.setup();
    const completed = run("succeeded");
    const post: ApiClient["post"] = async <T,>(path: string, _body: unknown) => {
      if (path.endsWith("/apply")) {
        throw new ApiClientError(409, {
          code: "STEP_RECOMMENDATION_STALE",
          messageKey: "optimizer.steps.stale",
        });
      }
      return completed as T;
    };
    await renderPanel(api({ post }));
    await user.click(screen.getByRole("button", { name: "Learning-step recommendations" }));
    await user.click(screen.getByRole("button", { name: "Analyze learning steps" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Apply learning steps" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "Apply learning steps" }));
    await user.click(screen.getByRole("button", { name: "Confirm learning-step application" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("review data or settings changed"));
    expect(screen.getByRole("heading", { name: "Analysis results" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Analyze learning steps again" })).toBeDefined();
    expect((screen.getByRole("button", { name: "Apply learning steps" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("uses concise Arabic analysis and completion announcements", async () => {
    const user = userEvent.setup();
    await renderPanel(api({ get: async <T,>() => run("succeeded") as T }), "ar");
    await user.click(screen.getByRole("button", { name: "اقتراح خطوات التعلم" }));
    await user.click(screen.getByRole("button", { name: "تحليل خطوات التعلم" }));
    expect(screen.getByText("جارٍ تحليل خطوات التعلم")).toBeDefined();
    await waitFor(() => expect(screen.getByTestId("step-live").textContent)
      .toContain("اكتمل تحليل خطوات التعلم."));
    expect(screen.getByTestId("step-live").textContent).not.toContain("١٠٠");
  });
});
