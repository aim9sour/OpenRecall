# SQLite backup and recovery

OpenRecall keeps all user content and scheduling history in one SQLite database.
JSON is an import format for cards, not a backup format.

## Data locations

The application uses `env-paths("OpenRecall")` with its default `-nodejs`
suffix. The data directory is:

| Operating system | Default data directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%\OpenRecall-nodejs\Data` |
| macOS | `~/Library/Application Support/OpenRecall-nodejs` |
| Linux | `$XDG_DATA_HOME/OpenRecall-nodejs`, or `~/.local/share/OpenRecall-nodejs` |

The live database is `openrecall.sqlite3`. Validated automatic snapshots are
under `backups/`; OpenRecall retains the newest ten automatic snapshots.
Temporary restore uploads and candidates are under application-owned working
directories and are removed after the operation.

## Recommended backup

In **Settings → SQLite backup**, choose **Download SQLite backup** and save the
resulting `.sqlite3` file somewhere outside the application data directory.
The server creates it with SQLite's online-backup API, then verifies:

- OpenRecall's application ID and a supported schema version;
- `quick_check=ok`;
- zero foreign-key violations.

The downloaded file is self-contained. The temporary server-side manual
snapshot is removed after the response closes.

Never make a backup by copying `openrecall.sqlite3` while OpenRecall is running,
and never copy or combine a live `-wal` or `-shm` file. A live WAL may contain
committed pages that are not in the main file; copying only part of that set can
silently lose or corrupt data.

## Automatic safety snapshots

OpenRecall creates and validates an automatic snapshot before:

- migrating an existing older supported schema;
- applying or rolling back trained parameter profiles and rebuilt schedules;
- replacing the database during restore.

If snapshot creation or validation fails, the destructive step does not begin.
A restore also validates and migrates a separate candidate copy before entering
maintenance mode. It then stops timers, SSE clients, and optimizer work; closes
SQLite; swaps the complete database; reopens repositories; and rearms the
nearest-due timer. A failed swap restores and reopens the prior database.

The file swap has an explicit, restartable commit protocol beside the live
database:

1. `openrecall.sqlite3.restore-rollback` contains the prior database while a
   replacement is not yet committed.
2. The validated candidate is installed as `openrecall.sqlite3` and reopened.
3. Renaming the rollback file to
   `openrecall.sqlite3.restore-committed-old` is the atomic commit point.
4. The committed-old file is deleted only after the replacement has reopened
   successfully.

Startup checks these exact paths before opening SQLite, so a missing live path
cannot silently become a new empty database during interrupted-restore
recovery. A rollback marker restores the prior database. A committed-old marker
keeps a present, validated replacement, or restores the old database if the
replacement itself is missing. An installed but uncommitted replacement and
its exact `-wal`/`-shm` files are quarantined under
`openrecall.sqlite3.restore-interrupted-candidate` until the restored original
database opens successfully. Conflicting markers fail closed with a stable
startup failure; OpenRecall never enumerates the directory or guesses which
database is current.

## Restore through the application

1. Download a fresh backup of the current database if the application still
   opens.
2. Open **Settings → Restore SQLite backup** and choose exactly one OpenRecall
   `.sqlite3` file.
3. Review the selected filename and replacement warning, select the explicit
   confirmation, then choose **Restore this backup**.
4. Wait for the focused success or failure heading. Do not close the server
   during the operation.
5. After success, verify the expected sections and resume or start review. The
   due service is rebuilt from the restored database.

A corrupt file, another application's database, a schema newer than this
OpenRecall release, a foreign-key failure, or an oversized upload is rejected
without changing current data.

## Non-destructive startup recovery

Startup performs schema, integrity, and foreign-key checks. If startup reports
`OPENRECALL_SERVER_START_FAILED`:

1. Stop every OpenRecall process. Do not repeatedly edit or reopen the database.
2. Rename the entire data directory to a dated recovery name on the same disk.
   This preserves the live database and any sidecars together. Do not delete
   anything.
3. From the preserved directory, copy one self-contained file from `backups/`
   to a separate recovery folder. Do not select the old live database, its
   `-wal`, or its `-shm` as a restore candidate.
4. Start OpenRecall. It creates a new data directory and empty database.
5. Use the in-application restore flow with the copied automatic snapshot.
6. Keep the preserved directory until the restored sections, statistics, active
   session, and next due time have been checked.

If no validated snapshot exists, keep the preserved directory unchanged and
open an issue with the startup output and OpenRecall version. Do not run SQLite
repair commands, reset `user_version`, delete WAL files, or import tables into a
new database: each of those can destroy the evidence needed for recovery.
