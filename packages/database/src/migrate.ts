import type Database from "better-sqlite3";
import { APPLICATION_ID } from "./constants.js";
import { coreMigration } from "./migrations/001-core.js";
import { reviewCoreMigration } from "./migrations/002-review-core.js";
import { cardManagementMigration } from "./migrations/003-card-management.js";
import { statisticsMigration } from "./migrations/004-statistics.js";
import { settingsOptimizerMigration } from "./migrations/005-settings-optimizer.js";
import { sectionDeletionMigration } from "./migrations/006-section-deletion.js";

export interface Migration {
  readonly version: number;
  readonly up: (db: Database.Database) => void;
}

const MIGRATIONS: readonly Migration[] = [
  coreMigration,
  reviewCoreMigration,
  cardManagementMigration,
  statisticsMigration,
  settingsOptimizerMigration,
  sectionDeletionMigration,
];

function readIntegerPragma(db: Database.Database, name: string): number {
  const value: unknown = db.pragma(name, { simple: true });

  if (!Number.isSafeInteger(value)) {
    throw new Error("DATABASE_PRAGMA_INVALID");
  }

  return value as number;
}

function validateMigrationSequence(
  currentVersion: number,
  migrations: readonly Migration[],
): readonly Migration[] {
  const pending = migrations.filter(
    (migration) => migration.version > currentVersion,
  );
  let expectedVersion = currentVersion + 1;

  for (const migration of pending) {
    if (migration.version !== expectedVersion) {
      throw new Error("DATABASE_MIGRATION_SEQUENCE_INVALID");
    }
    expectedVersion += 1;
  }

  return pending;
}

function verifyDatabaseIntegrity(db: Database.Database): void {
  if (db.pragma("quick_check", { simple: true }) !== "ok") {
    throw new Error("DATABASE_QUICK_CHECK_FAILED");
  }

  const foreignKeyViolations: unknown = db.pragma("foreign_key_check");
  if (
    !Array.isArray(foreignKeyViolations) ||
    foreignKeyViolations.length !== 0
  ) {
    throw new Error("DATABASE_FOREIGN_KEY_CHECK_FAILED");
  }
}

export function migrateDatabase(
  db: Database.Database,
  migrations: readonly Migration[] = MIGRATIONS,
): void {
  const currentApplicationId = readIntegerPragma(db, "application_id");
  if (
    currentApplicationId !== 0 &&
    currentApplicationId !== APPLICATION_ID
  ) {
    throw new Error("DATABASE_APPLICATION_ID_MISMATCH");
  }

  const currentVersion = readIntegerPragma(db, "user_version");
  const pending = validateMigrationSequence(currentVersion, migrations);

  if (pending.length > 0) {
    const foreignKeysEnabled = readIntegerPragma(db, "foreign_keys");
    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        for (const migration of pending) {
          migration.up(db);
          db.pragma(`application_id = ${APPLICATION_ID}`);
          db.pragma(`user_version = ${migration.version}`);
        }

        verifyDatabaseIntegrity(db);
      })();
    } finally {
      db.pragma(
        `foreign_keys = ${foreignKeysEnabled === 0 ? "OFF" : "ON"}`,
      );
    }
  } else {
    verifyDatabaseIntegrity(db);
  }

  db.pragma("optimize");
}
