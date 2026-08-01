import type { ProductionLocaleTag } from "@openrecall/i18n";
import { withTempDatabase } from "@openrecall/test-support";
import { describe, expect, it } from "vitest";
import {
  ApplicationPreferenceConflictError,
  ApplicationPreferenceRepository,
} from "./application-preference-repository.js";
import { openDatabase } from "./open-database.js";

describe("ApplicationPreferenceRepository", () => {
  it("initializes the locale once as a versioned SQLite preference", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        const repository = new ApplicationPreferenceRepository(db, {
          allowedLocales: ["ar", "en"],
          initialLocale: "ar",
          nowMs: () => 1_000,
        });

        expect(repository.initializeLocale()).toEqual({
          locale: "ar",
          updatedAtMs: 1_000,
        });
        expect(
          JSON.parse(
            db
              .prepare(
                "SELECT json_value FROM application_settings WHERE key = 'ui.locale'",
              )
              .pluck()
              .get() as string,
          ),
        ).toEqual({ version: 1, locale: "ar" });
      } finally {
        db.close();
      }
    });
  });

  it("preserves a saved locale and advances same-millisecond revisions", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        const repository = new ApplicationPreferenceRepository(db, {
          allowedLocales: ["ar", "en"],
          initialLocale: "ar",
          nowMs: () => 1_000,
        });
        repository.initializeLocale();

        expect(
          repository.saveLocale({
            locale: "en",
            expectedUpdatedAtMs: 1_000,
            nowMs: 1_000,
          }),
        ).toEqual({ locale: "en", updatedAtMs: 1_001 });

        const reopened = new ApplicationPreferenceRepository(db, {
          allowedLocales: ["ar", "en"],
          initialLocale: "ar",
          nowMs: () => 9_000,
        });
        expect(reopened.initializeLocale()).toEqual({
          locale: "en",
          updatedAtMs: 1_001,
        });
      } finally {
        db.close();
      }
    });
  });

  it("allows an explicitly configured development locale only under that policy", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        const development = new ApplicationPreferenceRepository(db, {
          allowedLocales: ["ar", "en", "en-XA"],
          initialLocale: "en-XA",
          nowMs: () => 1_000,
        });
        expect(development.initializeLocale()).toEqual({
          locale: "en-XA",
          updatedAtMs: 1_000,
        });

        const production = new ApplicationPreferenceRepository(db, {
          allowedLocales: ["ar", "en"],
          initialLocale: "ar",
          nowMs: () => 2_000,
        });
        expect(() => production.getLocale()).toThrow(
          "APPLICATION_LOCALE_PERSISTED_INVALID",
        );
      } finally {
        db.close();
      }
    });
  });

  it("rejects malformed persisted locale JSON", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        db.prepare(
          "INSERT INTO application_settings (key, json_value, updated_at_ms) VALUES ('ui.locale', ?, 1)",
        ).run("not-json");
        const repository = new ApplicationPreferenceRepository(db, {
          allowedLocales: ["ar", "en"],
          initialLocale: "ar",
          nowMs: () => 2_000,
        });

        expect(() => repository.getLocale()).toThrow(
          "APPLICATION_LOCALE_PERSISTED_INVALID",
        );
      } finally {
        db.close();
      }
    });
  });

  it("returns the current value when a stale revision conflicts", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        const repository = new ApplicationPreferenceRepository(db, {
          allowedLocales: ["ar", "en"],
          initialLocale: "ar",
          nowMs: () => 1_000,
        });
        repository.initializeLocale();
        repository.saveLocale({
          locale: "en",
          expectedUpdatedAtMs: 1_000,
          nowMs: 2_000,
        });

        let conflict: unknown;
        try {
          repository.saveLocale({
            locale: "ar",
            expectedUpdatedAtMs: 1_000,
            nowMs: 3_000,
          });
        } catch (error) {
          conflict = error;
        }
        expect(conflict).toBeInstanceOf(ApplicationPreferenceConflictError);
        expect(
          (conflict as ApplicationPreferenceConflictError).current,
        ).toEqual({ locale: "en", updatedAtMs: 2_000 });
      } finally {
        db.close();
      }
    });
  });

  it("rejects a save outside the production locale contract", async () => {
    await withTempDatabase((databasePath) => {
      const db = openDatabase(databasePath);
      try {
        const repository = new ApplicationPreferenceRepository(db, {
          allowedLocales: ["ar", "en", "en-XA"],
          initialLocale: "ar",
          nowMs: () => 1_000,
        });
        repository.initializeLocale();

        expect(() =>
          repository.saveLocale({
            locale: "en-XA" as ProductionLocaleTag,
            expectedUpdatedAtMs: 1_000,
            nowMs: 2_000,
          }),
        ).toThrow("APPLICATION_LOCALE_NOT_ALLOWED");
      } finally {
        db.close();
      }
    });
  });
});
