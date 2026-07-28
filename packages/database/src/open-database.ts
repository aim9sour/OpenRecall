import Database from "better-sqlite3";
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

export function openDatabase(path: string): Database.Database {
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

  try {
    migrateDatabase(db);
    verifyPragma(db, "application_id", APPLICATION_ID);
    verifyPragma(db, "user_version", SCHEMA_VERSION);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
