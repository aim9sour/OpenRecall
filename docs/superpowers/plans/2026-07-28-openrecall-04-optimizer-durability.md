# OpenRecall Optimizer and Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manifest-driven scheduler settings, section/global parameter precedence, isolated optimizer training, safe profile preview/application/rollback, and robust SQLite backup/restore.

**Architecture:** Settings and parameters are separate versioned concepts. The optimizer adapter alone imports the public-testing binding and runs it in a worker with explicit cancellation. Applying parameters rebuilds states into a staged result and swaps them only after a validated backup and revision check. Backup uses SQLite's online API; restore validates and migrates a staged database before a controlled close/swap/reopen sequence.

**Tech Stack:** The Stage 1–3 stack plus `@open-spaced-repetition/binding@0.5.0` and `@fastify/multipart@10.1.0`.

## Global Constraints

- Only `packages/optimizer` may import `@open-spaced-repetition/binding`.
- The 400-example threshold is OpenRecall policy, not an upstream hard minimum.
- Eligible examples are accepted target history prefixes with
  `study_day_delta > 0`; raw reviews and eligible examples are displayed separately.
- Section trained parameters take precedence over global trained parameters,
  then official FSRS-6 defaults.
- Section scheduler-setting overrides take precedence over global settings,
  then adapter defaults.
- Training never applies output automatically.
- Optimizer `timeout` is a progress polling interval, never described as a deadline.
- Cancellation is cooperative through the progress callback and isolated worker boundary.
- Parameter output requires exact length, finite values, compatibility, evaluation,
  preview, confirmation, and a valid pre-application SQLite snapshot.
- Profile application and rollback are replace-on-success operations.
- Backups and restore files are SQLite only; no JSON backup.
- A live WAL database is never copied or renamed without cleanly closing the connection.
- Restore rejects corrupt, foreign-application, and future-schema files before current data changes.

---

### Task 1: Settings and Optimizer Schema Migration

**Files:**
- Create: `packages/database/src/migrations/003-settings-optimizer.ts`
- Create: `packages/database/src/migrations/003-settings-optimizer.test.ts`
- Modify: `packages/database/src/migrate.ts`

**Interfaces:**
- Raises `user_version` from 2 to 3.
- Creates `scheduler_setting_scopes` and `optimizer_runs`.
- Adds immutable profile-application audit records.

- [ ] **Step 1: Write failing migration tests**

Migrate schema-v2 fixtures and assert one global settings row, optional unique
section override, optimizer-run state constraints, profile audit foreign keys,
and successful migration of an existing active review session.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/database/src/migrations/003-settings-optimizer.test.ts`

Expected: FAIL because migration 003 is missing.

- [ ] **Step 3: Add exact settings/optimizer tables**

```sql
CREATE TABLE scheduler_setting_scopes (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global','section')),
  section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
  adapter_version INTEGER NOT NULL,
  settings_json TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK(
    (scope_type = 'global' AND section_id IS NULL) OR
    (scope_type = 'section' AND section_id IS NOT NULL)
  )
) STRICT;

CREATE UNIQUE INDEX ux_scheduler_settings_global
  ON scheduler_setting_scopes(scope_type) WHERE scope_type = 'global';
CREATE UNIQUE INDEX ux_scheduler_settings_section
  ON scheduler_setting_scopes(section_id) WHERE scope_type = 'section';

CREATE TABLE optimizer_runs (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global','section')),
  section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK(status IN ('queued','running','cancelled','failed','succeeded')),
  raw_review_count INTEGER NOT NULL,
  eligible_example_count INTEGER NOT NULL,
  source_review_cutoff_ms INTEGER,
  package_version TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 1),
  result_profile_id TEXT REFERENCES parameter_profiles(id),
  metric_log_loss REAL,
  metric_rmse_bins REAL,
  error_code TEXT,
  created_at_ms INTEGER NOT NULL,
  started_at_ms INTEGER,
  finished_at_ms INTEGER
) STRICT;

CREATE TABLE profile_applications (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES parameter_profiles(id),
  previous_profile_id TEXT NOT NULL REFERENCES parameter_profiles(id),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global','section')),
  section_id TEXT REFERENCES sections(id),
  source_review_cutoff_ms INTEGER,
  backup_filename TEXT NOT NULL,
  applied_at_ms INTEGER NOT NULL
) STRICT;
```

Insert the global default settings JSON from the installed adapter manifest.

- [ ] **Step 4: Verify migration**

Run: `pnpm vitest run packages/database/src/migrations && pnpm check`

Expected: schema versions 1→2→3 and direct 1→3 pass, with `quick_check=ok`.

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/migrations packages/database/src/migrate.ts
git commit -m "feat: persist scheduler settings and optimizer runs"
```

### Task 2: Manifest-Driven Settings and Precedence

**Files:**
- Modify: `packages/scheduler/src/manifest.ts`
- Create: `packages/domain/src/settings/resolve-effective-config.ts`
- Create: `packages/domain/src/settings/resolve-effective-config.test.ts`
- Create: `packages/database/src/settings-repository.ts`
- Create: `packages/database/src/settings-repository.test.ts`
- Create: `packages/contracts/src/settings.ts`

**Interfaces:**
- Produces manifest controls:

```ts
type SchedulerControl =
  | { key: "requestedRetention"; kind: "number"; min: 0.8; max: 0.95; step: 0.01 }
  | { key: "maximumIntervalDays"; kind: "integer"; min: 1; max: 36500 }
  | { key: "enableFuzz"; kind: "boolean" }
  | { key: "enableShortTerm"; kind: "boolean" }
  | { key: "learningStepsMinutes"; kind: "steps"; maxMinutes: 1439 }
  | { key: "relearningStepsMinutes"; kind: "steps"; maxMinutes: 1439 };
```

- Produces:
  `resolveEffectiveConfig(sectionId): { settings, settingsSource, weights, parameterSource }`.

- [ ] **Step 1: Write failing precedence matrix tests**

Cover all combinations:

1. Section settings override global settings.
2. Missing section settings inherit global.
3. Section active profile with at least 400 eligible examples wins.
4. Ineligible section profile falls back to eligible global.
5. Ineligible/missing global falls back to official.
6. Candidate and superseded profiles never become effective.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/domain/src/settings packages/database/src/settings-repository.test.ts`

Expected: FAIL because resolver/repository are missing.

- [ ] **Step 3: Implement manifest controls and validation**

Expose translation keys, value kind, safe bounds, defaults, and deprecation flag
from the adapter. The domain validator uses the manifest plus strict step rules;
the settings page never hard-codes FSRS controls.

- [ ] **Step 4: Implement repository and pure resolver**

Repository returns explicit optional rows. Pure resolver accepts those rows and
manifest defaults, applies the precedence matrix, and returns source metadata
for display/logging.

- [ ] **Step 5: Run and commit**

Run: `pnpm vitest run packages/domain/src/settings packages/database/src/settings-repository.test.ts`

```bash
git add packages/scheduler/src/manifest.ts packages/domain/src/settings packages/database/src/settings-repository* packages/contracts/src/settings.ts
git commit -m "feat: resolve manifest-driven scheduler configuration"
```

### Task 3: Settings API and Accessible Dynamic Form

**Files:**
- Create: `apps/server/src/routes/settings.ts`
- Create: `apps/server/src/routes/settings.test.ts`
- Create: `apps/web/src/pages/SettingsPage.tsx`
- Create: `apps/web/src/settings/SchedulerSettingsForm.tsx`
- Create: `apps/web/src/settings/SchedulerSettingsForm.test.tsx`
- Modify: `apps/web/src/router.tsx`

**Interfaces:**
- Routes:
  `GET /api/v1/settings`,
  `PUT /api/v1/settings/scheduler/global`,
  `PUT /api/v1/settings/scheduler/sections/:sectionId`,
  `DELETE /api/v1/settings/scheduler/sections/:sectionId`.

- [ ] **Step 1: Write failing API tests**

Assert manifest returned with defaults/source, valid update, invalid retention,
malformed steps, section reset-to-inherited, optimistic timestamp conflict, and
no unsupported/deprecated property reaches the adapter.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/server/src/routes/settings.test.ts`

Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement settings routes**

Revalidate values server-side against the current adapter manifest. Store
canonical JSON with adapter version. Return both saved override and resolved
effective configuration.

- [ ] **Step 4: Write failing dynamic-form tests**

Assert labels/descriptions derive from manifest translation keys, number fields
carry min/max/step, step errors link from focusable summary, section inheritance
is stated, and reset removes only the override.

- [ ] **Step 5: Implement settings page**

Render native controls by discriminated `kind`. Show algorithm/package/adapter
versions and parameter/settings sources. Explain workload trade-offs for
retention, that steps are exact sub-day delays, and that saved setting changes
apply to future ratings rather than silently rewriting already stored due
timestamps. Existing due dates change only through the separately previewed
profile replay/application flow.

- [ ] **Step 6: Run and commit**

Run: `pnpm vitest run apps/server/src/routes/settings.test.ts apps/web/src/settings`

```bash
git add apps/server/src/routes/settings* apps/web/src/pages/SettingsPage.tsx apps/web/src/settings apps/web/src/router.tsx
git commit -m "feat: control effective scheduler settings"
```

### Task 4: Optimizer Dataset Adapter

**Files:**
- Create: `packages/optimizer/package.json`
- Create: `packages/optimizer/src/types.ts`
- Create: `packages/optimizer/src/build-training-set.ts`
- Create: `packages/optimizer/src/build-training-set.test.ts`
- Create: `packages/optimizer/src/upgrade-boundary.test.ts`
- Create: `packages/database/src/optimizer-data-repository.ts`
- Create: `packages/database/src/optimizer-data-repository.test.ts`

**Interfaces:**
- Produces:

```ts
export interface OptimizerReview {
  rating: Rating;
  deltaDays: number;
}

export interface OptimizerExample {
  learningItemId: string;
  targetReviewLogId: string;
  reviews: readonly OptimizerReview[];
}

export interface TrainingSetSummary {
  rawReviewCount: number;
  eligibleExampleCount: number;
  sourceReviewCutoffMs: number | null;
  examples: readonly OptimizerExample[];
}
```

- [ ] **Step 1: Write failing prefix-conversion tests**

For one item with deltas `[0,0,1,3]`, assert expanding targets for the third and
fourth reviews only, while the same-day second review remains inside both
historical prefixes. Assert first review never forms a target.

- [ ] **Step 2: Write failing scope/order tests**

Assert global combines item histories without crossing item boundaries, section
scope filters exactly, equal timestamps break by immutable log ID, invalid
rating/delta rows fail with a diagnostic code, and cutoff equals the latest
accepted log timestamp.

- [ ] **Step 3: Run and verify RED**

Run: `pnpm vitest run packages/optimizer/src/build-training-set.test.ts packages/database/src/optimizer-data-repository.test.ts`

Expected: FAIL because adapter/repository are absent.

- [ ] **Step 4: Implement repository and pure prefix builder**

Use stored `study_day_delta` from each immutable log; do not recompute it from
the user's current timezone. Build a new array for every target so no item
shares mutable review buffers.

- [ ] **Step 5: Implement upstream conversion boundary**

Only files under `packages/optimizer` may construct
`FSRSBindingReview(rating, deltaT)` and `FSRSBindingItem(reviews)`. Add a source
scan test that rejects the binding import elsewhere.

- [ ] **Step 6: Run and commit**

Run: `pnpm vitest run packages/optimizer packages/database/src/optimizer-data-repository.test.ts`

```bash
git add packages/optimizer packages/database/src/optimizer-data-repository*
git commit -m "feat: build deterministic optimizer examples"
```

### Task 5: Cancellable Optimizer Worker and Validation

**Files:**
- Create: `packages/optimizer/src/optimizer-worker.ts`
- Create: `packages/optimizer/src/optimizer-client.ts`
- Create: `packages/optimizer/src/validate-output.ts`
- Create: `packages/optimizer/src/optimizer-client.test.ts`
- Create: `packages/optimizer/src/fixtures/sufficient-training-set.ts`

**Interfaces:**
- Produces:

```ts
trainOptimizer(input: {
  examples: readonly OptimizerExample[];
  enableShortTerm: boolean;
  numRelearningSteps: number;
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
}): Promise<{
  weights: readonly number[];
  logLoss: number;
  rmseBins: number;
}>;
```

- [ ] **Step 1: Write failing worker protocol tests**

Assert progress monotonicity/throttling, abort before start, cooperative abort
during training, worker crash rejection, malformed result rejection, exact
21-weight requirement, finite values, and insufficient evaluation data.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/optimizer/src/optimizer-client.test.ts`

Expected: FAIL because worker/client are missing.

- [ ] **Step 3: Implement worker with shared cancellation**

Parent creates `SharedArrayBuffer(4)` and sets `Atomics.store(flag, 0, 1)` on
abort. Worker calls:

```ts
await computeParameters(bindingItems, {
  enableShortTerm,
  numRelearningSteps,
  timeout: 250,
  progress: (fraction) => {
    parentPort?.postMessage({ type: "progress", fraction });
    return Atomics.load(cancelFlag, 0) === 0;
  },
});
```

`timeout: 250` is documented in code as progress polling only.

- [ ] **Step 4: Evaluate and validate**

After training, call `evaluateWithTimeSeriesSplits`; reject `NotEnoughData` as
`OPTIMIZER_EVALUATION_INSUFFICIENT`, never silently activate default-like output.
Validate exact count, finite numbers, serialization round-trip, and scheduler
compatibility.

- [ ] **Step 5: Run and commit**

Run: `pnpm vitest run packages/optimizer`

```bash
git add packages/optimizer/src
git commit -m "feat: train FSRS parameters in a cancellable worker"
```

### Task 6: Training Run Service, API, and UI

**Files:**
- Create: `apps/server/src/optimizer/optimizer-run-service.ts`
- Create: `apps/server/src/optimizer/optimizer-run-service.test.ts`
- Create: `apps/server/src/routes/optimizer.ts`
- Create: `apps/server/src/routes/optimizer.test.ts`
- Create: `apps/web/src/settings/OptimizerPanel.tsx`
- Create: `apps/web/src/settings/OptimizerPanel.test.tsx`

**Interfaces:**
- Routes:
  `GET /api/v1/optimizer/eligibility`,
  `POST /api/v1/optimizer/runs`,
  `GET /api/v1/optimizer/runs/:runId`,
  `POST /api/v1/optimizer/runs/:runId/cancel`.
- Only one optimizer worker may run at a time.

- [ ] **Step 1: Write failing service/API tests**

Assert under-400 rejection with raw/eligible counts, global/section scopes,
single-run conflict, throttled persisted progress, cancellation, crash/failure
codes, successful candidate profile insertion, and no active profile change.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/server/src/optimizer apps/server/src/routes/optimizer.test.ts`

Expected: FAIL because service/routes are absent.

- [ ] **Step 3: Implement run lifecycle**

Create queued row, snapshot cutoff/counts, mark running, launch worker, persist
progress at most once per second, and finish with candidate profile plus metrics.
On restart, convert abandoned `running` rows to failed
`OPTIMIZER_PROCESS_INTERRUPTED`.

- [ ] **Step 4: Write failing UI tests**

Assert raw and eligible counts are distinct, section fallback is explained,
start disabled below 400, progress live announcements occur at most every 10%,
cancel is keyboard accessible, and success says “candidate ready” rather than
“applied.”

- [ ] **Step 5: Implement optimizer panel**

Poll run status with a bounded interval only while a run exists; stop on terminal
state/unmount. Use the existing status live region for coarse progress and keep
full detail visible as text.

- [ ] **Step 6: Run and commit**

Run: `pnpm vitest run apps/server/src/optimizer apps/server/src/routes/optimizer.test.ts apps/web/src/settings/OptimizerPanel.test.tsx`

```bash
git add apps/server/src/optimizer apps/server/src/routes/optimizer* apps/web/src/settings/OptimizerPanel*
git commit -m "feat: manage optimizer training runs"
```

### Task 7: Automatic SQLite Snapshot Foundation

**Files:**
- Create: `packages/database/src/backup-service.ts`
- Create: `packages/database/src/backup-service.test.ts`

**Interfaces:**
- Produces:
  `createBackupService({ db, snapshotDirectory, nowMs }): BackupService`.
- `BackupService.createSnapshot(kind: "manual" | "automatic", reason, signal):
  Promise<Snapshot>`.
- Produces:
  `BackupService.validateSnapshot(path):
  Promise<{ userVersion: number; createdAtMs: number }>`.
- Keeps ten newest automatic snapshots; never deletes a browser-downloaded
  manual file.

- [ ] **Step 1: Write failing snapshot tests**

Assert online backup consistency during a committed rating, correct
application/schema IDs, `quick_check=ok`, zero foreign-key failures, bounded
content-free filenames, application-data-directory containment, cancellation,
and newest-ten automatic retention.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/database/src/backup-service.test.ts`

Expected: FAIL because the snapshot service is absent.

- [ ] **Step 3: Implement the online snapshot service**

Use `db.backup(destination, { progress })`; the progress callback throws an
abort error when `signal.aborted`. Resolve destination beneath the configured
snapshot directory, then open the completed result read-only and verify
`application_id`, supported `user_version`, `quick_check`, and
`foreign_key_check` before returning it.

- [ ] **Step 4: Implement automatic retention**

List only filenames generated and recorded by OpenRecall, sort by recorded
creation time, and delete explicit validated paths beyond the newest ten.
Manual download staging files are handled by their response lifecycle and are
not part of automatic retention.

- [ ] **Step 5: Run and commit**

Run: `pnpm vitest run packages/database/src/backup-service.test.ts`

```bash
git add packages/database/src/backup-service*
git commit -m "feat: create validated automatic SQLite snapshots"
```

### Task 8: Profile Replay, Preview, Application, and Rollback

**Files:**
- Create: `packages/domain/src/replay/replay-history.ts`
- Create: `packages/domain/src/replay/replay-history.test.ts`
- Create: `packages/database/src/profile-application-repository.ts`
- Create: `packages/database/src/profile-application-repository.test.ts`
- Create: `apps/server/src/optimizer/profile-application-service.ts`
- Create: `apps/server/src/optimizer/profile-application-service.test.ts`
- Modify: `apps/server/src/routes/optimizer.ts`
- Create: `apps/web/src/settings/ProfilePreview.tsx`
- Create: `apps/web/src/settings/ProfilePreview.test.tsx`

**Interfaces:**
- Produces:
  `replayHistory(logs, profile, adapter): SchedulerStateV1`.
- Routes:
  `POST /api/v1/optimizer/profiles/:id/preview`,
  `POST /api/v1/optimizer/profiles/:id/apply`,
  `GET /api/v1/optimizer/profiles`,
  `POST /api/v1/optimizer/profiles/:id/rollback`.

- [ ] **Step 1: Write failing deterministic replay tests**

Assert original-profile replay matches stored states exactly, changing current
timezone does not alter replay, per-log captured settings are used, new cards
receive the target profile without fabricated reviews, and corrupt/missing
adapter versions reject safely.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/domain/src/replay`

Expected: FAIL because replay is missing.

- [ ] **Step 3: Implement replay**

Start from `createInitialState(item.createdAtMs)` and apply immutable ratings in
`rated_at_ms, id` order, passing each log's captured timezone/boundary/settings
and target weights. The last replay result supplies exact current due/state.

- [ ] **Step 4: Write failing preview/application tests**

Assert preview counts earlier/later/unchanged due dates and 30-day old/new
workload; application requires matching cutoff/revisions and valid backup;
forced replay/write/reopen errors leave old profile/state active; rollback uses
the identical path.

- [ ] **Step 5: Implement staged replacement**

1. Acquire application maintenance mutex.
2. Create/validate automatic backup through Task 7.
3. Read histories and source state revisions.
4. Replay outside a write transaction. A global application rebuilds only items
   currently inheriting the global profile; active section-profile items remain
   on their section profile.
5. Begin immediate transaction and recheck cutoff/revisions.
6. Write rebuilt rows into a temporary table and verify count/foreign keys.
7. Replace affected scheduler rows, switch profile statuses, insert audit row,
   and commit.
8. Rearm due service and release maintenance mode.

- [ ] **Step 6: Implement preview UI**

Show scope, counts, versions/sources, evaluation metrics, due shift counts, and
two captioned 30-day tables. Confirmation states that schedules will change and
a snapshot will be created. Do not auto-apply.

- [ ] **Step 7: Run and commit**

Run: `pnpm vitest run packages/domain/src/replay packages/database/src/profile-application-repository.test.ts apps/server/src/optimizer/profile-application-service.test.ts apps/web/src/settings/ProfilePreview.test.tsx`

```bash
git add packages/domain/src/replay packages/database/src/profile-application-repository* apps/server/src/optimizer/profile-application-service* apps/server/src/routes/optimizer.ts apps/web/src/settings/ProfilePreview*
git commit -m "feat: preview and atomically apply trained profiles"
```

### Task 9: Manual Backup Route and Pre-Migration Snapshots

**Files:**
- Modify: `packages/database/src/backup-service.ts`
- Modify: `packages/database/src/backup-service.test.ts`
- Create: `apps/server/src/routes/backup.ts`
- Create: `apps/server/src/routes/backup.test.ts`
- Create: `apps/web/src/settings/BackupPanel.tsx`
- Create: `apps/web/src/settings/BackupPanel.test.tsx`
- Modify: `packages/database/src/open-database.ts`
- Modify: `packages/database/src/migrate.ts`
- Create: `packages/database/src/pre-migration-backup.test.ts`

**Interfaces:**
- Route: `POST /api/v1/backup` streams a validated `.sqlite3` download.
- Keeps ten newest automatic snapshots; never deletes manual downloads.

- [ ] **Step 1: Write failing consistency tests**

Extend the Task 7 test by writing ratings while an online backup is progressing,
then open the snapshot and
assert it is internally consistent, has correct application/schema IDs,
`quick_check=ok`, and contains either complete committed transactions, never
partial rows.

- [ ] **Step 2: Write failing retention/path tests**

Assert filenames contain only timestamp/kind/random ID, reside under the
resolved backup directory, eleven automatic snapshots retain newest ten,
manual download temp is removed only after response close, and a symlink/path
escape is rejected.

- [ ] **Step 3: Run and verify RED**

Run: `pnpm vitest run packages/database/src/backup-service.test.ts`

Expected: FAIL because backup service is absent.

- [ ] **Step 4: Integrate pre-migration backup**

Before migrating any existing nonempty OpenRecall database whose supported
`user_version` is below current, create and validate an automatic snapshot using
the old schema connection. A new empty database requires no snapshot. If
snapshot validation fails, do not run migrations.

- [ ] **Step 5: Implement manual route and UI**

POST is CSRF-protected and returns an attachment stream with
`Cache-Control: no-store`. UI uses a native button and announces only
success/failure, never a card-bearing path.

- [ ] **Step 6: Run and commit**

Run: `pnpm vitest run packages/database/src/backup-service.test.ts packages/database/src/pre-migration-backup.test.ts apps/server/src/routes/backup.test.ts apps/web/src/settings/BackupPanel.test.tsx`

```bash
git add packages/database/src/backup-service* packages/database/src/open-database.ts packages/database/src/migrate.ts packages/database/src/pre-migration-backup.test.ts apps/server/src/routes/backup* apps/web/src/settings/BackupPanel*
git commit -m "feat: expose backups and protect migrations"
```

### Task 10: Staged SQLite Restore

**Files:**
- Create: `apps/server/src/durability/maintenance-mode.ts`
- Create: `apps/server/src/durability/restore-service.ts`
- Create: `apps/server/src/durability/restore-service.test.ts`
- Create: `apps/server/src/routes/restore.ts`
- Create: `apps/server/src/routes/restore.test.ts`
- Create: `apps/web/src/settings/RestorePanel.tsx`
- Create: `apps/web/src/settings/RestorePanel.test.tsx`

**Interfaces:**
- Produces:
  `restoreFromUpload(stagedPath, expectedCurrentRevision): Promise<RestoreResult>`.
- Route: `POST /api/v1/restore`, exactly one multipart file, bounded size
  2 GiB, streamed to disk.
- Mutations return `503 MAINTENANCE_MODE` during the swap; read health endpoint
  remains available.

- [ ] **Step 1: Write failing validation tests**

Reject non-SQLite bytes, corrupt database, wrong `application_id`, future
`user_version`, failed foreign keys, multiple files, oversized upload, and an
uploaded filename containing traversal characters. Assert current DB hash and
open connection remain unchanged.

- [ ] **Step 2: Write failing migration/swap recovery tests**

Assert older supported snapshot migrates in a separate candidate, a
pre-restore backup exists, active SSE closes cleanly, due timers stop/rearm,
successful restore reopens with verified PRAGMAs, and simulated Windows rename
or reopen failure restores the rollback file.

- [ ] **Step 3: Run and verify RED**

Run: `pnpm vitest run apps/server/src/durability/restore-service.test.ts`

Expected: FAIL because restore service is absent.

- [ ] **Step 4: Implement staged validation**

Multipart streams to an application-owned random temp path; ignore the client
filename except for display. Open read-only, validate identity/version,
`quick_check`, and `foreign_key_check`. Copy/migrate to a second candidate so
the upload remains untouched.

- [ ] **Step 5: Implement controlled swap**

Acquire maintenance mutex; make validated pre-restore backup; stop wake service
and SSE; close DB so WAL is checkpointed; rename current DB to a random rollback
name; rename candidate to canonical path; reopen and verify connection policy.
On any error, close candidate, restore rollback name, reopen current DB, and
report a stable content-free code. Delete rollback only after successful reopen.

- [ ] **Step 6: Implement confirmation UI**

File input, validation summary, and second confirmation name the selected file
and explain current data replacement/pre-restore snapshot. Disable navigation
during the accepted operation and focus the success/failure heading afterward.

- [ ] **Step 7: Run and commit**

Run: `pnpm vitest run apps/server/src/durability apps/server/src/routes/restore.test.ts apps/web/src/settings/RestorePanel.test.tsx`

```bash
git add apps/server/src/durability apps/server/src/routes/restore* apps/web/src/settings/RestorePanel*
git commit -m "feat: restore validated SQLite databases safely"
```

### Task 11: Optimizer and Durability End-to-End Gate

**Files:**
- Create: `tests/e2e/optimizer-durability.spec.ts`
- Create: `docs/architecture/scheduler-upgrades.md`
- Create: `docs/architecture/database-recovery.md`

**Interfaces:**
- Documents adapter upgrade fixtures and end-user recovery paths.

- [ ] **Step 1: Add optimizer E2E**

Seed over 400 eligible fixture examples, train in a worker, observe progress,
cancel one run, complete another, inspect preview, apply, verify due shifts and
source labels, then roll back.

- [ ] **Step 2: Add backup/restore E2E**

Create a manual snapshot, mutate current data, restore the snapshot through the
browser file input, and verify the earlier data and review session timers return.
Repeat with corrupt/future-schema fixtures and verify no current change.

- [ ] **Step 3: Document upgrade protocol**

Require pinned package review, stable-channel confirmation, upstream changelog,
state mapper changes, golden replay of released fixtures, optimizer evaluation,
migration/backup, and explicit refusal to label FSRS-7 before stable support.

- [ ] **Step 4: Document recovery**

Describe data/automatic-backup locations by OS, manual browser download,
pre-restore backup, startup integrity errors, and non-destructive recovery
steps. Do not instruct users to copy a live WAL file.

- [ ] **Step 5: Run complete Stage 4 verification**

Run:

```bash
pnpm check
pnpm test
pnpm build
pnpm test:e2e --grep "optimizer|backup|restore"
```

Expected: all settings, prefix, worker, replay, application, backup, restore,
accessibility, and E2E tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e docs/architecture
git commit -m "test: verify optimizer and database durability"
```

## Stage 4 Exit Gate

- [ ] Prove raw review count and eligible-example count differ on the same-day
  fixture exactly as documented.
- [ ] Cancel a real optimizer worker and confirm the active profile is unchanged.
- [ ] Force failure at every application/restore stage and confirm current data
  reopens intact.
- [ ] Open every generated snapshot independently and run integrity/foreign-key
  checks.
- [ ] Complete settings/training/backup/restore with keyboard and NVDA in Arabic
  and English.
