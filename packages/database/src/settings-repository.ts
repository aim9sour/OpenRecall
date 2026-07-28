import type {
  ParameterProfileCandidate,
  SchedulerSettingsCandidate,
} from "@openrecall/domain";
import { validateSchedulerSettings } from "@openrecall/scheduler";
import type Database from "better-sqlite3";

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
}
