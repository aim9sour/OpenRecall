import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../constants.js";
import { openDatabase } from "../open-database.js";

describe("optimizer training settings migration", () => {
  it("keeps the version 7 data valid after later migrations", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        expect(SCHEMA_VERSION).toBe(8);
        expect(db.pragma("user_version", { simple: true })).toBe(8);
        expect(
          db.prepare("SELECT settings_json FROM optimizer_setting_scopes WHERE scope_type = 'global'").get(),
        ).toEqual({
          settings_json: JSON.stringify({ numEpochs: 5, batchSize: 512, maxSeqLen: 256 }),
        });

        db.prepare(`
          INSERT INTO optimizer_runs (
            id, scope_type, section_id, status, raw_review_count,
            eligible_example_count, source_review_cutoff_ms, package_version,
            algorithm_version, progress, created_at_ms
          ) VALUES ('legacy-run', 'global', NULL, 'failed', 0, 0, NULL, '0.5.0', '6.0', 0, 1)
        `).run();
        expect(
          db.prepare(`SELECT input_snapshot_json, max_sequence_excluded_count,
                             source_review_fingerprint
                      FROM optimizer_runs WHERE id = 'legacy-run'`).get(),
        ).toEqual({
          input_snapshot_json: null,
          max_sequence_excluded_count: 0,
          source_review_fingerprint: null,
        });
      } finally {
        db.close();
      }
    });
  });

  it("enforces one override per section and cascades it on section deletion", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        db.exec(`
          INSERT INTO sections (id, name, created_at_ms, updated_at_ms)
          VALUES ('d9428888-122b-41e1-985c-61cd3cbb3210', 'Biology', 1, 1);
          INSERT INTO optimizer_setting_scopes
            (id, scope_type, section_id, adapter_version, settings_json, created_at_ms, updated_at_ms)
          VALUES
            ('one', 'section', 'd9428888-122b-41e1-985c-61cd3cbb3210', 2,
             '{"numEpochs":5,"batchSize":512,"maxSeqLen":256}', 1, 1);
        `);
        expect(() => db.exec(`
          INSERT INTO optimizer_setting_scopes
            (id, scope_type, section_id, adapter_version, settings_json, created_at_ms, updated_at_ms)
          VALUES
            ('two', 'section', 'd9428888-122b-41e1-985c-61cd3cbb3210', 2,
             '{"numEpochs":7,"batchSize":256,"maxSeqLen":128}', 2, 2);
        `)).toThrow();
        db.prepare("DELETE FROM sections WHERE id = ?").run("d9428888-122b-41e1-985c-61cd3cbb3210");
        expect(db.prepare("SELECT count(*) FROM optimizer_setting_scopes WHERE scope_type = 'section'").pluck().get()).toBe(0);
      } finally {
        db.close();
      }
    });
  });
});
