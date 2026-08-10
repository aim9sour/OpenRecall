import {
  DEFAULT_SCHEDULER_SETTINGS,
  FSRS6_MANIFEST,
} from "@openrecall/scheduler";
import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./open-database.js";
import {
  OFFICIAL_PARAMETER_PROFILE_ID,
  SCHEDULER_ADAPTER_VERSION,
  SCHEDULER_ALGORITHM_ID,
  SCHEDULER_ALGORITHM_VERSION,
} from "./review-types.js";
import { SettingsRepository } from "./settings-repository.js";

describe("SettingsRepository", () => {
  it("returns explicit global, optional section, and all resolution profiles", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        db.exec(`
          INSERT INTO sections
            (id, name, created_at_ms, updated_at_ms)
          VALUES ('section-1', 'Biology', 0, 0);
        `);
        const sectionSettings = {
          ...DEFAULT_SCHEDULER_SETTINGS,
          requestedRetention: 0.94,
        };
        db.prepare(
          `
            INSERT INTO scheduler_setting_scopes
              (
                id, scope_type, section_id, adapter_version,
                settings_json, updated_at_ms
              )
            VALUES ('settings-section-1', 'section', 'section-1', ?, ?, 10)
          `,
        ).run(
          FSRS6_MANIFEST.adapterSchemaVersion,
          JSON.stringify(sectionSettings),
        );
        db.prepare(
          `
            INSERT INTO parameter_profiles
              (
                id, scope_type, section_id, algorithm_id, algorithm_version,
                adapter_version, weights_json, eligible_example_count,
                review_cutoff_ms, status, created_at_ms
              )
            VALUES
              (
                'global-candidate', 'global', NULL, ?, ?, ?, ?, 500,
                20, 'candidate', 20
              ),
              (
                'section-active', 'section', 'section-1', ?, ?, ?, ?, 450,
                30, 'active', 30
              )
          `,
        ).run(
          SCHEDULER_ALGORITHM_ID,
          SCHEDULER_ALGORITHM_VERSION,
          SCHEDULER_ADAPTER_VERSION,
          JSON.stringify(FSRS6_MANIFEST.defaultWeights),
          SCHEDULER_ALGORITHM_ID,
          SCHEDULER_ALGORITHM_VERSION,
          SCHEDULER_ADAPTER_VERSION,
          JSON.stringify(FSRS6_MANIFEST.defaultWeights),
        );

        const input = new SettingsRepository(db).getResolutionInput(
          "section-1",
        );
        expect(input.globalSettings?.settings).toEqual(
          DEFAULT_SCHEDULER_SETTINGS,
        );
        expect(input.sectionSettings).toMatchObject({
          id: "settings-section-1",
          settings: sectionSettings,
        });
        expect(input.parameterProfiles.map(({ id }) => id)).toEqual([
          "section-active",
          "global-candidate",
          OFFICIAL_PARAMETER_PROFILE_ID,
        ]);
      } finally {
        db.close();
      }
    });
  });

  it("returns null for a missing section override and rejects malformed persisted settings", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        const repository = new SettingsRepository(db);
        expect(repository.getSectionSettings("missing")).toBeNull();

        db.prepare(
          `
            UPDATE scheduler_setting_scopes
            SET settings_json = ?
            WHERE scope_type = 'global'
          `,
        ).run(JSON.stringify({ requestedRetention: "bad" }));
        expect(() => repository.getGlobalSettings()).toThrow(
          "SCHEDULER_SETTINGS_PERSISTED_INVALID",
        );
      } finally {
        db.close();
      }
    });
  });

  it("saves recommended steps at the exact scope revision while preserving other controls", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        db.prepare(
          "INSERT INTO sections (id, name, created_at_ms, updated_at_ms) VALUES ('section-1', 'Biology', 0, 0)",
        ).run();
        const repository = new SettingsRepository(db);
        const global = repository.getGlobalSettings()!;
        const savedGlobal = repository.saveRecommendedSteps({
          scope: { scopeType: "global", sectionId: null },
          expectedUpdatedAtMs: global.updatedAtMs,
          settings: {
            ...global.settings,
            learningStepsMinutes: [1, 96],
          },
          nowMs: 10,
        });
        expect(savedGlobal.settings).toEqual({
          ...DEFAULT_SCHEDULER_SETTINGS,
          learningStepsMinutes: [1, 96],
        });
        expect(() => repository.saveRecommendedSteps({
          scope: { scopeType: "global", sectionId: null },
          expectedUpdatedAtMs: global.updatedAtMs,
          settings: global.settings,
          nowMs: 11,
        })).toThrow("SETTINGS_EDIT_CONFLICT");

        const savedSection = repository.saveRecommendedSteps({
          scope: { scopeType: "section", sectionId: "section-1" },
          expectedUpdatedAtMs: null,
          settings: {
            ...savedGlobal.settings,
            relearningStepsMinutes: [2, 30],
          },
          nowMs: 12,
        });
        expect(savedSection).toMatchObject({
          scopeType: "section",
          sectionId: "section-1",
          settings: {
            requestedRetention: DEFAULT_SCHEDULER_SETTINGS.requestedRetention,
            maximumIntervalDays: DEFAULT_SCHEDULER_SETTINGS.maximumIntervalDays,
            enableFuzz: DEFAULT_SCHEDULER_SETTINGS.enableFuzz,
            enableShortTerm: DEFAULT_SCHEDULER_SETTINGS.enableShortTerm,
            learningStepsMinutes: [1, 96],
            relearningStepsMinutes: [2, 30],
          },
        });
      } finally {
        db.close();
      }
    });
  });
});
