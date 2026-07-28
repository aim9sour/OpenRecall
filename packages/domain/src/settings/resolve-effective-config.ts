import type { SchedulerSettings } from "@openrecall/contracts";

export const MINIMUM_ELIGIBLE_EXAMPLES = 400;

export interface SchedulerSettingsCandidate {
  readonly id: string;
  readonly scopeType: "global" | "section";
  readonly sectionId: string | null;
  readonly adapterVersion: number;
  readonly settings: SchedulerSettings;
  readonly updatedAtMs: number;
}

export interface ParameterProfileCandidate {
  readonly id: string;
  readonly scopeType: "official" | "global" | "section";
  readonly sectionId: string | null;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly adapterVersion: number;
  readonly weights: readonly number[];
  readonly eligibleExampleCount: number;
  readonly status: "candidate" | "active" | "superseded";
  readonly createdAtMs: number;
}

export interface EffectiveConfigManifest {
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly adapterVersion: number;
  readonly defaultSettings: SchedulerSettings;
  readonly defaultWeights: readonly number[];
  readonly officialProfileId: string;
}

export interface EffectiveSchedulerConfig {
  readonly settings: SchedulerSettings;
  readonly settingsSource:
    | {
        readonly kind: "section" | "global";
        readonly settingsId: string;
        readonly updatedAtMs: number;
      }
    | {
        readonly kind: "adapter-default";
        readonly settingsId: null;
        readonly updatedAtMs: null;
      };
  readonly weights: readonly number[];
  readonly parameterSource: {
    readonly kind: "section" | "global" | "official";
    readonly profileId: string;
    readonly eligibleExampleCount: number;
  };
}

function cloneSettings(settings: SchedulerSettings): SchedulerSettings {
  return {
    ...settings,
    learningStepsMinutes: [...settings.learningStepsMinutes],
    relearningStepsMinutes: [...settings.relearningStepsMinutes],
  };
}

function settingsCompatible(
  candidate: SchedulerSettingsCandidate | null,
  kind: "global" | "section",
  sectionId: string,
  adapterVersion: number,
): candidate is SchedulerSettingsCandidate {
  return (
    candidate !== null &&
    candidate.scopeType === kind &&
    candidate.adapterVersion === adapterVersion &&
    (kind === "global"
      ? candidate.sectionId === null
      : candidate.sectionId === sectionId)
  );
}

function profileCompatible(
  profile: ParameterProfileCandidate,
  manifest: EffectiveConfigManifest,
): boolean {
  return (
    profile.status === "active" &&
    profile.algorithmId === manifest.algorithmId &&
    profile.algorithmVersion === manifest.algorithmVersion &&
    profile.adapterVersion === manifest.adapterVersion &&
    profile.weights.length === manifest.defaultWeights.length &&
    profile.weights.every(Number.isFinite)
  );
}

function newest(
  profiles: readonly ParameterProfileCandidate[],
): ParameterProfileCandidate | undefined {
  return [...profiles].sort(
    (left, right) =>
      right.createdAtMs - left.createdAtMs ||
      right.id.localeCompare(left.id),
  )[0];
}

export function resolveEffectiveConfig(input: {
  readonly manifest: EffectiveConfigManifest;
  readonly sectionId: string;
  readonly globalSettings: SchedulerSettingsCandidate | null;
  readonly sectionSettings: SchedulerSettingsCandidate | null;
  readonly parameterProfiles: readonly ParameterProfileCandidate[];
}): EffectiveSchedulerConfig {
  const { manifest, sectionId } = input;
  const sectionSettings = settingsCompatible(
    input.sectionSettings,
    "section",
    sectionId,
    manifest.adapterVersion,
  )
    ? input.sectionSettings
    : null;
  const globalSettings = settingsCompatible(
    input.globalSettings,
    "global",
    sectionId,
    manifest.adapterVersion,
  )
    ? input.globalSettings
    : null;
  const selectedSettings = sectionSettings ?? globalSettings;

  const compatible = input.parameterProfiles.filter((profile) =>
    profileCompatible(profile, manifest),
  );
  const sectionProfile = newest(
    compatible.filter(
      (profile) =>
        profile.scopeType === "section" &&
        profile.sectionId === sectionId &&
        profile.eligibleExampleCount >= MINIMUM_ELIGIBLE_EXAMPLES,
    ),
  );
  const globalProfile = newest(
    compatible.filter(
      (profile) =>
        profile.scopeType === "global" &&
        profile.sectionId === null &&
        profile.eligibleExampleCount >= MINIMUM_ELIGIBLE_EXAMPLES,
    ),
  );
  const officialProfile = newest(
    compatible.filter(
      (profile) =>
        profile.scopeType === "official" && profile.sectionId === null,
    ),
  );
  const selectedProfile =
    sectionProfile ?? globalProfile ?? officialProfile ?? null;

  return {
    settings: cloneSettings(
      selectedSettings?.settings ?? manifest.defaultSettings,
    ),
    settingsSource:
      selectedSettings === null
        ? {
            kind: "adapter-default",
            settingsId: null,
            updatedAtMs: null,
          }
        : {
            kind: selectedSettings.scopeType,
            settingsId: selectedSettings.id,
            updatedAtMs: selectedSettings.updatedAtMs,
          },
    weights: [
      ...(selectedProfile?.weights ?? manifest.defaultWeights),
    ],
    parameterSource: {
      kind: selectedProfile?.scopeType ?? "official",
      profileId: selectedProfile?.id ?? manifest.officialProfileId,
      eligibleExampleCount:
        selectedProfile?.eligibleExampleCount ?? 0,
    },
  };
}
