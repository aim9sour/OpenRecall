import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./open-database.js";
import { OptimizerSettingsRepository } from "./optimizer-settings-repository.js";

const sectionId = "d9428888-122b-41e1-985c-61cd3cbb3210";

describe("OptimizerSettingsRepository", () => {
  it("resolves general settings and section inheritance", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        db.prepare("INSERT INTO sections (id, name, created_at_ms, updated_at_ms) VALUES (?, 'Biology', 0, 0)").run(sectionId);
        const repository = new OptimizerSettingsRepository(db);
        expect(repository.resolveEffective(null).settings).toEqual({
          numEpochs: 5,
          batchSize: 512,
          maxSeqLen: 256,
        });
        expect(repository.resolveEffective(sectionId).source.kind).toBe("global");

        const saved = repository.saveSection({
          sectionId,
          expectedUpdatedAtMs: null,
          settings: { numEpochs: 7, batchSize: 256, maxSeqLen: 128 },
          nowMs: 10,
        });
        expect(saved.createdAtMs).toBe(10);
        expect(repository.resolveEffective(sectionId)).toMatchObject({
          settings: { numEpochs: 7, batchSize: 256, maxSeqLen: 128 },
          source: { kind: "section", settingsId: saved.id, updatedAtMs: 10 },
        });
      } finally {
        db.close();
      }
    });
  });

  it("guards writes and deletes with exact revisions", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        db.prepare("INSERT INTO sections (id, name, created_at_ms, updated_at_ms) VALUES (?, 'Biology', 0, 0)").run(sectionId);
        const repository = new OptimizerSettingsRepository(db);
        expect(() => repository.saveGlobal({
          expectedUpdatedAtMs: 99,
          settings: { numEpochs: 5, batchSize: 512, maxSeqLen: 256 },
          nowMs: 100,
        })).toThrow("SETTINGS_EDIT_CONFLICT");
        const saved = repository.saveSection({
          sectionId,
          expectedUpdatedAtMs: null,
          settings: { numEpochs: 3, batchSize: 128, maxSeqLen: 64 },
          nowMs: 10,
        });
        expect(() => repository.deleteSection({ sectionId, expectedUpdatedAtMs: 9 })).toThrow("SETTINGS_EDIT_CONFLICT");
        repository.deleteSection({ sectionId, expectedUpdatedAtMs: saved.updatedAtMs });
        expect(repository.getSection(sectionId)).toBeNull();
      } finally {
        db.close();
      }
    });
  });

  it("rejects incompatible or invalid persisted data instead of clamping it", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        const repository = new OptimizerSettingsRepository(db);
        db.prepare("UPDATE optimizer_setting_scopes SET adapter_version = 999 WHERE scope_type = 'global'").run();
        expect(() => repository.getGlobal()).toThrow("OPTIMIZER_SETTINGS_PERSISTED_INCOMPATIBLE");
        db.prepare("UPDATE optimizer_setting_scopes SET adapter_version = 2, settings_json = ? WHERE scope_type = 'global'")
          .run('{"numEpochs":100,"batchSize":512,"maxSeqLen":256}');
        expect(() => repository.getGlobal()).toThrow("OPTIMIZER_SETTINGS_PERSISTED_INVALID");
      } finally {
        db.close();
      }
    });
  });
});
