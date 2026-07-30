import {
  lstat,
  rename,
  unlink,
} from "node:fs/promises";
import { resolve } from "node:path";

export interface RestoreSwapPaths {
  readonly rollback: string;
  readonly committedOld: string;
  readonly interruptedCandidate: string;
}

export interface RestoreSwapRecovery {
  readonly requiresExistingDatabase: boolean;
  recoverAfterOpenFailure(): Promise<boolean>;
  complete(): Promise<void>;
}

export function restoreSwapPaths(
  liveDatabasePath: string,
): RestoreSwapPaths {
  const live = resolve(liveDatabasePath);
  return {
    rollback: `${live}.restore-rollback`,
    committedOld: `${live}.restore-committed-old`,
    interruptedCandidate:
      `${live}.restore-interrupted-candidate`,
  };
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

async function removeIfPresent(path: string): Promise<void> {
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

type OpenFailureRecovery = () => Promise<readonly string[]>;

function recovery(options: {
  readonly requiresExistingDatabase: boolean;
  readonly cleanupPaths?: readonly string[];
  readonly onOpenFailure?: OpenFailureRecovery;
}): RestoreSwapRecovery {
  let completed = false;
  let cleanupPaths = options.cleanupPaths ?? [];
  let onOpenFailure = options.onOpenFailure;
  return {
    requiresExistingDatabase:
      options.requiresExistingDatabase,
    async recoverAfterOpenFailure() {
      if (onOpenFailure === undefined) return false;
      const recover = onOpenFailure;
      onOpenFailure = undefined;
      cleanupPaths = await recover();
      completed = false;
      return true;
    },
    async complete() {
      if (completed) return;
      for (const path of cleanupPaths) {
        await removeIfPresent(path);
      }
      completed = true;
    },
  };
}

async function moveIfPresent(
  source: string,
  destination: string,
): Promise<void> {
  if (!(await exists(source))) return;
  if (await exists(destination)) {
    throw new Error("RESTORE_SWAP_STATE_CONFLICT");
  }
  await rename(source, destination);
}

export async function recoverInterruptedRestoreSwap(
  liveDatabasePath: string,
): Promise<RestoreSwapRecovery> {
  const live = resolve(liveDatabasePath);
  const paths = restoreSwapPaths(live);
  const liveWal = `${live}-wal`;
  const liveShm = `${live}-shm`;
  const interruptedWal =
    `${paths.interruptedCandidate}-wal`;
  const interruptedShm =
    `${paths.interruptedCandidate}-shm`;
  const [
    liveExists,
    liveWalExists,
    liveShmExists,
    rollbackExists,
    committedOldExists,
    interruptedExists,
    interruptedWalExists,
    interruptedShmExists,
  ] = await Promise.all([
    exists(live),
    exists(liveWal),
    exists(liveShm),
    exists(paths.rollback),
    exists(paths.committedOld),
    exists(paths.interruptedCandidate),
    exists(interruptedWal),
    exists(interruptedShm),
  ]);
  const interruptedArtifactExists =
    interruptedExists ||
    interruptedWalExists ||
    interruptedShmExists;
  if (rollbackExists && committedOldExists) {
    throw new Error("RESTORE_SWAP_STATE_CONFLICT");
  }

  const interruptedArtifacts = [
    paths.interruptedCandidate,
    interruptedWal,
    interruptedShm,
  ] as const;

  if (rollbackExists) {
    if (liveExists && interruptedArtifactExists) {
      throw new Error("RESTORE_SWAP_STATE_CONFLICT");
    }
    if (
      !liveExists &&
      interruptedArtifactExists &&
      !interruptedExists
    ) {
      throw new Error("RESTORE_SWAP_STATE_CONFLICT");
    }
    if (
      liveWalExists && interruptedWalExists ||
      liveShmExists && interruptedShmExists
    ) {
      throw new Error("RESTORE_SWAP_STATE_CONFLICT");
    }
    if (liveExists) {
      await rename(live, paths.interruptedCandidate);
    }
    await moveIfPresent(
      liveWal,
      interruptedWal,
    );
    await moveIfPresent(
      liveShm,
      interruptedShm,
    );
    await rename(paths.rollback, live);
    return recovery({
      requiresExistingDatabase: true,
      cleanupPaths: interruptedArtifacts,
    });
  }

  if (committedOldExists) {
    if (liveExists && interruptedArtifactExists) {
      throw new Error("RESTORE_SWAP_STATE_CONFLICT");
    }
    if (!liveExists && interruptedArtifactExists) {
      if (!interruptedExists) {
        throw new Error("RESTORE_SWAP_STATE_CONFLICT");
      }
      if (
        liveWalExists && interruptedWalExists ||
        liveShmExists && interruptedShmExists
      ) {
        throw new Error("RESTORE_SWAP_STATE_CONFLICT");
      }
      await moveIfPresent(liveWal, interruptedWal);
      await moveIfPresent(liveShm, interruptedShm);
      await rename(paths.committedOld, live);
      return recovery({
        requiresExistingDatabase: true,
        cleanupPaths: interruptedArtifacts,
      });
    }
    if (!liveExists) {
      if (liveWalExists || liveShmExists) {
        throw new Error("RESTORE_SWAP_STATE_CONFLICT");
      }
      await rename(paths.committedOld, live);
      return recovery({ requiresExistingDatabase: true });
    }
    return recovery({
      requiresExistingDatabase: true,
      cleanupPaths: [paths.committedOld],
      async onOpenFailure() {
        await rename(live, paths.interruptedCandidate);
        await moveIfPresent(liveWal, interruptedWal);
        await moveIfPresent(liveShm, interruptedShm);
        await rename(paths.committedOld, live);
        return interruptedArtifacts;
      },
    });
  }

  if (interruptedArtifactExists) {
    if (!liveExists) {
      throw new Error("RESTORE_SWAP_STATE_CONFLICT");
    }
    return recovery({
      requiresExistingDatabase: true,
      cleanupPaths: interruptedArtifacts,
    });
  }

  if (!liveExists && (liveWalExists || liveShmExists)) {
    throw new Error("RESTORE_SWAP_STATE_CONFLICT");
  }

  return recovery({
    requiresExistingDatabase: liveExists,
  });
}
