import type { SchedulerSettings } from "@openrecall/contracts";
import { describe, expect, it } from "vitest";
import {
  MINIMUM_ELIGIBLE_EXAMPLES,
  resolveEffectiveConfig,
  type ParameterProfileCandidate,
  type SchedulerSettingsCandidate,
} from "./resolve-effective-config.js";

const defaults: SchedulerSettings = {
  requestedRetention: 0.9,
  maximumIntervalDays: 36_500,
  enableFuzz: false,
  enableShortTerm: true,
  learningStepsMinutes: [1, 10],
  relearningStepsMinutes: [10],
};
const manifest = {
  adapterVersion: 1,
  algorithmId: "FSRS-6",
  algorithmVersion: "6.0",
  defaultSettings: defaults,
  defaultWeights: [1, 2, 3],
  officialProfileId: "official",
} as const;

function settings(
  scopeType: "global" | "section",
  requestedRetention: number,
): SchedulerSettingsCandidate {
  return {
    id: `${scopeType}-settings`,
    scopeType,
    sectionId: scopeType === "section" ? "section-1" : null,
    adapterVersion: 1,
    settings: { ...defaults, requestedRetention },
    updatedAtMs: 1,
  };
}

function profile(
  scopeType: "official" | "global" | "section",
  options: Partial<ParameterProfileCandidate> = {},
): ParameterProfileCandidate {
  return {
    id: `${scopeType}-profile`,
    scopeType,
    sectionId: scopeType === "section" ? "section-1" : null,
    algorithmId: "FSRS-6",
    algorithmVersion: "6.0",
    adapterVersion: 1,
    weights: [4, 5, 6],
    eligibleExampleCount:
      scopeType === "official" ? 0 : MINIMUM_ELIGIBLE_EXAMPLES,
    status: "active",
    createdAtMs: 1,
    ...options,
  };
}

describe("resolveEffectiveConfig", () => {
  it("uses section settings over global and global over adapter defaults", () => {
    const sectionResult = resolveEffectiveConfig({
      manifest,
      sectionId: "section-1",
      globalSettings: settings("global", 0.88),
      sectionSettings: settings("section", 0.94),
      parameterProfiles: [profile("official")],
    });
    expect(sectionResult.settings.requestedRetention).toBe(0.94);
    expect(sectionResult.settingsSource).toEqual({
      kind: "section",
      settingsId: "section-settings",
      updatedAtMs: 1,
    });

    const globalResult = resolveEffectiveConfig({
      manifest,
      sectionId: "section-1",
      globalSettings: settings("global", 0.88),
      sectionSettings: null,
      parameterProfiles: [profile("official")],
    });
    expect(globalResult.settings.requestedRetention).toBe(0.88);
    expect(globalResult.settingsSource.kind).toBe("global");

    const defaultResult = resolveEffectiveConfig({
      manifest,
      sectionId: "section-1",
      globalSettings: null,
      sectionSettings: null,
      parameterProfiles: [],
    });
    expect(defaultResult.settings).toEqual(defaults);
    expect(defaultResult.settingsSource.kind).toBe("adapter-default");
  });

  it("uses an eligible active section profile before global and official", () => {
    const result = resolveEffectiveConfig({
      manifest,
      sectionId: "section-1",
      globalSettings: null,
      sectionSettings: null,
      parameterProfiles: [
        profile("official", { weights: [1, 2, 3] }),
        profile("global", { weights: [7, 8, 9] }),
        profile("section", { weights: [10, 11, 12] }),
      ],
    });
    expect(result.weights).toEqual([10, 11, 12]);
    expect(result.parameterSource).toEqual({
      kind: "section",
      profileId: "section-profile",
      eligibleExampleCount: MINIMUM_ELIGIBLE_EXAMPLES,
    });
  });

  it("falls back from an ineligible section profile to eligible global", () => {
    const result = resolveEffectiveConfig({
      manifest,
      sectionId: "section-1",
      globalSettings: null,
      sectionSettings: null,
      parameterProfiles: [
        profile("official"),
        profile("global"),
        profile("section", {
          eligibleExampleCount: MINIMUM_ELIGIBLE_EXAMPLES - 1,
        }),
      ],
    });
    expect(result.parameterSource.kind).toBe("global");
  });

  it("falls back from ineligible or missing global data to official defaults", () => {
    for (const parameterProfiles of [
      [profile("global", { eligibleExampleCount: 399 })],
      [],
    ]) {
      const result = resolveEffectiveConfig({
        manifest,
        sectionId: "section-1",
        globalSettings: null,
        sectionSettings: null,
        parameterProfiles,
      });
      expect(result.weights).toEqual(manifest.defaultWeights);
      expect(result.parameterSource).toEqual({
        kind: "official",
        profileId: "official",
        eligibleExampleCount: 0,
      });
    }
  });

  it("never selects candidate, superseded, incompatible, or corrupt profiles", () => {
    const result = resolveEffectiveConfig({
      manifest,
      sectionId: "section-1",
      globalSettings: null,
      sectionSettings: null,
      parameterProfiles: [
        profile("section", { id: "candidate", status: "candidate" }),
        profile("section", { id: "superseded", status: "superseded" }),
        profile("section", { id: "wrong-version", algorithmVersion: "7.0" }),
        profile("section", { id: "wrong-length", weights: [1, 2] }),
        profile("official", { weights: [1, 2, 3] }),
      ],
    });
    expect(result.parameterSource.kind).toBe("official");
    expect(result.weights).toEqual([1, 2, 3]);
  });
});
