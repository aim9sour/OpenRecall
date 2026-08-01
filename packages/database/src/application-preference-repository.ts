import type { ApplicationLocalePreference } from "@openrecall/contracts";
import {
  isProductionLocale,
  type LocaleTag,
  type ProductionLocaleTag,
} from "@openrecall/i18n";
import type Database from "better-sqlite3";

const LOCALE_KEY = "ui.locale";
const LOCALE_VALUE_VERSION = 1;

interface ApplicationSettingRow {
  readonly json_value: string;
  readonly updated_at_ms: number;
}

interface StoredLocaleValue {
  readonly version: 1;
  readonly locale: LocaleTag;
}

export interface StoredApplicationLocalePreference {
  readonly locale: LocaleTag;
  readonly updatedAtMs: number;
}

export interface ApplicationPreferenceRepositoryOptions {
  readonly allowedLocales: readonly LocaleTag[];
  readonly initialLocale: LocaleTag;
  readonly nowMs: () => number;
}

export class ApplicationPreferenceConflictError extends Error {
  constructor(
    readonly current: StoredApplicationLocalePreference,
  ) {
    super("APPLICATION_SETTING_CONFLICT");
  }
}

function validateTime(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("APPLICATION_SETTING_TIME_INVALID");
  }
}

export class ApplicationPreferenceRepository {
  readonly #db: Database.Database;
  readonly #allowedLocales: ReadonlySet<LocaleTag>;
  readonly #initialLocale: LocaleTag;
  readonly #nowMs: () => number;

  constructor(
    db: Database.Database,
    options: ApplicationPreferenceRepositoryOptions,
  ) {
    this.#db = db;
    this.#allowedLocales = new Set(options.allowedLocales);
    this.#initialLocale = options.initialLocale;
    this.#nowMs = options.nowMs;
    if (!this.#allowedLocales.has(this.#initialLocale)) {
      throw new Error("APPLICATION_LOCALE_NOT_ALLOWED");
    }
  }

  initializeLocale(): StoredApplicationLocalePreference {
    const initialize = this.#db.transaction(() => {
      const current = this.#selectLocale();
      if (current !== undefined) {
        return this.#mapLocale(current);
      }
      const nowMs = this.#nowMs();
      validateTime(nowMs);
      this.#db
        .prepare(
          `
            INSERT INTO application_settings
              (key, json_value, updated_at_ms)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO NOTHING
          `,
        )
        .run(
          LOCALE_KEY,
          JSON.stringify({
            version: LOCALE_VALUE_VERSION,
            locale: this.#initialLocale,
          } satisfies StoredLocaleValue),
          nowMs,
        );
      return this.getLocale();
    });
    return initialize.immediate();
  }

  getLocale(): StoredApplicationLocalePreference {
    const row = this.#selectLocale();
    if (row === undefined) {
      throw new Error("APPLICATION_LOCALE_NOT_INITIALIZED");
    }
    return this.#mapLocale(row);
  }

  saveLocale(input: {
    readonly locale: ProductionLocaleTag;
    readonly expectedUpdatedAtMs: number;
    readonly nowMs: number;
  }): ApplicationLocalePreference {
    if (
      !isProductionLocale(input.locale) ||
      !this.#allowedLocales.has(input.locale)
    ) {
      throw new Error("APPLICATION_LOCALE_NOT_ALLOWED");
    }
    validateTime(input.expectedUpdatedAtMs);
    validateTime(input.nowMs);

    const save = this.#db.transaction(() => {
      const current = this.getLocale();
      if (current.updatedAtMs !== input.expectedUpdatedAtMs) {
        throw new ApplicationPreferenceConflictError(current);
      }
      const updatedAtMs = Math.max(
        input.nowMs,
        current.updatedAtMs + 1,
      );
      this.#db
        .prepare(
          `
            UPDATE application_settings
            SET json_value = ?, updated_at_ms = ?
            WHERE key = ? AND updated_at_ms = ?
          `,
        )
        .run(
          JSON.stringify({
            version: LOCALE_VALUE_VERSION,
            locale: input.locale,
          } satisfies StoredLocaleValue),
          updatedAtMs,
          LOCALE_KEY,
          input.expectedUpdatedAtMs,
        );
      return { locale: input.locale, updatedAtMs };
    });
    return save.immediate();
  }

  #selectLocale(): ApplicationSettingRow | undefined {
    return this.#db
      .prepare<[string], ApplicationSettingRow>(
        `
          SELECT json_value, updated_at_ms
          FROM application_settings
          WHERE key = ?
        `,
      )
      .get(LOCALE_KEY);
  }

  #mapLocale(
    row: ApplicationSettingRow,
  ): StoredApplicationLocalePreference {
    let value: unknown;
    try {
      value = JSON.parse(row.json_value);
    } catch {
      throw new Error("APPLICATION_LOCALE_PERSISTED_INVALID");
    }
    if (
      typeof value !== "object" ||
      value === null ||
      Object.keys(value).length !== 2 ||
      !("version" in value) ||
      value.version !== LOCALE_VALUE_VERSION ||
      !("locale" in value) ||
      typeof value.locale !== "string" ||
      !this.#allowedLocales.has(value.locale as LocaleTag) ||
      !Number.isSafeInteger(row.updated_at_ms) ||
      row.updated_at_ms < 0
    ) {
      throw new Error("APPLICATION_LOCALE_PERSISTED_INVALID");
    }
    return {
      locale: value.locale as LocaleTag,
      updatedAtMs: row.updated_at_ms,
    };
  }
}
