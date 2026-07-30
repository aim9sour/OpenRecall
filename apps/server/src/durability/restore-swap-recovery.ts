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

function cleanup(paths: readonly string[]): RestoreSwapRecovery {
  let completed = false;
  return {
    async complete() {
      if (completed) return;
      for (const path of paths) {
        await removeIfPresent(path);
      }
      completed = true;
    },
  };
}

const noCleanup = cleanup([]);

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
  const rollbackExists = await exists(paths.rollback);
  const committedOldExists = await exists(paths.committedOld);
  if (rollbackExists && committedOldExists) {
    throw new Error("RESTORE_SWAP_STATE_CONFLICT");
  }

  const interruptedArtifacts = [
    paths.interruptedCandidate,
    `${paths.interruptedCandidate}-wal`,
    `${paths.interruptedCandidate}-shm`,
  ] as const;

  if (rollbackExists) {
    const liveExists = await exists(live);
    const interruptedExists = await exists(
      paths.interruptedCandidate,
    );
    if (liveExists && interruptedExists) {
      throw new Error("RESTORE_SWAP_STATE_CONFLICT");
    }
    if (liveExists) {
      await rename(live, paths.interruptedCandidate);
    }
    await moveIfPresent(
      `${live}-wal`,
      `${paths.interruptedCandidate}-wal`,
    );
    await moveIfPresent(
      `${live}-shm`,
      `${paths.interruptedCandidate}-shm`,
    );
    await rename(paths.rollback, live);
    return cleanup(interruptedArtifacts);
  }

  if (committedOldExists) {
    if (!(await exists(live))) {
      await rename(paths.committedOld, live);
      return noCleanup;
    }
    return cleanup([paths.committedOld]);
  }

  const interruptedArtifactExists =
    await exists(paths.interruptedCandidate) ||
    await exists(`${paths.interruptedCandidate}-wal`) ||
    await exists(`${paths.interruptedCandidate}-shm`);
  if (interruptedArtifactExists) {
    if (!(await exists(live))) {
      throw new Error("RESTORE_SWAP_STATE_CONFLICT");
    }
    return cleanup(interruptedArtifacts);
  }

  return noCleanup;
}
