import { randomUUID } from "node:crypto";
import type {
  OptimizerSettingsView,
  OptimizerTrainingSettings,
  OptimizerTrainingSettingsScope,
} from "@openrecall/contracts";
import {
  DEFAULT_OPTIMIZER_TRAINING_SETTINGS,
  OPTIMIZER_TRAINING_MANIFEST,
  validateOptimizerTrainingSettings,
  type EffectiveOptimizerTrainingSettings,
} from "@openrecall/optimizer";
import type Database from "better-sqlite3";

interface OptimizerSettingsRow {
  readonly id: string;
  readonly scope_type: "global" | "section";
  readonly section_id: string | null;
  readonly adapter_version: number;
  readonly settings_json: string;
  readonly created_at_ms: number;
  readonly updated_at_ms: number;
}

function mapSettings(row: OptimizerSettingsRow | undefined): OptimizerTrainingSettingsScope | null {
  if (row === undefined) return null;
  if (row.adapter_version > OPTIMIZER_TRAINING_MANIFEST.adapterVersion) {
    throw new Error("OPTIMIZER_SETTINGS_PERSISTED_INCOMPATIBLE");
  }
  try {
    return {
      id: row.id,
      scopeType: row.scope_type,
      sectionId: row.section_id,
      adapterVersion: row.adapter_version,
      settings: validateOptimizerTrainingSettings(JSON.parse(row.settings_json)),
      createdAtMs: row.created_at_ms,
      updatedAtMs: row.updated_at_ms,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "OPTIMIZER_SETTINGS_PERSISTED_INCOMPATIBLE") {
      throw error;
    }
    throw new Error("OPTIMIZER_SETTINGS_PERSISTED_INVALID");
  }
}

export class OptimizerSettingsRepository {
  readonly #db: Database.Database;

  constructor(db: Database.Database) {
    this.#db = db;
  }

  getGlobal(): OptimizerTrainingSettingsScope | null {
    return mapSettings(this.#db.prepare<[], OptimizerSettingsRow>(`
      SELECT id, scope_type, section_id, adapter_version, settings_json,
             created_at_ms, updated_at_ms
      FROM optimizer_setting_scopes WHERE scope_type = 'global'
    `).get());
  }

  getSection(sectionId: string): OptimizerTrainingSettingsScope | null {
    return mapSettings(this.#db.prepare<[string], OptimizerSettingsRow>(`
      SELECT id, scope_type, section_id, adapter_version, settings_json,
             created_at_ms, updated_at_ms
      FROM optimizer_setting_scopes
      WHERE scope_type = 'section' AND section_id = ?
    `).get(sectionId));
  }

  resolveEffective(sectionId: string | null): EffectiveOptimizerTrainingSettings {
    const global = this.getGlobal();
    const section = sectionId === null ? null : this.getSection(sectionId);
    const selected = section ?? global;
    if (selected === null) {
      return {
        settings: DEFAULT_OPTIMIZER_TRAINING_SETTINGS,
        source: { kind: "adapter-default", settingsId: null, updatedAtMs: null },
      };
    }
    return {
      settings: selected.settings,
      source: {
        kind: section !== null ? "section" : "global",
        settingsId: selected.id,
        updatedAtMs: selected.updatedAtMs,
      },
    };
  }

  getView(sectionId: string | null): OptimizerSettingsView {
    return {
      manifest: OPTIMIZER_TRAINING_MANIFEST,
      defaults: DEFAULT_OPTIMIZER_TRAINING_SETTINGS,
      selectedScope: sectionId === null
        ? { scopeType: "global", sectionId: null }
        : { scopeType: "section", sectionId },
      savedOverride: sectionId === null ? this.getGlobal() : this.getSection(sectionId),
      effective: this.resolveEffective(sectionId),
    };
  }

  saveGlobal(input: {
    readonly expectedUpdatedAtMs: number;
    readonly settings: OptimizerTrainingSettings;
    readonly nowMs: number;
  }): OptimizerTrainingSettingsScope {
    return this.#save({ ...input, scopeType: "global", sectionId: null });
  }

  saveSection(input: {
    readonly sectionId: string;
    readonly expectedUpdatedAtMs: number | null;
    readonly settings: OptimizerTrainingSettings;
    readonly nowMs: number;
  }): OptimizerTrainingSettingsScope {
    return this.#save({ ...input, scopeType: "section" });
  }

  deleteSection(input: { readonly sectionId: string; readonly expectedUpdatedAtMs: number }): void {
    const result = this.#db.prepare(`
      DELETE FROM optimizer_setting_scopes
      WHERE scope_type = 'section' AND section_id = ? AND updated_at_ms = ?
    `).run(input.sectionId, input.expectedUpdatedAtMs);
    if (result.changes !== 1) throw new Error("SETTINGS_EDIT_CONFLICT");
  }

  #save(input: {
    readonly scopeType: "global" | "section";
    readonly sectionId: string | null;
    readonly expectedUpdatedAtMs: number | null;
    readonly settings: OptimizerTrainingSettings;
    readonly nowMs: number;
  }): OptimizerTrainingSettingsScope {
    const settings = validateOptimizerTrainingSettings(input.settings);
    if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
      throw new RangeError("SETTINGS_TIME_INVALID");
    }
    return this.#db.transaction(() => {
      const current = input.scopeType === "global"
        ? this.getGlobal()
        : this.getSection(input.sectionId ?? "");
      if ((current?.updatedAtMs ?? null) !== input.expectedUpdatedAtMs) {
        throw new Error("SETTINGS_EDIT_CONFLICT");
      }
      const updatedAtMs = Math.max(input.nowMs, (current?.updatedAtMs ?? -1) + 1);
      const id = current?.id ?? randomUUID();
      const createdAtMs = current?.createdAtMs ?? updatedAtMs;
      if (current === null) {
        this.#db.prepare(`
          INSERT INTO optimizer_setting_scopes
            (id, scope_type, section_id, adapter_version, settings_json,
             created_at_ms, updated_at_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, input.scopeType, input.sectionId,
          OPTIMIZER_TRAINING_MANIFEST.adapterVersion, JSON.stringify(settings),
          createdAtMs, updatedAtMs);
      } else {
        const result = this.#db.prepare(`
          UPDATE optimizer_setting_scopes
          SET adapter_version = ?, settings_json = ?, updated_at_ms = ?
          WHERE id = ? AND updated_at_ms = ?
        `).run(OPTIMIZER_TRAINING_MANIFEST.adapterVersion, JSON.stringify(settings),
          updatedAtMs, id, input.expectedUpdatedAtMs);
        if (result.changes !== 1) throw new Error("SETTINGS_EDIT_CONFLICT");
      }
      return {
        id,
        scopeType: input.scopeType,
        sectionId: input.sectionId,
        adapterVersion: OPTIMIZER_TRAINING_MANIFEST.adapterVersion,
        settings,
        createdAtMs,
        updatedAtMs,
      };
    })();
  }
}
