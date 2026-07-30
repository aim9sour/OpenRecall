import { randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  rename,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  SCHEMA_VERSION,
  openValidatedRestoreCandidate,
  type BackupService,
} from "@openrecall/database";
import type { MaintenanceMode } from "./maintenance-mode.js";
import { restoreSwapPaths } from "./restore-swap-recovery.js";

export interface RestoreLifecycle {
  stop(): Promise<void>;
  open(databasePath: string): Promise<void>;
}

export interface RestoreResult {
  readonly databaseRevision: number;
  readonly restoredUserVersion: number;
  readonly preRestoreBackupFilename: string;
}

interface RestoreFileSystem {
  readonly rename: (from: string, to: string) => Promise<void>;
}

interface RestoreServiceOptions {
  readonly liveDatabasePath: string;
  readonly workingDirectory: string;
  readonly maintenance: MaintenanceMode;
  readonly backups: BackupService;
  readonly lifecycle: RestoreLifecycle;
  readonly nowMs?: () => number;
  readonly fileSystem?: Partial<RestoreFileSystem>;
}

async function exists(path: string): Promise<boolean> {
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

async function removeFile(path: string): Promise<void> {
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

function assertContained(root: string, path: string): void {
  const child = relative(root, path);
  if (
    child === "" ||
    isAbsolute(child) ||
    child === ".." ||
    child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error("RESTORE_PATH_INVALID");
  }
}

function validationCode(error: unknown): Error {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case "BACKUP_APPLICATION_ID_MISMATCH":
      return new Error("RESTORE_APPLICATION_MISMATCH");
    case "BACKUP_SCHEMA_VERSION_FUTURE":
      return new Error("RESTORE_SCHEMA_FUTURE");
    case "BACKUP_FOREIGN_KEY_CHECK_FAILED":
      return new Error("RESTORE_FOREIGN_KEYS_INVALID");
    default:
      return new Error("RESTORE_FILE_INVALID");
  }
}

export class RestoreService {
  readonly #livePath: string;
  readonly #workingDirectory: string;
  readonly #maintenance: MaintenanceMode;
  readonly #backups: BackupService;
  readonly #lifecycle: RestoreLifecycle;
  readonly #rename: RestoreFileSystem["rename"];

  constructor(options: RestoreServiceOptions) {
    this.#livePath = resolve(options.liveDatabasePath);
    this.#workingDirectory = resolve(options.workingDirectory);
    this.#maintenance = options.maintenance;
    this.#backups = options.backups;
    this.#lifecycle = options.lifecycle;
    this.#rename =
      options.fileSystem?.rename ??
      ((from, to) => rename(from, to));
  }

  async restoreFromUpload(
    stagedPath: string,
    expectedCurrentRevision: number,
  ): Promise<RestoreResult> {
    if (
      !Number.isSafeInteger(expectedCurrentRevision) ||
      expectedCurrentRevision < 1 ||
      expectedCurrentRevision !== this.#maintenance.revision
    ) {
      throw new Error("RESTORE_REVISION_CONFLICT");
    }
    const sourcePath = resolve(stagedPath);
    try {
      await this.#backups.validateSnapshot(sourcePath);
    } catch (error) {
      throw validationCode(error);
    }

    await mkdir(this.#workingDirectory, { recursive: true });
    if ((await lstat(this.#workingDirectory)).isSymbolicLink()) {
      throw new Error("RESTORE_PATH_INVALID");
    }
    const candidatePath = resolve(
      join(
        this.#workingDirectory,
        `restore-candidate-${randomUUID()}.sqlite3`,
      ),
    );
    assertContained(this.#workingDirectory, candidatePath);
    await copyFile(sourcePath, candidatePath);

    try {
      try {
        await this.#backups.validateSnapshot(candidatePath);
        const candidate = openValidatedRestoreCandidate(candidatePath);
        candidate.close();
        await this.#backups.validateSnapshot(candidatePath);
      } catch (error) {
        throw validationCode(error);
      }

      const lease = this.#maintenance.acquire(
        expectedCurrentRevision,
      );
      let stopped = false;
      let rollbackCreated = false;
      let replacementInstalled = false;
      let replacementOpened = false;
      const swapPaths = restoreSwapPaths(this.#livePath);
      try {
        await removeFile(swapPaths.committedOld);
        if (
          await exists(swapPaths.rollback) ||
          await exists(swapPaths.interruptedCandidate) ||
          await exists(`${swapPaths.interruptedCandidate}-wal`) ||
          await exists(`${swapPaths.interruptedCandidate}-shm`)
        ) {
          throw new Error("RESTORE_RECOVERY_REQUIRED");
        }
        const backup = await this.#backups.createSnapshot(
          "automatic",
          "pre-restore",
          new AbortController().signal,
        );
        await this.#backups.validateSnapshot(backup.path);
        await this.#lifecycle.stop();
        stopped = true;

        if (
          await exists(`${this.#livePath}-wal`) ||
          await exists(`${this.#livePath}-shm`)
        ) {
          throw new Error("RESTORE_LIVE_SIDECARS_REMAIN");
        }
        await this.#rename(this.#livePath, swapPaths.rollback);
        rollbackCreated = true;
        await this.#rename(candidatePath, this.#livePath);
        replacementInstalled = true;
        await this.#lifecycle.open(this.#livePath);
        replacementOpened = true;
        await this.#rename(
          swapPaths.rollback,
          swapPaths.committedOld,
        );
        rollbackCreated = false;
        lease.completeRestore();
        try {
          await removeFile(swapPaths.committedOld);
        } catch {
          // The replacement crossed the explicit commit point and is already
          // open. Startup recognizes this exact old-database path and retries
          // cleanup only after validating the live database.
        }
        return {
          databaseRevision: this.#maintenance.revision,
          restoredUserVersion: SCHEMA_VERSION,
          preRestoreBackupFilename: backup.filename,
        };
      } catch {
        if (stopped) {
          try {
            if (replacementOpened) {
              await this.#lifecycle.stop();
              replacementOpened = false;
            }
            if (replacementInstalled && await exists(this.#livePath)) {
              await this.#rename(this.#livePath, candidatePath);
              replacementInstalled = false;
            }
            if (rollbackCreated) {
              await this.#rename(
                swapPaths.rollback,
                this.#livePath,
              );
              rollbackCreated = false;
            }
            await this.#lifecycle.open(this.#livePath);
          } catch {
            lease.release();
            throw new Error("RESTORE_RECOVERY_FAILED");
          }
        }
        lease.release();
        throw new Error("RESTORE_SWAP_FAILED");
      }
    } finally {
      await removeFile(candidatePath);
      await removeFile(`${candidatePath}-wal`);
      await removeFile(`${candidatePath}-shm`);
    }
  }
}
