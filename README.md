# OpenRecall

[العربية](README.ar.md)

OpenRecall is a local-only, keyboard-first spaced-repetition web application
designed for Chrome and NVDA. It keeps sections, cards, review history,
statistics, scheduler settings, and backups on the same computer. The server
binds only to `http://127.0.0.1:3210`; there is no account, cloud
synchronization, telemetry, or remote runtime dependency.

> Release status: this repository currently has no open-source license. See
> [the licensing decision](docs/decisions/licensing.md) before copying,
> distributing, or publishing it.

## What it includes

- Accessible Arabic and English interfaces, RTL/LTR layouts, themes, forced
  colors, reduced motion, and an installable PWA shell.
- Sections, dashboard and card statistics, global statistics, card editing,
  trash/restore/delete, and plain-text JSON import.
- One scheduling state per learning item with any number of alternate
  presentations. Smart rotation changes the wording without treating variants
  as separate cards.
- A continuous due queue: newly due items join the active session at their
  exact stored due time. Server events are backed by a one-shot browser timer,
  with no fixed polling steps.
- Four ratings—Again, Hard, Good, and Easy—through a versioned FSRS adapter,
  with localized minute, hour, day, or month interval previews.
- Global scheduler settings, section overrides, optimizer training, profile
  preview/application/rollback, and safe fallbacks.
- SQLite-only backup and restore. JSON is an interchange format for cards, not
  a backup format.

## Requirements

- Node.js 24.18 or newer within the Node 24 line.
- pnpm 11.17.0.
- Chrome. NVDA is the primary screen-reader acceptance target on Windows.

For detailed Windows instructions, see
[Run OpenRecall on Windows](docs/getting-started/windows-en.md).

## Install and run

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Wait for `OPENRECALL_READY`, then open
`http://127.0.0.1:3210` in Chrome. On Windows you may instead use
`scripts\start-openrecall.cmd`. Stop the server with `Ctrl+C` and wait for the
prompt so active requests drain and SQLite closes cleanly.

For development:

```bash
pnpm dev
```

The development client is at `http://127.0.0.1:5173`; its API still targets the
fixed loopback server.

## Chrome and NVDA accessibility contract

Every feature must be usable from the keyboard. The review view moves focus to
the plain question content when a card appears, to the plain answer content
when revealed, and directly to the next question content after a rating. The
localized “Question,” “Answer,” and optional “Notes” labels are the navigable
headings; card content itself is never a heading. Because focus targets the
plain content, automatic speech does not prepend those heading labels. Queue
and session status use short live-region updates without repeating private
card text.

Automated axe checks are necessary but not sufficient. Changes to critical
flows require a manual stable Chrome/NVDA pass in both Arabic and English.

## JSON card import

Start with [the valid example](examples/cards.valid.json) and read the
[complete import format](docs/import/format.md). `front` and `back` are
required plain strings. `notes` and `variants` are optional; all variants share
the parent learning item’s scheduler state. Import first produces a preview,
including exact error paths, and commits only the selected valid rows.

## Scheduler and optimizer

The released baseline is **FSRS-6** through `ts-fsrs@5.4.1`, with 21
parameters and a versioned adapter. The optimizer binding is
`@open-spaced-repetition/binding@0.5.0`. FSRS-7 is unsupported: the repository
is adapter-ready for a future stable upstream implementation but does not claim
or emulate it. See the
[scheduler upgrade protocol](docs/architecture/scheduler-upgrades.md).

## Privacy, data, and backup

Application traffic is same-origin loopback traffic only. Production security
tests reject outbound DNS and sockets. API responses and card text are excluded
from PWA runtime caches; logs contain stable codes and timings, not card
content.

The default Windows data location is
`%LOCALAPPDATA%\OpenRecall-nodejs\Data`. The live file is
`openrecall.sqlite3`; validated snapshots are under `backups`, and
content-free diagnostics are under `logs`. Download a SQLite backup from
settings before risky changes. Never copy only a live database file while the
server is running.

## Verify a change

```bash
pnpm verify:full
```

The command deliberately runs every resource-heavy gate sequentially. Do not
run `check`, Vitest, builds, smoke tests, or Playwright concurrently in the same
checkout: resource contention can produce misleading timeout failures. Use
`pnpm verify` when only the type/license/unit/build gates are needed. The full
suite covers unit, property, integration, migration, backup/restore, security,
PWA, accessibility, Arabic/LTR behavior, and production startup.

## Architecture and project policies

- [Architecture overview](docs/architecture/overview.md)
- [Database schema and migrations](docs/architecture/database-schema.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [License status](docs/decisions/licensing.md)

## Known v1 limitations

The first release has no accounts, remote hosting, cloud sync, collaboration,
Anki package import/export, native mobile/desktop wrapper, or rich media.
Images, audio, video, HTML, Markdown, LaTeX, and executable card content are
intentionally unsupported. Experimental FSRS-7 scheduling is also outside v1.
