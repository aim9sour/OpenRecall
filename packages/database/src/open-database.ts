import Database from "better-sqlite3";
import {
  createBackupService,
  type BackupService,
  type CreateBackupServiceOptions,
} from "./backup-service.js";
import {
  APPLICATION_ID,
  BUSY_TIMEOUT_MS,
  SCHEMA_VERSION,
} from "./constants.js";
import { migrateDatabase } from "./migrate.js";

const STARTUP_POLICY_ERROR = "DATABASE_STARTUP_POLICY_FAILED";

function verifyPragma(
  db: Database.Database,
  pragma: string,
  expected: string | number,
): void {
  if (db.pragma(pragma, { simple: true }) !== expected) {
    throw new Error(STARTUP_POLICY_ERROR);
  }
}

function openConfiguredConnection(path: string): Database.Database {
  const db = new Database(path);

  try {
    db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
    db.pragma("trusted_schema = OFF");

    verifyPragma(db, "busy_timeout", BUSY_TIMEOUT_MS);
    verifyPragma(db, "foreign_keys", 1);
    verifyPragma(db, "journal_mode", "wal");
    verifyPragma(db, "synchronous", 2);
    verifyPragma(db, "trusted_schema", 0);
  } catch {
    db.close();
    throw new Error(STARTUP_POLICY_ERROR);
  }

  return db;
}

function readIntegerPragma(
  db: Database.Database,
  name: "application_id" | "user_version",
): number {
  const value: unknown = db.pragma(name, { simple: true });
  if (!Number.isSafeInteger(value)) {
    throw new Error("DATABASE_PRAGMA_INVALID");
  }
  return value as number;
}

function needsPreMigrationBackup(db: Database.Database): boolean {
  const applicationId = readIntegerPragma(db, "application_id");
  const userVersion = readIntegerPragma(db, "user_version");
  return (
    applicationId === APPLICATION_ID &&
    userVersion >= 1 &&
    userVersion < SCHEMA_VERSION
  );
}

function migrateAndVerify(db: Database.Database): Database.Database {
  migrateDatabase(db);
  verifyPragma(db, "application_id", APPLICATION_ID);
  verifyPragma(db, "user_version", SCHEMA_VERSION);
  return db;
}

export function openDatabase(path: string): Database.Database {
  const db = openConfiguredConnection(path);
  try {
    if (needsPreMigrationBackup(db)) {
      throw new Error("DATABASE_PRE_MIGRATION_BACKUP_REQUIRED");
    }
    return migrateAndVerify(db);
  } catch (error) {
    db.close();
    throw error;
  }
}

export interface PreMigrationOpenOptions {
  readonly snapshotDirectory: string;
  readonly nowMs?: () => number;
  readonly backupFactory?: (
    options: CreateBackupServiceOptions,
  ) => BackupService;
}

export async function openDatabaseWithPreMigrationBackup(
  path: string,
  options: PreMigrationOpenOptions,
): Promise<Database.Database> {
  const db = openConfiguredConnection(path);
  try {
    if (needsPreMigrationBackup(db)) {
      const backup = (options.backupFactory ?? createBackupService)({
        db,
        snapshotDirectory: options.snapshotDirectory,
        nowMs: options.nowMs ?? Date.now,
      });
      const snapshot = await backup.createSnapshot(
        "automatic",
        "pre-migration",
        new AbortController().signal,
      );
      await backup.validateSnapshot(snapshot.path);
    }
    return migrateAndVerify(db);
  } catch (error) {
    db.close();
    throw error;
  }
}

export function openValidatedRestoreCandidate(
  path: string,
): Database.Database {
  const db = openConfiguredConnection(path);
  try {
    return migrateAndVerify(db);
  } catch (error) {
    db.close();
    throw error;
  }
}
