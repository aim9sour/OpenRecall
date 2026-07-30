# Architecture overview

OpenRecall is a TypeScript/pnpm monorepo with one local process boundary. Chrome
loads the React PWA from Fastify at `127.0.0.1:3210`; the browser uses only
same-origin API and SSE requests. Fastify is the sole owner of SQLite
connections and mutations.

## Package boundaries

| Package or app | Responsibility |
| --- | --- |
| `contracts` | Versioned TypeBox request, response, and shared data shapes. |
| `i18n` | Typed English, Arabic, and development pseudo-locale messages. |
| `scheduler` | The only runtime package allowed to import `ts-fsrs`; exposes the FSRS-6 adapter and manifest. |
| `optimizer` | Converts append-only review evidence for the native optimizer worker and validates its output. |
| `domain` | Pure import, rotation, time, review, settings, replay, and statistics rules. |
| `database` | SQLite schema, migrations, repositories, atomic ratings, replay, backup, and validation. |
| `server` | Loopback Fastify API, security, SSE, maintenance, restore lifecycle, static production serving, and startup. |
| `web` | Accessible React pages, API client, PWA lifecycle, focus/live-region behavior, and themes. |
| `test-support` | Synthetic fixtures and temporary databases; never production state. |

The scheduler and optimizer packages are adapter boundaries. Other packages do
not import their upstream FSRS implementations directly. Stored records carry
algorithm, algorithm version, adapter version, settings, parameter source,
timezone, and study-day evidence so an upgrade cannot silently relabel history.

## Main data flow

1. The web client obtains locale, database revision, and a CSRF token from the
   bootstrap endpoint.
2. A mutation passes fixed Origin/authority checks and the CSRF token.
3. Domain validation normalizes input and produces content-free stable errors.
4. A database repository runs the mutation in SQLite. Ratings use an
   idempotency key, expected revisions, immutable evidence, and one transaction.
5. The continuous due service queries the nearest actual due time and broadcasts
   a short SSE event. It rearms after every scheduling mutation and lifecycle
   change; it does not invent fixed polling steps.
6. The client invalidates the affected query and places focus according to the
   NVDA contract.

Each learning item owns one scheduler state. Its primary presentation and all
variants are stored separately, but smart rotation selects one presentation at
display time and records exposure without creating another scheduling item.

## Process lifecycle

Startup reserves the fixed port before opening SQLite. An existing compatible
OpenRecall process is reported without touching its database; a foreign owner
returns `OPENRECALL_PORT_OCCUPIED`. After listening, interrupted optimizer work
is recovered before `OPENRECALL_READY`.

Shutdown rejects new work, closes SSE connections, drains in-flight HTTP
requests, stops due and optimizer services, performs
`wal_checkpoint(PASSIVE)`, and closes SQLite. Restore enters maintenance,
validates a staged SQLite file, creates a pre-restore snapshot, stops services,
swaps files, rebuilds every repository, recovers interrupted optimizer work,
and rearms due scheduling. Failed swaps roll back to the previous live file.

## Privacy and runtime dependencies

The application has no telemetry or remote runtime service. Production tests
fence DNS and sockets to the exact loopback destination. Static assets,
translations, icons, the service worker, scheduler, and optimizer integration
ship in the repository/build. The PWA precaches only the application shell;
API responses and card text are network-only and no-store.

## Upgrade gates

Read [the scheduler upgrade protocol](scheduler-upgrades.md) before changing
FSRS packages and [the database schema](database-schema.md) before changing
persistence. FSRS-7 is unsupported until a stable upstream implementation,
new adapter, explicit migrations, replay fixtures, optimizer evaluation, and
the complete release audit all pass.
