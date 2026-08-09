# Changelog

All notable changes to OpenRecall will be recorded here. The project is
licensed under Apache-2.0 and follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Changed

- Import previews now show each card's primary optional notes beside its
  question and answer before selection.
- Section statistics, cards, and management are now collapsed by default and
  load their heavy content only when opened.
- End review now finishes the session immediately instead of opening a
  pause-or-finish dialog.

### Fixed

- Learning repetitions that become due during a review now appear immediately
  after the active card instead of waiting behind the original session backlog.

## [1.0.1] - 2026-08-09

### Fixed

- Windows launchers now wait for a healthy local server and then open the
  Windows default browser, without browser-specific executable discovery.
- Section dashboards now derive new, due-now, and next-due values from the
  active scheduler records and refresh when the next due time arrives.
- Starting a non-empty review session now returns the first question directly,
  eliminating a temporary and misleading no-cards state.
- The browser-cached PWA update path is retired. Existing `v1.0.0` service
  workers perform a one-time cache cleanup and unregister; new profiles do not
  register a worker.

## [1.0.0] - 2026-08-01

### Fixed

- A waiting review now performs a one-shot claim at the exact server-relative
  due interval, so a card rejoins without reopening the page even if an SSE
  notification is missed or the browser and server wall clocks differ.
- Rating buttons now format projected intervals in localized minutes, hours,
  days, or 30-day months instead of displaying every interval in minutes.
- Restore responses now wait for staged-upload cleanup, eliminating a race that
  could leave the temporary file visible after the request completed.
- Question, answer, and notes content is normal text instead of arbitrary
  headings. Localized label headings remain available for navigation, while
  automatic review focus announces the card content directly.
- Local verification now has serial `verify` and `verify:full` entry points so
  resource-heavy gates do not create misleading timeout failures by competing
  with one another.

### Added

- Local-only Fastify/React application with Arabic and English interfaces.
- Accessible Chrome/NVDA review flow, continuous due queue, smart presentation
  rotation, dashboard, card and global statistics.
- FSRS-6 scheduling through `ts-fsrs@5.4.1`, versioned replay, scheduler
  controls, per-section fallback, and optimizer training workflow.
- Durable SQLite migrations, idempotent ratings, backups, validated restore,
  production PWA shell, and Windows launch scripts.
- Content-free logs, fixed loopback security boundary, dependency fences, and
  automated unit/property/integration/E2E/accessibility coverage.
- Reproducible dependency-license inventory with a stricter production
  allowlist and Linux/Windows CI enforcement.
- Configurable, validated E2E port-range isolation so a second local checkout
  can run Playwright without stopping an existing OpenRecall development server.
- Apache-2.0 licensing, public contribution and support routes, structured issue
  forms, and private security-reporting guidance.

### Known limitations

- FSRS-7 is unsupported.
- No accounts, cloud sync, collaboration, rich media, Anki packages, or native
  wrapper.
- Code signing is not included in the first release. The downloadable archive
  is protected by a published SHA-256 checksum and GitHub artifact provenance.
