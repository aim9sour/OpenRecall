# Changelog

All notable changes to OpenRecall will be recorded here. The project has not
made a public release and currently has no public-use license.

## Unreleased

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

### Known limitations

- FSRS-7 is unsupported.
- No accounts, cloud sync, collaboration, rich media, Anki packages, or native
  wrapper.
- Stable Chrome automation passes on the audited Windows baseline. A signed
  human NVDA speech audit, a fresh Linux run, and repository license selection
  remain release blockers.
