# Database schema and migration policy

OpenRecall uses one SQLite database in WAL mode. The current schema version is
`5`; `PRAGMA application_id` is `1330795587` and `PRAGMA user_version` records
the ordered migration version. Foreign keys, strict tables, a 5000 ms busy
timeout, integrity checks, and application identity prevent silent acceptance
of an unrelated file.

## Table groups

### Content and rotation

- `sections` groups learning material.
- `learning_items` is the scheduling identity and owns active/trashed
  lifecycle.
- `presentations` stores the required primary front/back and optional notes,
  plus any number of variants.
- `presentation_exposures` records smart-rotation history without creating new
  scheduler states.
- `application_settings` stores small version-independent settings.

Deleting a learning item cascades through all of its presentations and
scheduling data. Trashing preserves evidence and excludes the item from due
queues.

### Scheduling and review

- `parameter_profiles` stores official, global, and section FSRS profiles with
  explicit algorithm and adapter versions.
- `scheduler_states` stores due time, memory state, stability, difficulty,
  steps, revision, and the exact parameter source per learning item.
- `review_sessions` and `session_queue_entries` persist the continuous session,
  including waiting and paused states.
- `review_logs` is append-only through the normal review API and records
  evidence: content snapshots, timing, rating, prior/result state, scheduler
  versions, settings, timezone, retrievability, and resulting due time. SQLite
  does not enforce general immutability with triggers; permanent card deletion
  removes the associated history.
- `rating_requests` makes retries idempotent.

### Settings, training, and audit

- `scheduler_setting_scopes` stores one global setting set and optional section
  overrides.
- `optimizer_runs` stores eligibility counts, progress, stable failures,
  metrics, and produced profiles.
- `profile_applications` records snapshot-backed apply/rollback operations and
  is protected by immutable audit triggers.

## Migration rules

Migrations live in `packages/database/src/migrations` and run exactly once in
ascending order. Never edit a migration that has shipped; add the next numbered
migration. Each change needs empty/current/old/future/foreign/corrupt fixtures,
foreign-key validation, interrupted-migration behavior, and repository tests.

Before migrating an existing database, OpenRecall creates and validates an
automatic SQLite backup. Unknown future `user_version` values and mismatched
`application_id` values are rejected. A failed migration must leave the
original database usable or surface a stable recovery diagnostic—never
silently create an empty replacement.

## Backup and restore

Backups use SQLite's online backup mechanism and are validated for identity,
supported schema, integrity, and foreign keys. The manual download is a single
SQLite snapshot; JSON is never a database backup.

Restore stages an upload under an owned random path, validates it before and
after copying, acquires maintenance mode, creates a pre-restore backup, drains
services, and performs an explicit file swap. It then reopens all repositories,
recovers interrupted optimizer runs, and rearms the due timer. Every failure
point has a rollback path to the prior live database. A passive WAL checkpoint
and normal connection close complete graceful shutdown.

## Stored-version compatibility

Review evidence retains algorithm ID/version, adapter version, parameter
profile, settings, timezone, and study-day boundary. Historical replay selects
the matching adapter and rejects unknown versions. FSRS-7 is unsupported; a
future adapter requires explicit state/profile mappings and new migration and
golden-replay evidence.
