# Run OpenRecall on Windows

OpenRecall is a personal local app. It listens only on `127.0.0.1` and needs
no account or cloud service.

## Recommended: release ZIP

1. Open the [latest release](https://github.com/aim9sour/OpenRecall/releases/latest).
2. Download `OpenRecall-v1.0.1-windows-x64.zip` and extract the complete ZIP to
   a writable folder. Do not run files from inside the compressed preview.
3. Double-click one launcher:
   - `OpenRecall.cmd` uses normal mode.
   - `OpenRecall-Portable.cmd` uses portable mode.

The ZIP includes a verified Node.js runtime, so release users do not install
Node, pnpm, dependencies, or an application service. Neither launcher requests
administrator privileges or downloads anything.

The launcher waits for `http://127.0.0.1:3210` to become healthy, then Windows
opens your default browser. If another program owns port 3210, OpenRecall reports
`OPENRECALL_PORT_OCCUPIED` instead of choosing an unexpected port.

## Choose a data mode

Normal mode stores everything under:

`%LOCALAPPDATA%\OpenRecall-nodejs\Data`

Portable mode stores everything under `Data` beside
`OpenRecall-Portable.cmd`. The extracted folder must remain writable. Moving or
copying that folder also moves or copies the portable database and backups.

The modes are isolated: OpenRecall never copies, merges, or migrates data
between them. Always start the same launcher unless you intentionally want a
separate library. Switching launchers can therefore look like an empty app,
even though the other database is still intact.

## Stop safely

Keep the terminal window open while OpenRecall is running. Press `Ctrl+C` in
that window and wait for it to close. This drains active requests, stops review
events and timers, checkpoints the database, and closes SQLite safely. Start
the same launcher later to continue.

## Back up and move data

Create and download a SQLite backup from Settings before risky changes. Do not
copy only `openrecall.sqlite3` while the server is running. For portable mode,
stop OpenRecall before moving or copying the extracted folder. For normal mode,
use the in-app backup rather than moving Local App Data manually.

Validated snapshots are under `Data\backups`; content-free diagnostic logs are
under `Data\logs`. A full older backup may contain cards that were later
permanently deleted.

## Troubleshooting

- `OPENRECALL_PORT_OCCUPIED`: close the program using port 3210, then retry.
- `OPENRECALL_PORTABLE_DIRECTORY_NOT_WRITABLE`: extract or move the whole ZIP
  to a folder where your account can create files.
- `OPENRECALL_LAUNCHER_FILES_MISSING`: extract the entire ZIP again; do not move
  only the CMD file.
- Server-unavailable page: confirm the terminal is still open, restart the same
  launcher, wait for `OPENRECALL_READY`, then activate Retry.

Share only the displayed diagnostic code when asking for help. A card export,
SQLite database, or other private content is not required.

## Build from source instead

Contributors need Node.js 24.18.x and pnpm 11.17.0:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Wait for `OPENRECALL_READY`, then open `http://127.0.0.1:3210`. The source
launcher `scripts\start-openrecall.cmd` performs version checks; it is separate
from the self-contained release launcher.

## Updating OpenRecall

OpenRecall does not update itself through a browser cache. Download and extract
the newer release ZIP when you choose to upgrade. Normal-mode data remains in
Local App Data. For portable mode, stop OpenRecall and preserve the existing
`Data` folder when replacing application files.
