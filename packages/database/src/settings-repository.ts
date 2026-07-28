import { randomUUID } from "node:crypto";
import type {
  SchedulerManifest,
  SchedulerSettings,
} from "@openrecall/contracts";
import type {
  EffectiveSchedulerConfig,
  ParameterProfileCandidate,
  SchedulerSettingsCandidate,
} from "@openrecall/domain";
import { resolveEffectiveConfig } from "@openrecall/domain";
import {
  DEFAULT_SCHEDULER_SETTINGS,
  FSRS6_MANIFEST,
  validateSchedulerSettings,
} from "@openrecall/scheduler";
import type Database from "better-sqlite3";
import { OFFICIAL_PARAMETER_PROFILE_ID } from "./review-types.js";

export const CURRENT_SCHEDULER_SETTINGS_MANIFEST: SchedulerManifest = {
  algorithmId: FSRS6_MANIFEST.algorithmId,
  algorithmVersion: FSRS6_MANIFEST.algorithmVersion,
  upstreamPackage: FSRS6_MANIFEST.upstreamPackage,
  adapterVersion: FSRS6_MANIFEST.adapterVersion,
  controls: [...FSRS6_MANIFEST.controls],
};

export const CURRENT_DEFAULT_SCHEDULER_SETTINGS =
  DEFAULT_SCHEDULER_SETTINGS;

export function validateCurrentSchedulerSettings(
  value: unknown,
): SchedulerSettings {
  return validateSchedulerSettings(value);
}

interface SettingsRow {
  readonly id: string;
  readonly scope_type: "global" | "section";
  readonly section_id: string | null;
  readonly adapter_version: number;
  readonly settings_json: string;
  readonly updated_at_ms: number;
}

interface ProfileRow {
  readonly id: string;
  readonly scope_type: "official" | "global" | "section";
  readonly section_id: string | null;
  readonly algorithm_id: string;
  readonly algorithm_version: string;
  readonly adapter_version: number;
  readonly weights_json: string;
  readonly eligible_example_count: number;
  readonly status: "candidate" | "active" | "superseded";
  readonly created_at_ms: number;
}

function mapSettings(row: SettingsRow | undefined): SchedulerSettingsCandidate | null {
  if (row === undefined) return null;
  try {
    return {
      id: row.id,
      scopeType: row.scope_type,
      sectionId: row.section_id,
      adapterVersion: row.adapter_version,
      settings: validateSchedulerSettings(JSON.parse(row.settings_json)),
      updatedAtMs: row.updated_at_ms,
    };
  } catch {
    throw new Error("SCHEDULER_SETTINGS_PERSISTED_INVALID");
  }
}

function mapProfile(row: ProfileRow): ParameterProfileCandidate {
  let weights: unknown;
  try {
    weights = JSON.parse(row.weights_json);
  } catch {
    throw new Error("PARAMETER_PROFILE_PERSISTED_INVALID");
  }
  if (
    !Array.isArray(weights) ||
    weights.some((weight) => typeof weight !== "number" || !Number.isFinite(weight))
  ) {
    throw new Error("PARAMETER_PROFILE_PERSISTED_INVALID");
  }
  return {
    id: row.id,
    scopeType: row.scope_type,
    sectionId: row.section_id,
    algorithmId: row.algorithm_id,
    algorithmVersion: row.algorithm_version,
    adapterVersion: row.adapter_version,
    weights,
    eligibleExampleCount: row.eligible_example_count,
    status: row.status,
    createdAtMs: row.created_at_ms,
  };
}

export class SettingsRepository {
  readonly #db: Database.Database;

  constructor(db: Database.Database) {
    this.#db = db;
  }

  getGlobalSettings(): SchedulerSettingsCandidate | null {
    return mapSettings(
      this.#db
        .prepare<[], SettingsRow>(
          `
            SELECT
              id, scope_type, section_id, adapter_version,
              settings_json, updated_at_ms
            FROM scheduler_setting_scopes
            WHERE scope_type = 'global'
          `,
        )
        .get(),
    );
  }

  getSectionSettings(sectionId: string): SchedulerSettingsCandidate | null {
    return mapSettings(
      this.#db
        .prepare<[string], SettingsRow>(
          `
            SELECT
              id, scope_type, section_id, adapter_version,
              settings_json, updated_at_ms
            FROM scheduler_setting_scopes
            WHERE scope_type = 'section' AND section_id = ?
          `,
        )
        .get(sectionId),
    );
  }

  getParameterProfiles(sectionId: string): ParameterProfileCandidate[] {
    return this.#db
      .prepare<[string], ProfileRow>(
        `
          SELECT
            id, scope_type, section_id, algorithm_id, algorithm_version,
            adapter_version, weights_json, eligible_example_count, status,
            created_at_ms
          FROM parameter_profiles
          WHERE scope_type IN ('official', 'global')
            OR (scope_type = 'section' AND section_id = ?)
          ORDER BY
            CASE scope_type
              WHEN 'section' THEN 1
              WHEN 'global' THEN 2
              ELSE 3
            END,
            created_at_ms DESC,
            id
        `,
      )
      .all(sectionId)
      .map(mapProfile);
  }

  getResolutionInput(sectionId: string): {
    readonly globalSettings: SchedulerSettingsCandidate | null;
    readonly sectionSettings: SchedulerSettingsCandidate | null;
    readonly parameterProfiles: readonly ParameterProfileCandidate[];
  } {
    return {
      globalSettings: this.getGlobalSettings(),
      sectionSettings: this.getSectionSettings(sectionId),
      parameterProfiles: this.getParameterProfiles(sectionId),
    };
  }

  resolveEffective(sectionId: string): EffectiveSchedulerConfig {
    return resolveEffectiveConfig({
      manifest: {
        algorithmId: FSRS6_MANIFEST.algorithmId,
        algorithmVersion: FSRS6_MANIFEST.algorithmVersion,
        adapterVersion: FSRS6_MANIFEST.adapterVersion,
        defaultSettings: DEFAULT_SCHEDULER_SETTINGS,
        defaultWeights: FSRS6_MANIFEST.defaultWeights,
        officialProfileId: OFFICIAL_PARAMETER_PROFILE_ID,
      },
      sectionId,
      ...this.getResolutionInput(sectionId),
    });
  }

  saveGlobalSettings(input: {
    readonly expectedUpdatedAtMs: number;
    readonly adapterVersion: number;
    readonly settings: SchedulerSettings;
    readonly nowMs: number;
  }): SchedulerSettingsCandidate {
    return this.#save({
      ...input,
      scopeType: "global",
      sectionId: null,
    });
  }

  saveSectionSettings(input: {
    readonly sectionId: string;
    readonly expectedUpdatedAtMs: number | null;
    readonly adapterVersion: number;
    readonly settings: SchedulerSettings;
    readonly nowMs: number;
  }): SchedulerSettingsCandidate {
    return this.#save({
      ...input,
      scopeType: "section",
    });
  }

  deleteSectionSettings(input: {
    readonly sectionId: string;
    readonly expectedUpdatedAtMs: number;
  }): void {
    const result = this.#db
      .prepare(
        `
          DELETE FROM scheduler_setting_scopes
          WHERE scope_type = 'section'
            AND section_id = ?
            AND updated_at_ms = ?
        `,
      )
      .run(input.sectionId, input.expectedUpdatedAtMs);
    if (result.changes !== 1) {
      throw new Error("SETTINGS_EDIT_CONFLICT");
    }
  }

  #save(input: {
    readonly scopeType: "global" | "section";
    readonly sectionId: string | null;
    readonly expectedUpdatedAtMs: number | null;
    readonly adapterVersion: number;
    readonly settings: SchedulerSettings;
    readonly nowMs: number;
  }): SchedulerSettingsCandidate {
    if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
      throw new RangeError("SETTINGS_TIME_INVALID");
    }
    const save = this.#db.transaction(() => {
      const current =
        input.scopeType === "global"
          ? this.getGlobalSettings()
          : this.getSectionSettings(input.sectionId ?? "");
      if ((current?.updatedAtMs ?? null) !== input.expectedUpdatedAtMs) {
        throw new Error("SETTINGS_EDIT_CONFLICT");
      }
      const updatedAtMs = Math.max(
        input.nowMs,
        (current?.updatedAtMs ?? -1) + 1,
      );
      const id = current?.id ?? randomUUID();
      const canonicalJson = JSON.stringify(input.settings);
      if (current === null) {
        this.#db
          .prepare(
            `
              INSERT INTO scheduler_setting_scopes
                (
                  id, scope_type, section_id, adapter_version,
                  settings_json, updated_at_ms
                )
              VALUES (?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            id,
            input.scopeType,
            input.sectionId,
            input.adapterVersion,
            canonicalJson,
            updatedAtMs,
          );
      } else {
        const result = this.#db
          .prepare(
            `
              UPDATE scheduler_setting_scopes
              SET adapter_version = ?, settings_json = ?, updated_at_ms = ?
              WHERE id = ? AND updated_at_ms = ?
            `,
          )
          .run(
            input.adapterVersion,
            canonicalJson,
            updatedAtMs,
            current.id,
            input.expectedUpdatedAtMs,
          );
        if (result.changes !== 1) {
          throw new Error("SETTINGS_EDIT_CONFLICT");
        }
      }
      return {
        id,
        scopeType: input.scopeType,
        sectionId: input.sectionId,
        adapterVersion: input.adapterVersion,
        settings: input.settings,
        updatedAtMs,
      } satisfies SchedulerSettingsCandidate;
    });
    return save();
  }
}
