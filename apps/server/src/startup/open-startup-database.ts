export interface StartupRestoreRecovery {
  readonly requiresExistingDatabase: boolean;
  recoverAfterOpenFailure(): Promise<boolean>;
}

interface OpenStartupDatabaseOptions<Database> {
  readonly recovery: StartupRestoreRecovery;
  readonly openFresh: () => Promise<Database>;
  readonly openExisting: () => Promise<Database>;
  readonly isValidationFailure: (error: unknown) => boolean;
}

export async function openStartupDatabase<Database>(
  options: OpenStartupDatabaseOptions<Database>,
): Promise<Database> {
  try {
    return await (
      options.recovery.requiresExistingDatabase
        ? options.openExisting()
        : options.openFresh()
    );
  } catch (error) {
    if (
      !options.isValidationFailure(error) ||
      !(await options.recovery.recoverAfterOpenFailure())
    ) {
      throw error;
    }
    return options.openExisting();
  }
}
