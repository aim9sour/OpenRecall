# OpenRecall

[العربية](README.ar.md)

[![CI](https://github.com/aim9sour/OpenRecall/actions/workflows/ci.yml/badge.svg)](https://github.com/aim9sour/OpenRecall/actions/workflows/ci.yml)
[![Windows](https://github.com/aim9sour/OpenRecall/actions/workflows/windows-smoke.yml/badge.svg)](https://github.com/aim9sour/OpenRecall/actions/workflows/windows-smoke.yml)
[![Release](https://img.shields.io/github/v/release/aim9sour/OpenRecall)](https://github.com/aim9sour/OpenRecall/releases/latest)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

OpenRecall is a local-only, private-by-design, keyboard-first spaced-repetition app for
Chrome and NVDA. Cards, history, settings, statistics, and SQLite backups stay
on your computer. There is no account, cloud synchronization, telemetry, or
remote runtime service.

[**Download OpenRecall for Windows**](https://github.com/aim9sour/OpenRecall/releases/latest)

## Run it in two clicks

1. Download `OpenRecall-v1.1.0-windows-x64.zip` from the latest release and
   extract the whole ZIP to a writable folder.
2. Double-click one launcher:
   - `OpenRecall.cmd` keeps data in
     `%LOCALAPPDATA%\OpenRecall-nodejs\Data` (recommended).
   - `OpenRecall-Portable.cmd` keeps data in `Data` beside the launcher.

The release includes its own verified Node.js runtime. You do not need Node,
pnpm, an installer, administrator privileges, or an internet connection. Keep
the terminal window open while studying; close OpenRecall with `Ctrl+C` and
wait for the window to finish so SQLite shuts down cleanly. The launcher waits
for the local server to become healthy, then opens your Windows default browser.

> Normal and portable modes are intentionally separate. Moving the extracted
> folder moves portable data with it; normal data stays in Local App Data.
> OpenRecall never migrates or merges those databases automatically.

![OpenRecall home dashboard in Arabic](docs/assets/openrecall-home.png)

## What makes OpenRecall different

- One scheduler state per learning item, with any number of alternate
  question, answer, and note variants. Smart rotation tests recall instead of
  memorization of one card shape.
- A continuous due queue: a card whose stored due time arrives during a session
  joins that session without fixed-step polling.
- Four FSRS ratings—Again, Hard, Good, and Easy—with readable minute, hour,
  day, or month interval previews.
- Per-section statistics and scheduler overrides, global statistics, optimizer
  training, profile preview/application/rollback, and safe fallbacks.
- Exact-duplicate detection during JSON import, section rename and permanent
  delete, card trash/restore/delete, themes, and RTL/LTR.
- SQLite-only backup and validated restore. JSON is card interchange, not a
  backup format.

![OpenRecall answer and rating view](docs/assets/openrecall-review.png)

## Accessibility contract

Every feature is keyboard usable. In review, focus moves to the plain question
content when a card appears, to the plain answer content when revealed, and to
the next question content after rating. “Question,” “Answer,” and optional
“Notes” are navigable headings; the card content itself is ordinary text, so
automatic speech does not prepend those labels. Live-region announcements are
short and never repeat private card text.

Stable Chrome with NVDA is the primary Windows acceptance target. Automated
axe and Playwright checks complement—not replace—manual Chrome/NVDA acceptance
in Arabic and English. OpenRecall never controls or configures NVDA.

## Import cards

Start with [`examples/cards.valid.json`](examples/cards.valid.json) and read the
[complete format](docs/import/format.md). `front` and `back` are required plain
strings; `notes` and `variants` are optional. Import first shows a preview with
duplicates and exact error paths, then commits only selected valid rows.

## Scheduler and optimizer boundary

The v1 baseline is **FSRS-6** through `ts-fsrs@5.4.1`, with 21 parameters and a
versioned adapter. Optimization uses
`@open-spaced-repetition/binding@0.5.0`. FSRS-7 is unsupported: the architecture
is ready for a future stable upstream adapter, but v1 neither claims nor
emulates experimental FSRS-7 behavior. See the
[scheduler upgrade protocol](docs/architecture/scheduler-upgrades.md).

## Privacy and backup safety

The production server binds only to `http://127.0.0.1:3210`. Security tests
reject outbound DNS and sockets. The browser does not keep an offline runtime
cache; logs use content-free diagnostic codes.

Create a SQLite backup in Settings before risky changes. Never copy only a live
database file while the server is running. Permanent section deletion removes
its current cards, scheduler state, and history immediately, but older full
SQLite backups may still contain it until you delete those backup files.

Detailed Windows behavior and recovery steps are in
[`docs/getting-started/windows-en.md`](docs/getting-started/windows-en.md).

## Build from source

Source development requires Node.js 24.18.x and pnpm 11.17.0:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Wait for `OPENRECALL_READY`, then open `http://127.0.0.1:3210` in Chrome. Use
`pnpm dev` for development and `pnpm verify:full` for the complete sequential
type, license, unit, property, integration, security, build, production-smoke,
accessibility, RTL/LTR, and Playwright gate. Do not run the heavyweight gates
concurrently in one checkout; resource contention can create false timeouts.

## Project resources

- [Architecture](docs/architecture/overview.md)
- [Database and migrations](docs/architecture/database-schema.md)
- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [Licensing decision](docs/decisions/licensing.md)

OpenRecall is licensed under [Apache-2.0](LICENSE). Contributions follow
[`CONTRIBUTING.md`](CONTRIBUTING.md); security reports follow
[`SECURITY.md`](SECURITY.md).

## Known v1 limitations

V1 has no accounts, remote hosting, cloud sync, collaboration, Anki package
import/export, native mobile/desktop wrapper, or rich media. Images, audio,
video, HTML, Markdown, LaTeX, and executable card content are intentionally
unsupported. Experimental FSRS-7 scheduling is also outside v1.
