import { randomUUID } from "node:crypto";
import {
  mkdir,
  lstat,
  readdir,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import {
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import Database from "better-sqlite3";
import {
  APPLICATION_ID,
  SCHEMA_VERSION,
} from "./constants.js";

export type SnapshotKind = "manual" | "automatic";

export interface Snapshot {
  readonly kind: SnapshotKind;
  readonly filename: string;
  readonly path: string;
  readonly createdAtMs: number;
}

export interface SnapshotValidation {
  readonly userVersion: number;
  readonly createdAtMs: number;
}

export interface BackupService {
  createSnapshot(
    kind: SnapshotKind,
    reason: string,
    signal: AbortSignal,
  ): Promise<Snapshot>;
  validateSnapshot(path: string): Promise<SnapshotValidation>;
}

export interface CreateBackupServiceOptions {
  readonly db: Database.Database;
  readonly snapshotDirectory: string;
  readonly nowMs: () => number;
}

const SNAPSHOT_PATTERN =
  /^openrecall-(automatic|manual)-(\d{1,16})-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.sqlite3$/i;
const AUTOMATIC_LIMIT = 10;

function assertContained(root: string, candidate: string): void {
  const child = relative(root, candidate);
  if (
    child === "" ||
    isAbsolute(child) ||
    child === ".." ||
    child.startsWith(`..\\`) ||
    child.startsWith("../")
  ) {
    throw new Error("BACKUP_PATH_ESCAPE");
  }
}

function createdAtFromFilename(filename: string): number | null {
  const match = SNAPSHOT_PATTERN.exec(filename);
  if (match === null) return null;
  const createdAtMs = Number(match[2]);
  return Number.isSafeInteger(createdAtMs) && createdAtMs >= 0
    ? createdAtMs
    : null;
}

async function removeExplicitFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

class SqliteBackupService implements BackupService {
  readonly #db: Database.Database;
  readonly #configuredDirectory: string;
  readonly #nowMs: () => number;

  constructor(options: CreateBackupServiceOptions) {
    this.#db = options.db;
    this.#configuredDirectory = resolve(options.snapshotDirectory);
    this.#nowMs = options.nowMs;
  }

  async #directory(): Promise<string> {
    await mkdir(this.#configuredDirectory, { recursive: true });
    if ((await lstat(this.#configuredDirectory)).isSymbolicLink()) {
      throw new Error("BACKUP_DIRECTORY_SYMLINK");
    }
    return realpath(this.#configuredDirectory);
  }

  async createSnapshot(
    kind: SnapshotKind,
    reason: string,
    signal: AbortSignal,
  ): Promise<Snapshot> {
    if (
      kind !== "manual" &&
      kind !== "automatic"
    ) {
      throw new Error("BACKUP_KIND_INVALID");
    }
    if (reason.trim().length === 0 || reason.length > 500) {
      throw new Error("BACKUP_REASON_INVALID");
    }
    const directory = await this.#directory();
    if (signal.aborted) throw new Error("BACKUP_CANCELLED");
    const createdAtMs = this.#nowMs();
    if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0) {
      throw new Error("BACKUP_TIME_INVALID");
    }
    const filename =
      `openrecall-${kind}-${createdAtMs}-${randomUUID()}.sqlite3`;
    if (filename.length > 120 || !SNAPSHOT_PATTERN.test(filename)) {
      throw new Error("BACKUP_FILENAME_INVALID");
    }
    const destination = resolve(join(directory, filename));
    assertContained(directory, destination);

    try {
      await this.#db.backup(destination, {
        progress(info) {
          if (signal.aborted) throw new Error("BACKUP_CANCELLED");
          return Math.max(1, info.remainingPages);
        },
      });
      if (signal.aborted) throw new Error("BACKUP_CANCELLED");
      await this.validateSnapshot(destination);
      if (kind === "automatic") {
        await this.#retainNewestAutomatic(directory);
      }
      return {
        kind,
        filename,
        path: destination,
        createdAtMs,
      };
    } catch (error) {
      await removeExplicitFile(destination);
      if (
        signal.aborted ||
        (error instanceof Error &&
          error.message === "BACKUP_CANCELLED")
      ) {
        throw new Error("BACKUP_CANCELLED");
      }
      throw error;
    }
  }

  async validateSnapshot(path: string): Promise<SnapshotValidation> {
    const snapshotPath = resolve(path);
    const file = await stat(snapshotPath);
    if (!file.isFile()) throw new Error("BACKUP_NOT_A_FILE");
    const walPath = `${snapshotPath}-wal`;
    const shmPath = `${snapshotPath}-shm`;
    const [walExisted, shmExisted] = await Promise.all([
      pathExists(walPath),
      pathExists(shmPath),
    ]);
    const copy = new Database(snapshotPath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      copy.pragma("foreign_keys = ON");
      const applicationId = copy.pragma("application_id", {
        simple: true,
      });
      if (applicationId !== APPLICATION_ID) {
        throw new Error("BACKUP_APPLICATION_ID_MISMATCH");
      }
      const userVersion = copy.pragma("user_version", { simple: true });
      if (
        !Number.isSafeInteger(userVersion) ||
        (userVersion as number) < 1
      ) {
        throw new Error("BACKUP_SCHEMA_VERSION_UNSUPPORTED");
      }
      if ((userVersion as number) > SCHEMA_VERSION) {
        throw new Error("BACKUP_SCHEMA_VERSION_FUTURE");
      }
      if (copy.pragma("quick_check", { simple: true }) !== "ok") {
        throw new Error("BACKUP_QUICK_CHECK_FAILED");
      }
      const foreignKeyFailures = copy.pragma("foreign_key_check");
      if (
        !Array.isArray(foreignKeyFailures) ||
        foreignKeyFailures.length !== 0
      ) {
        throw new Error("BACKUP_FOREIGN_KEY_CHECK_FAILED");
      }
      return {
        userVersion: userVersion as number,
        createdAtMs:
          createdAtFromFilename(snapshotPath.split(/[\\/]/).at(-1) ?? "") ??
          Math.max(0, Math.floor(file.mtimeMs)),
      };
    } finally {
      copy.close();
      if (!walExisted) await removeExplicitFile(walPath);
      if (!shmExisted) await removeExplicitFile(shmPath);
    }
  }

  async #retainNewestAutomatic(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => {
        if (!entry.isFile()) return false;
        const match = SNAPSHOT_PATTERN.exec(entry.name);
        return match?.[1] === "automatic";
      })
      .map((entry) => ({
        filename: entry.name,
        createdAtMs: createdAtFromFilename(entry.name) ?? -1,
      }))
      .sort(
        (left, right) =>
          right.createdAtMs - left.createdAtMs ||
          (left.filename < right.filename
            ? 1
            : left.filename > right.filename
              ? -1
              : 0),
      );
    const validated: string[] = [];
    for (const candidate of candidates) {
      const path = resolve(join(directory, candidate.filename));
      assertContained(directory, path);
      try {
        await this.validateSnapshot(path);
        validated.push(path);
      } catch {
        // A matching but invalid file is not treated as OpenRecall-owned.
      }
    }
    for (const path of validated.slice(AUTOMATIC_LIMIT)) {
      await removeExplicitFile(path);
    }
  }
}

export function createBackupService(
  options: CreateBackupServiceOptions,
): BackupService {
  return new SqliteBackupService(options);
}
