# Run OpenRecall on Windows

OpenRecall is a personal local application. It listens only on `127.0.0.1`
and requires no account or cloud service.

## Prerequisites

- Windows 10 or 11.
- Node.js 24, version 24.18 or newer.
- pnpm 11; the recommended version is 11.17.0.
- Google Chrome, plus NVDA when using a screen reader.

Check the versions in PowerShell:

```powershell
node --version
pnpm --version
```

## Install and build

Open PowerShell in the repository directory and run:

```powershell
pnpm install --frozen-lockfile
pnpm build
```

OpenRecall launch scripts do not download Node.js or pnpm and do not request
administrator privileges.

## Start

From the repository root, run:

```powershell
pnpm start
```

Alternatively, double-click `scripts\start-openrecall.cmd`. The CMD file
delegates to `start-openrecall.ps1`, which verifies Node.js 24 and pnpm 11
and then runs the same start command from the repository root.

After `OPENRECALL_READY` appears, open Chrome at:

`http://127.0.0.1:3210`

If OpenRecall is already running, a second launch prints
`OPENRECALL_ALREADY_RUNNING` and exits successfully. The application never
chooses a surprise port. If another program owns the port, the stable code
`OPENRECALL_PORT_OCCUPIED` is printed; close or reconfigure that program,
then start OpenRecall again.

## Install the PWA in Chrome

Open Chrome's menu and choose to install OpenRecall, or use the install icon
in the address bar. The PWA runs in its own window. Offline mode retains only
the application shell; API responses and card text are not stored in browser
caches. When an update is available, an explicit update action appears, and
an active review session is never reloaded automatically.

## Data and backups

The default data directory is:

`%LOCALAPPDATA%\OpenRecall-nodejs\Data`

The live database is `openrecall.sqlite3`. SQLite backups are stored under
`OpenRecall-nodejs\Data\backups`, and content-free diagnostics are stored
under `OpenRecall-nodejs\Data\logs`. Use the in-application backup and restore
features. Do not edit SQLite files while the server is running.

## Stop and restart

Return to the PowerShell window and press `Ctrl+C`. Wait for the prompt to
return; the server will have stopped SSE sessions and timers, performed a
safe checkpoint, and closed SQLite. Later, restart with `pnpm start` or
`start-openrecall.cmd`.

## Recover from the server-unavailable page

1. Check that the server window is still open.
2. Run `scripts\start-openrecall.cmd` from the repository.
3. Wait for `OPENRECALL_READY`, then activate Retry on the page.
4. If `OPENRECALL_PORT_OCCUPIED` appears, identify the program using port
   3210. Do not delete the database or backup directory.
5. If the problem persists, share only the displayed diagnostic code when
   asking for help; card content and the SQLite file are not required.
