import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../constants.js";
import { openDatabase } from "../open-database.js";

describe("step recommendation migration", () => {
  it("creates schema 8 and enforces scope, fingerprint, JSON, and cascade constraints", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        expect(SCHEMA_VERSION).toBe(8);
        db.prepare("INSERT INTO sections (id, name, created_at_ms, updated_at_ms) VALUES (?, 'Biology', 0, 0)")
          .run("d9428888-122b-41e1-985c-61cd3cbb3210");
        const insert = db.prepare(`
          INSERT INTO step_recommendation_runs (
            id, scope_type, section_id, status, source_review_cutoff_ms,
            source_fingerprint, revision_token, input_snapshot_json,
            created_at_ms, started_at_ms
          ) VALUES (?, ?, ?, 'running', 1, ?, ?, '{}', 1, 1)
        `);
        insert.run("a8f65aa8-122b-41e1-985c-61cd3cbb3210", "section", "d9428888-122b-41e1-985c-61cd3cbb3210", "a".repeat(64), "b".repeat(64));
        expect(() => insert.run("b8f65aa8-122b-41e1-985c-61cd3cbb3210", "global", "d9428888-122b-41e1-985c-61cd3cbb3210", "a".repeat(64), "b".repeat(64))).toThrow();
        expect(() => insert.run("c8f65aa8-122b-41e1-985c-61cd3cbb3210", "global", null, "short", "b".repeat(64))).toThrow();
        db.prepare("DELETE FROM sections WHERE id = ?").run("d9428888-122b-41e1-985c-61cd3cbb3210");
        expect(db.prepare("SELECT count(*) FROM step_recommendation_runs").pluck().get()).toBe(0);
      } finally {
        db.close();
      }
    });
  });
});
