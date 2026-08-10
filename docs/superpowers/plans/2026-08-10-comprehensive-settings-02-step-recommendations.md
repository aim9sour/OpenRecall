# Comprehensive Settings Part 2: Learning-Step Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable, accessible wrapper around the binding's official `computeOptimalSteps` tool that analyzes canonical SQLite review history, previews exact and applicable recommendations, and applies or restores scheduler steps only after explicit guarded confirmation.

**Architecture:** A database reader returns complete raw revlog sequences, while an optimizer-owned preparation module validates whole-card histories and computes a deterministic fingerprint without creating CSV on the server thread. The worker alone encodes validated rows into the binding's CSV bytes. A durable service shares Part 1's single-job coordinator, persists immutable inputs and results, and applies settings atomically with fingerprint, settings-revision, and parameter-source guards. The Settings page polls an indeterminate job and keeps statistics out of live regions.

**Tech Stack:** TypeScript 7, React 19, React Router 8, Fastify 5, TypeBox, SQLite via better-sqlite3, Node worker threads and crypto, `@open-spaced-repetition/binding@0.5.0`, Vitest, Playwright, axe-core, pnpm 11.

## Global Constraints

- Complete and verify `2026-08-10-comprehensive-settings-01-optimizer-training.md` first.
- Use the installed stable `computeOptimalSteps` from `@open-spaced-repetition/binding@0.5.0`.
- Use the effective requested retention and complete effective 21-weight parameter profile; do not expose decay or weights as editable fields.
- Require valid card ID, timestamp, rating 1–4, prior memory state, non-null duration, and strictly increasing sequence order.
- Exclude an entire learning-item sequence when one of its rows is invalid; never repair adjacent history speculatively.
- Compute a SHA-256 fingerprint over every canonical source row in scope, including rows later excluded from analysis, so insertion, update, or deletion makes a result stale.
- Keep CSV bytes inside the optimizer worker; never write them to disk, send them to the browser, or add them to backup formats.
- Treat 100 usable samples per upstream rating group as the recommendation threshold, while allowing valid statistics-only and no-recommendation results.
- The binding returns seconds; OpenRecall stores whole-minute steps. For recommendations of at least 60 seconds, save `floor(seconds / 60)`, then sort and deduplicate. Display but do not auto-apply recommendations below 60 seconds.
- Never apply recommendations automatically or bulk-reschedule existing due dates.
- Permit applying learning, relearning, or both portions after a final old/new preview.
- Restore prior steps only if current settings still equal the values applied by that recommendation run.
- Training and step analysis share one CPU-heavy job coordinator.
- All durable state remains in SQLite and whole-database backup.
- Do not inspect or control the user's installed NVDA.
- The primary agent implements; independent agents may review only.
- Use test-driven development and commit after each task.

## File structure

### Create

- `packages/contracts/src/step-recommendations.ts` — run, result, statistics, apply, restore, and API schemas.
- `packages/database/src/migrations/008-step-recommendations.ts` — durable run/result/application table.
- `packages/database/src/migrations/008-step-recommendations.test.ts` — constraints, cascade, recovery, and backup tests.
- `packages/database/src/step-recommendation-repository.ts` — run persistence, guarded application audit, and recovery writes.
- `packages/database/src/step-recommendation-repository.test.ts` — lifecycle and atomic apply/restore repository tests.
- `packages/optimizer/src/prepare-step-recommendation.ts` — sequence validation, exclusion reporting, fingerprinting, CSV encoding, and minute conversion.
- `packages/optimizer/src/prepare-step-recommendation.test.ts` — canonicalization, invalid-sequence, fingerprint, CSV, and rounding tests.
- `packages/optimizer/src/step-recommendation-client.ts` — worker lifecycle, result validation, and cancellation.
- `packages/optimizer/src/step-recommendation-client.test.ts` — message, abort, crash, and output validation tests.
- `packages/optimizer/src/step-recommendation-worker.ts` — only direct `computeOptimalSteps` call.
- `packages/optimizer/src/step-recommendation-binding.test.ts` — real binding threshold and result smoke tests.
- `apps/server/src/optimizer/step-recommendation-service.ts` — durable job lifecycle, stale guards, application, restore, and recovery.
- `apps/server/src/optimizer/step-recommendation-service.test.ts` — service-level lifecycle and transaction tests.
- `apps/web/src/settings/StepRecommendationPanel.tsx` — analyze, cancel, results, preview, apply, and restore UI.
- `apps/web/src/settings/StepRecommendationPanel.test.tsx` — accessibility and state-machine tests.

### Modify

- `packages/contracts/src/index.ts`
- `packages/contracts/src/contracts.test.ts`
- `packages/optimizer/src/types.ts`
- `packages/optimizer/src/index.ts`
- `packages/optimizer/src/upgrade-boundary.test.ts`
- `packages/database/src/constants.ts`
- `packages/database/src/migrate.ts`
- `packages/database/src/index.ts`
- `packages/database/src/optimizer-data-repository.ts`
- `packages/database/src/optimizer-data-repository.test.ts`
- `packages/database/src/settings-repository.ts`
- `packages/database/src/settings-repository.test.ts`
- `packages/database/src/backup-service.test.ts`
- `apps/server/src/routes/optimizer.ts`
- `apps/server/src/routes/optimizer.test.ts`
- `apps/server/src/app.ts`
- `apps/server/src/app.test.ts`
- `apps/server/src/routes/sections.test.ts`
- `apps/web/src/pages/SettingsPage.tsx`
- `apps/web/src/pages/SettingsPage.test.tsx`
- `apps/web/src/router.tsx`
- `packages/i18n/src/catalog-keys.ts`
- `packages/i18n/src/locales/ar.ts`
- `packages/i18n/src/locales/en.ts`
- `apps/web/src/styles/layout.css`
- `tests/e2e/optimizer-durability.spec.ts`
- `tests/e2e/visual-accessibility.spec.ts`
- `docs/architecture/scheduler-upgrades.md`

---

### Task 1: Step-recommendation contracts and durable schema

**Files:**
- Create: `packages/contracts/src/step-recommendations.ts`
- Create: `packages/database/src/migrations/008-step-recommendations.ts`
- Create: `packages/database/src/migrations/008-step-recommendations.test.ts`
- Create: `packages/database/src/step-recommendation-repository.ts`
- Create: `packages/database/src/step-recommendation-repository.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Modify: `packages/database/src/constants.ts`
- Modify: `packages/database/src/migrate.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/database/src/backup-service.test.ts`

**Interfaces:**
- Produces: `StepRecommendationRun`, `StepRecommendationInputSnapshot`, `StepRecommendationResult`, `StepRatingStatistics`, `StepRecommendationApply`, and `StepRecommendationRestore` contracts.
- Produces: schema version 8 and `StepRecommendationRepository` lifecycle methods.
- Consumes: Part 1 `OptimizerScope`, `SchedulerSettings`, and parameter-profile concepts.

- [ ] **Step 1: Write failing contract and migration tests**

Require closed request objects, run status transitions, 64-character fingerprints, result JSON only on success, section cascade, and immutable input snapshot:

```ts
expect(Value.Check(StepRecommendationApplySchema, {
  parts: ["learning", "relearning"],
  revisionToken: "a".repeat(64),
})).toBe(true);
expect(Value.Check(StepRecommendationApplySchema, {
  parts: ["weights"],
  revisionToken: "a".repeat(64),
})).toBe(false);
```

Migration tests must insert a valid section run, reject a global run with a section ID, reject malformed JSON/fingerprint/status, delete section-scoped rows with the section, and keep global rows.

- [ ] **Step 2: Run focused tests and observe missing schema**

```bash
pnpm exec vitest run packages/contracts/src/contracts.test.ts packages/database/src/migrations/008-step-recommendations.test.ts packages/database/src/step-recommendation-repository.test.ts
```

Expected: FAIL because contracts, migration, and repository are missing.

- [ ] **Step 3: Define the closed contracts**

Create schemas with explicit nullable fields. The run shape includes:

```ts
export const StepRecommendationRunSchema = Type.Object({
  id: UuidSchema,
  scope: OptimizerScopeSchema,
  status: StepRecommendationRunStatusSchema,
  sourceReviewCutoffMs: Type.Union([EpochMillisecondsSchema, Type.Null()]),
  sourceFingerprint: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  revisionToken: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  inputSnapshot: StepRecommendationInputSnapshotSchema,
  result: Type.Union([StepRecommendationResultSchema, Type.Null()]),
  errorCode: Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()]),
  createdAtMs: EpochMillisecondsSchema,
  startedAtMs: Type.Union([EpochMillisecondsSchema, Type.Null()]),
  finishedAtMs: Type.Union([EpochMillisecondsSchema, Type.Null()]),
}, { additionalProperties: false });
```

`parts` is a unique non-empty array of `learning | relearning` and application
requires the run's opaque 64-character `revisionToken`. Restore accepts only
that token. The result stores raw seconds, applicable minute lists, per-group
stats, exclusions, and reasons any raw recommendation is not applicable.

- [ ] **Step 4: Add migration 8**

Create a durable table:

```sql
CREATE TABLE step_recommendation_runs (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global','section')),
  section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('queued','running','cancelled','failed','succeeded')),
  source_review_cutoff_ms INTEGER CHECK(source_review_cutoff_ms IS NULL OR source_review_cutoff_ms >= 0),
  source_fingerprint TEXT NOT NULL CHECK(length(source_fingerprint) = 64),
  revision_token TEXT NOT NULL CHECK(length(revision_token) = 64),
  input_snapshot_json TEXT NOT NULL CHECK(json_valid(input_snapshot_json)),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  error_code TEXT,
  applied_parts_json TEXT CHECK(applied_parts_json IS NULL OR json_valid(applied_parts_json)),
  prior_steps_json TEXT CHECK(prior_steps_json IS NULL OR json_valid(prior_steps_json)),
  applied_steps_json TEXT CHECK(applied_steps_json IS NULL OR json_valid(applied_steps_json)),
  applied_at_ms INTEGER CHECK(applied_at_ms IS NULL OR applied_at_ms >= 0),
  restored_at_ms INTEGER CHECK(restored_at_ms IS NULL OR restored_at_ms >= 0),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
  started_at_ms INTEGER CHECK(started_at_ms IS NULL OR started_at_ms >= created_at_ms),
  finished_at_ms INTEGER CHECK(finished_at_ms IS NULL OR finished_at_ms >= started_at_ms),
  CHECK((scope_type = 'global' AND section_id IS NULL) OR (scope_type = 'section' AND section_id IS NOT NULL))
) STRICT;
CREATE INDEX idx_step_recommendation_scope_created
  ON step_recommendation_runs(scope_type, section_id, created_at_ms DESC, id);
CREATE INDEX idx_step_recommendation_status
  ON step_recommendation_runs(status, created_at_ms, id);
```

Bump `SCHEMA_VERSION` to 8 and register the migration after version 7.

- [ ] **Step 5: Implement strict row mapping and lifecycle writes**

`StepRecommendationRepository` must provide:

```ts
insertRunning(input: InsertStepRecommendationRun): StepRecommendationRun;
get(runId: string): StepRecommendationRun | null;
markSucceeded(runId: string, result: StepRecommendationResult, finishedAtMs: number): void;
markFailed(runId: string, errorCode: string, finishedAtMs: number): void;
markCancelled(runId: string, finishedAtMs: number): void;
recoverInterrupted(finishedAtMs: number): number;
recordApplication(input: RecordStepApplication): void;
recordRestore(runId: string, restoredAtMs: number): void;
```

`recordApplication` and `recordRestore` accept the expected current token,
write the newly generated token in the same transaction as their audit fields,
and return the updated run. Token mismatch is a no-op conflict, never a partial
write. Generate each token by SHA-256 hashing an unambiguous length-prefixed
tuple containing the run ID, lifecycle state/version, source fingerprint,
selected-scope and effective-source revisions, and parameter profile ID. The
token is opaque to API clients and cannot be supplied as analysis input.

Validate every parsed JSON object with contract/optimizer validators and throw `STEP_RECOMMENDATION_PERSISTED_INVALID` on corruption.

- [ ] **Step 6: Prove backup and restore**

Extend `backup-service.test.ts` to insert a succeeded result and application audit, snapshot the database, reopen it, and compare exact JSON and status values.

- [ ] **Step 7: Run focused tests and checks**

```bash
pnpm exec vitest run packages/contracts/src packages/database/src/migrations/008-step-recommendations.test.ts packages/database/src/step-recommendation-repository.test.ts packages/database/src/backup-service.test.ts
pnpm --filter @openrecall/contracts check
pnpm --filter @openrecall/database check
```

Expected: PASS.

- [ ] **Step 8: Commit durable contracts**

```bash
git add packages/contracts/src packages/database/src
git commit -m "feat: persist step recommendation runs"
```

### Task 2: Canonical review input, exclusion reporting, and fingerprinting

**Files:**
- Create: `packages/optimizer/src/prepare-step-recommendation.ts`
- Create: `packages/optimizer/src/prepare-step-recommendation.test.ts`
- Modify: `packages/optimizer/src/types.ts`
- Modify: `packages/optimizer/src/index.ts`
- Modify: `packages/database/src/optimizer-data-repository.ts`
- Modify: `packages/database/src/optimizer-data-repository.test.ts`

**Interfaces:**
- Produces: `StoredStepReview`, `PreparedStepRecommendationInput`, `prepareStepRecommendationInput(rows)`, `encodeStepRecommendationCsv(validRows)`, and `convertRecommendedSeconds(seconds)`.
- Consumes: database review log columns and the scheduler memory-state vocabulary.
- Produces: `OptimizerDataRepository.listStepReviewHistory(scope)` returning raw ordered rows without silently discarding invalid data.

- [ ] **Step 1: Write failing preparation and database tests**

Cover exact CSV headers, state mapping, quote escaping, a null duration, invalid prior JSON, duplicate timestamp ordering, full-sequence exclusion, fingerprint changes, and minute conversion:

```ts
expect(convertRecommendedSeconds([80, 5806])).toEqual({
  rawSeconds: [80, 5806],
  applicableMinutes: [1, 96],
  belowResolutionSeconds: [],
});
expect(convertRecommendedSeconds([30, 90, 119])).toEqual({
  rawSeconds: [30, 90, 119],
  applicableMinutes: [1],
  belowResolutionSeconds: [30],
});
```

Require changing any rating, timestamp, duration, state JSON, adding a row, or deleting a row to change the SHA-256 fingerprint.

- [ ] **Step 2: Run focused tests**

```bash
pnpm exec vitest run packages/optimizer/src/prepare-step-recommendation.test.ts packages/database/src/optimizer-data-repository.test.ts
```

Expected: FAIL because the step-history reader and preparation module do not exist.

- [ ] **Step 3: Return complete raw step history from SQLite**

Query exact source fields in deterministic order:

```sql
SELECT
  id AS review_log_id,
  learning_item_id,
  section_id,
  rating,
  rated_at_ms,
  review_duration_ms,
  prior_state_json
FROM review_logs
WHERE @sectionId IS NULL OR section_id = @sectionId
ORDER BY learning_item_id, rated_at_ms, id;
```

Do not parse or discard invalid rows in the repository mapper; the optimizer preparation boundary needs all canonical fields for the fingerprint and exclusion report.

- [ ] **Step 4: Implement canonical fingerprint and sequence validation**

Hash length-prefixed canonical fields to avoid delimiter ambiguity:

```ts
const hash = createHash("sha256");
for (const row of rows) {
  for (const value of canonicalFields(row)) {
    const text = value === null ? "<null>" : String(value);
    hash.update(String(Buffer.byteLength(text))).update(":").update(text).update(";");
  }
}
const sourceFingerprint = hash.digest("hex");
```

Group by learning item after hashing. Parse `prior_state_json`, map `new=0`, `learning=1`, `review=2`, `relearning=3`, require non-null duration and increasing `(ratedAtMs, reviewLogId)`, and exclude the entire group on any error. Return counts by stable reason code.

- [ ] **Step 5: Encode CSV in memory**

Export `encodeStepRecommendationCsv(validRows)` and produce exactly:

```text
card_id,review_time,review_rating,review_state,review_duration
```

Use RFC 4180 quoting for card IDs, UTF-8 `Buffer.from(lines.join("\n"))`, and no filesystem APIs. Include valid rows from valid sequences only. The server calls `prepareStepRecommendationInput` but never calls the encoder; only `step-recommendation-worker.ts` invokes `encodeStepRecommendationCsv`.

- [ ] **Step 6: Implement conservative minute conversion**

For each raw second value:

```ts
if (seconds < 60) belowResolutionSeconds.push(seconds);
else applicableMinutes.add(Math.floor(seconds / 60));
```

Return ascending unique minutes. Never use `Math.round` or `Math.ceil`; never invent a one-minute application for a sub-minute recommendation.

- [ ] **Step 7: Run tests and commit**

```bash
pnpm exec vitest run packages/optimizer/src/prepare-step-recommendation.test.ts packages/database/src/optimizer-data-repository.test.ts
pnpm --filter @openrecall/optimizer check
pnpm --filter @openrecall/database check
git add packages/optimizer/src packages/database/src/optimizer-data-repository.ts packages/database/src/optimizer-data-repository.test.ts
git commit -m "feat: prepare canonical step analysis data"
```

### Task 3: Real binding worker and cancellation client

**Files:**
- Create: `packages/optimizer/src/step-recommendation-worker.ts`
- Create: `packages/optimizer/src/step-recommendation-client.ts`
- Create: `packages/optimizer/src/step-recommendation-client.test.ts`
- Create: `packages/optimizer/src/step-recommendation-binding.test.ts`
- Modify: `packages/optimizer/src/index.ts`
- Modify: `packages/optimizer/src/upgrade-boundary.test.ts`

**Interfaces:**
- Consumes: Task 2 validated `validRows`, desired retention, and 21 effective weights; the worker creates CSV bytes after startup.
- Produces: `computeStepRecommendation(input): Promise<ComputedStepRecommendation>`; the server combines this binding result with Task 2 exclusions and snapshot metadata into the contract-level `StepRecommendationResult`.
- Keeps every binding import in `packages/optimizer`.

- [ ] **Step 1: Write fake-worker lifecycle tests**

Require worker data, successful output validation, abort termination, invalid messages, crash, and nonzero exit mapping:

```ts
const promise = computeStepRecommendation({
  validRows,
  requestedRetention: 0.9,
  weights: [...FSRS6_MANIFEST.defaultWeights],
  signal: controller.signal,
}, { createWorker });
controller.abort();
await expect(promise).rejects.toThrow("STEP_RECOMMENDATION_CANCELLED");
expect(worker.terminate).toHaveBeenCalledOnce();
```

- [ ] **Step 2: Run client tests and observe missing implementation**

```bash
pnpm exec vitest run packages/optimizer/src/step-recommendation-client.test.ts
```

Expected: FAIL because client and worker do not exist.

- [ ] **Step 3: Implement worker input and output validation**

Require a nonempty array of validated step rows, retention strictly between 0 and 1, exactly 21 finite weights, and a `SharedArrayBuffer` cancellation flag. The worker creates and owns the byte buffer, then makes the only binding call:

```ts
const csvBytes = encodeStepRecommendationCsv(data.validRows);
const result = computeOptimalSteps(
  csvBytes,
  data.requestedRetention,
  data.weights,
);
parentPort?.postMessage({
  type: "result",
  result: normalizeStepStats(result),
});
```

Define `ComputedStepRecommendation` in `packages/optimizer/src/types.ts` as
the six optional rating-stat groups plus `learning` and `relearning` objects
containing `rawSeconds`, `applicableMinutes`, and
`belowResolutionSeconds`. `normalizeStepStats` copies finite upstream stats
and calls Task 2's `convertRecommendedSeconds` for both output arrays. Catch
binding exceptions and return `STEP_RECOMMENDATION_ANALYSIS_FAILED`; never
return the CSV in messages. Keep `csvBytes` block-scoped inside the worker's
`run` function so no server or client object retains it.

- [ ] **Step 4: Implement cancellation without fake progress**

The binding call is synchronous, so cancellation sets the flag and terminates the worker after a short grace period. The client exposes no progress callback and maps worker exit after abort to `STEP_RECOMMENDATION_CANCELLED`.

- [ ] **Step 5: Add real binding smoke tests from upstream-supported cases**

Generate 100 two-row learning sequences entirely in memory:

```ts
const buildCsvBuffer = (rows: readonly string[]) => Buffer.from([
  "card_id,review_time,review_rating,review_state,review_duration",
  ...rows,
].join("\n"));
const csv = buildCsvBuffer(Array.from({ length: 100 }, (_, index) => [
  `${index},0,1,0,0`,
  `${index},60000,3,1,0`,
]).flat());
const result = computeOptimalSteps(csv, 0.9, [...FSRS6_MANIFEST.defaultWeights]);
expect(result.again).toMatchObject({ count: 100, retention: 1 });
expect(result.recommendedLearningSteps).toEqual([]);
```

Add a malformed CSV rejection and parameter-array length test. These tests document behavior already covered by upstream and verify the installed native binding.

- [ ] **Step 6: Run optimizer tests and commit**

```bash
pnpm exec vitest run packages/optimizer/src
pnpm --filter @openrecall/optimizer check
git add packages/optimizer/src
git commit -m "feat: run official step recommendations"
```

### Task 4: Durable service, shared conflict boundary, apply, and restore

**Files:**
- Create: `apps/server/src/optimizer/step-recommendation-service.ts`
- Create: `apps/server/src/optimizer/step-recommendation-service.test.ts`
- Modify: `packages/database/src/settings-repository.ts`
- Modify: `packages/database/src/settings-repository.test.ts`
- Modify: `packages/database/src/step-recommendation-repository.ts`
- Modify: `packages/database/src/step-recommendation-repository.test.ts`
- Modify: `apps/server/src/optimizer/optimizer-job-coordinator.test.ts`

**Interfaces:**
- Consumes: Part 1 coordinator, scheduler settings repository, Task 1 run repository, Task 2 data preparation, and Task 3 worker client.
- Produces: `StepRecommendationServiceApi.start`, `get`, `cancel`, `apply`, `restore`, `recoverInterruptedRuns`, `whenIdle`, and `dispose`.
- Produces: atomic guarded scheduler setting updates with application audit.

- [ ] **Step 1: Write service state-machine tests first**

Cover start/success, no recommendation, cancel, crash, restart recovery, training conflict, deletion quiescence, settings staleness, parameter-source staleness, fingerprint staleness, partial application, both application, sub-minute rejection, and guarded restore:

```ts
await expect(service.apply(run.id, {
  parts: ["learning"],
  revisionToken: run.revisionToken,
})).resolves.toMatchObject({ appliedParts: ["learning"] });
expect(settings.resolveEffective(sectionId).settings.learningStepsMinutes).toEqual([1, 96]);
```

Then mutate a non-latest review row and require `STEP_RECOMMENDATION_STALE`, proving fingerprint—not max timestamp—guards application.

- [ ] **Step 2: Run service tests and observe missing lifecycle**

```bash
pnpm exec vitest run apps/server/src/optimizer/step-recommendation-service.test.ts packages/database/src/step-recommendation-repository.test.ts packages/database/src/settings-repository.test.ts apps/server/src/optimizer/optimizer-job-coordinator.test.ts
```

Expected: FAIL because service and atomic application methods do not exist.

- [ ] **Step 3: Resolve and persist the immutable analysis input**

On `start(scope)`:

1. reject blocked/deleted section scope;
2. load all raw rows and prepare valid rows/fingerprint/exclusions without creating CSV;
3. resolve effective scheduler settings and parameter profile;
4. store current steps, requested retention, full weights, profile ID, selected-scope saved-override timestamp, effective settings source and timestamp, versions, counts, and fingerprint;
5. insert running row;
6. acquire the shared coordinator;
7. send only valid structured rows to the worker, which creates CSV internally, and persist the normalized result.

Acquire failure must remove or mark cancelled the just-created row deterministically; prefer acquiring with the known run ID before changing status from queued to running.

- [ ] **Step 4: Add transactional scheduler step application**

Add a `SettingsRepository.saveRecommendedSteps` method that preserves unrelated fields and checks the exact scope revision. Wrap it and `recordApplication` in one outer database transaction:

```ts
const next = {
  ...current.settings,
  ...(parts.includes("learning")
    ? { learningStepsMinutes: result.learning.applicableMinutes }
    : {}),
  ...(parts.includes("relearning")
    ? { relearningStepsMinutes: result.relearning.applicableMinutes }
    : {}),
};
```

Before writing, verify the opaque `revisionToken`, recompute the canonical
fingerprint, compare the selected-scope override timestamp, effective settings
source timestamp, and profile ID, ensure selected result portions have
applicable minutes, and reject stale data with no changes. Generate and return
a new revision token as part of the same database transaction so the
pre-application token cannot be reused. Use the Task 1 length-prefixed hashing
helper with the next lifecycle version; do not hash ambiguous string
concatenation.

- [ ] **Step 5: Implement guarded restore**

Store prior and applied step arrays on first application. Restore only when:

- the run has an application and no prior restore;
- current effective step arrays equal the recorded applied arrays for the applied parts;
- the scope still exists.

Restore only applied portions, preserve all other scheduler fields, require
the post-application revision token, and record `restored_at_ms` plus a new
token atomically. Otherwise throw `STEP_RECOMMENDATION_RESTORE_STALE`.

- [ ] **Step 6: Share conflict, shutdown, and deletion behavior**

Use the Part 1 coordinator so training and analysis cannot overlap. `quiesceForSectionDeletion` called through the existing optimizer service must see and cancel/wait for a step job because both services share the coordinator instance. Add tests for global jobs blocking deletion and a section job for the target section.

- [ ] **Step 7: Run service/database tests and commit**

```bash
pnpm exec vitest run apps/server/src/optimizer packages/database/src/step-recommendation-repository.test.ts packages/database/src/settings-repository.test.ts
pnpm --filter @openrecall/server check
pnpm --filter @openrecall/database check
git add apps/server/src/optimizer packages/database/src/settings-repository.ts packages/database/src/settings-repository.test.ts packages/database/src/step-recommendation-repository.ts packages/database/src/step-recommendation-repository.test.ts
git commit -m "feat: manage step recommendation lifecycle"
```

### Task 5: API routes, server rebuild, and stable errors

**Files:**
- Modify: `apps/server/src/routes/optimizer.ts`
- Modify: `apps/server/src/routes/optimizer.test.ts`
- Modify: `apps/server/src/routes/sections.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/app.test.ts`

**Interfaces:**
- Consumes: Task 4 `StepRecommendationServiceApi`.
- Produces: start/get/cancel/apply/restore HTTP endpoints and recovery after startup/restore swap.

- [ ] **Step 1: Write failing route tests**

Require exact responses for:

```text
POST /api/v1/optimizer/step-recommendations
GET /api/v1/optimizer/step-recommendations/:runId
POST /api/v1/optimizer/step-recommendations/:runId/cancel
POST /api/v1/optimizer/step-recommendations/:runId/apply
POST /api/v1/optimizer/step-recommendations/:runId/restore
```

Cover 202 start/cancel, 200 get/apply/restore, 404 missing section/run, 409 conflict/stale/restore-stale/insufficient applicability, and 400 malformed parts/fingerprint.

- [ ] **Step 2: Run focused route tests**

```bash
pnpm exec vitest run apps/server/src/routes/optimizer.test.ts apps/server/src/routes/sections.test.ts apps/server/src/app.test.ts
```

Expected: FAIL because routes and server service wiring are absent.

- [ ] **Step 3: Register closed-schema endpoints and stable error mapping**

Map service errors without exposing exception text:

```ts
const messageKeyByCode = {
  STEP_RECOMMENDATION_STALE: "optimizer.steps.stale",
  STEP_RECOMMENDATION_NOT_APPLICABLE: "optimizer.steps.notApplicable",
  STEP_RECOMMENDATION_RESTORE_STALE: "optimizer.steps.restoreStale",
  OPTIMIZER_RUN_CONFLICT: "optimizer.runConflict",
} as const;
```

Unknown failures continue through the content-free global error handler.

- [ ] **Step 4: Wire one live service per database**

In `buildServer`, instantiate `StepRecommendationRepository`, `OptimizerDataRepository`, and `StepRecommendationService` with the same `OptimizerJobCoordinator` and live database as training. Rebuild all on restore swap. Extend recovery to mark both training and step runs interrupted. Dispose and await both before connection replacement/shutdown.

- [ ] **Step 5: Preserve section deletion semantics**

Do not add a second independent deletion gate. The existing section deletion route calls the coordinator-backed optimizer quiesce method, which now covers both job kinds. Tests must prove the section is not deleted until analysis settles and no run writes after deletion.

- [ ] **Step 6: Run server tests and commit**

```bash
pnpm exec vitest run apps/server/src/routes/optimizer.test.ts apps/server/src/routes/sections.test.ts apps/server/src/app.test.ts apps/server/src/optimizer
pnpm --filter @openrecall/server check
git add apps/server/src
git commit -m "feat: expose step recommendation API"
```

### Task 6: Accessible recommendation panel and localization

**Files:**
- Create: `apps/web/src/settings/StepRecommendationPanel.tsx`
- Create: `apps/web/src/settings/StepRecommendationPanel.test.tsx`
- Modify: `apps/web/src/pages/SettingsPage.tsx`
- Modify: `apps/web/src/pages/SettingsPage.test.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `packages/i18n/src/catalog-keys.ts`
- Modify: `packages/i18n/src/locales/ar.ts`
- Modify: `packages/i18n/src/locales/en.ts`
- Modify: `apps/web/src/styles/layout.css`

**Interfaces:**
- Consumes: Task 5 endpoints and Part 1 disclosure component.
- Produces: collapsed-by-default analysis, results, explicit preview, partial apply, and guarded restore UI.

- [ ] **Step 1: Write failing component and page tests**

Require:

- panel collapsed by default;
- one "Analyze learning steps" action;
- indeterminate "Analyzing" status with no `<progress>` percentage;
- cancel while active;
- one concise completion live announcement;
- counts and statistics outside the live region;
- current/raw/applicable values;
- disabled apply for sub-minute-only or stale results;
- separate learning, relearning, and both apply actions;
- confirmation showing old and saved minute lists;
- restore only after an application.

```tsx
expect(screen.getByRole("status")).toHaveTextContent("جارٍ التحليل");
expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
expect(screen.getByTestId("step-live")).toHaveTextContent("اكتمل تحليل خطوات التعلم");
expect(screen.getByTestId("step-live")).not.toHaveTextContent("100 عينة");
```

- [ ] **Step 2: Run focused web and catalog tests**

```bash
pnpm exec vitest run apps/web/src/settings/StepRecommendationPanel.test.tsx apps/web/src/pages/SettingsPage.test.tsx packages/i18n/src
```

Expected: FAIL on missing component and translation keys.

- [ ] **Step 3: Implement polling and cancellation**

Follow `OptimizerPanel`'s durable polling pattern but omit percent buckets. Poll active runs at one second, stop on terminal state/unmount, preserve a retryable request error, and announce only start, terminal state, application, and restore transitions.

- [ ] **Step 4: Render exact and applicable results accessibly**

Use headings and `<dl>` blocks for group counts, quartiles, retention, and stability. Format raw durations using seconds below one minute, minutes below one hour, hours below one day, and days thereafter. When raw and saved differ, render both:

```text
Official recommendation: 1 minute 20 seconds
Value OpenRecall can save: 1 minute
```

Do not place the statistics container inside `aria-live`. A below-60-second recommendation states that it cannot be applied automatically at current minute resolution.

- [ ] **Step 5: Add explicit preview, apply, and restore interactions**

Use `ConfirmDialog` with exact old/new lists and selected parts. Send the
opaque revision token returned by the run. On 409 stale, keep results visible,
disable application, and expose "Analyze again". Replace local run state with
the application response so restore uses the new token. After application,
update the page's scheduler settings view so it does not show stale values.
Restore follows the same confirmation and refresh behavior.

- [ ] **Step 6: Add Arabic and English translations**

Include keys for analysis states, sample threshold, group names, excluded reasons, exact versus saved durations, partial/no recommendation, stale, not applicable, apply parts, confirmation, restore, and errors. Keep button names specific so NVDA does not rely on an enclosing group label.

- [ ] **Step 7: Run web tests and commit**

```bash
pnpm exec vitest run apps/web/src/settings/StepRecommendationPanel.test.tsx apps/web/src/pages/SettingsPage.test.tsx packages/i18n/src
pnpm --filter @openrecall/web check
git add apps/web/src packages/i18n/src
git commit -m "feat: add accessible step recommendations"
```

### Task 7: End-to-end behavior, upgrade documentation, and completion gate

**Files:**
- Modify: `tests/e2e/optimizer-durability.spec.ts`
- Modify: `tests/e2e/visual-accessibility.spec.ts`
- Modify: `docs/architecture/scheduler-upgrades.md`
- Modify only regression files required by verified failures.

**Interfaces:**
- Consumes: Tasks 1–6 and all Part 1 work.
- Produces: complete browser proof and release-quality verification.

- [ ] **Step 1: Add deterministic E2E data and failing browser assertions**

Extend the optimizer E2E fixture with at least 100 valid learning pairs in one rating group and a separate malformed/legacy sequence. Assert analysis completes, result counts match, no CSV file appears in the data directory, preview shows raw and applicable values, explicit application updates scheduler settings, and no existing due date changes.

Mutate a non-latest source row directly between analysis and apply and require the UI's stale state, proving the fingerprint guard.

- [ ] **Step 2: Add accessibility E2E assertions**

In Arabic and English:

```ts
await expect(page.getByRole("button", { name: /اقتراح خطوات التعلم/ })).toHaveAttribute("aria-expanded", "false");
await page.getByRole("button", { name: /اقتراح خطوات التعلم/ }).click();
await expect(page.getByRole("button", { name: /تحليل خطوات التعلم/ })).toBeFocused();
expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
```

Verify result statistics are navigable headings/text but absent from the live-region text.

- [ ] **Step 3: Run focused E2E and fix only reproduced failures**

```bash
pnpm exec playwright test tests/e2e/optimizer-durability.spec.ts tests/e2e/visual-accessibility.spec.ts
```

Expected: PASS after implementation fixes; retain a regression test for every accepted defect.

- [ ] **Step 4: Document the optimal-step upgrade boundary**

Add the official input columns, 100-sample group threshold, 12-hour upstream cutoff, maximum two learning/one relearning outputs, full-parameter decay source, and whole-minute conversion policy to `docs/architecture/scheduler-upgrades.md`. State that a future seconds-resolution migration requires a separate approved design.

- [ ] **Step 5: Run the complete verification suite**

```bash
pnpm check
pnpm release:licenses
pnpm test
pnpm build
node scripts/smoke-production.mjs --skip-build
pnpm test:e2e
pnpm test:package
```

Expected: every command exits 0.

- [ ] **Step 6: Run package smoke and repository checks**

```bash
pnpm package:windows
pnpm smoke:package:windows
git diff --check
git status --short
```

Expected: Windows portable/installed smoke exits 0, no whitespace errors, and only intended changes remain. If an external packaging prerequisite is absent, record the exact missing prerequisite and do not claim success.

- [ ] **Step 7: Request independent review**

Invoke `superpowers:requesting-code-review` with the approved spec, both implementation plans, and the full feature commit range. Require review of CSV lifetime, fingerprint completeness, whole-sequence exclusion, seconds-to-minutes transparency, transaction atomicity, stale/restore guards, job coordination, and NVDA announcement noise.

- [ ] **Step 8: Process review rigorously**

Invoke `superpowers:receiving-code-review`, reproduce each actionable finding, add a failing regression test, implement the smallest correction, and rerun focused tests plus `pnpm verify`. Do not accept speculative changes that weaken the approved safety boundaries.

- [ ] **Step 9: Commit accepted review fixes if any**

```bash
git add -A
git commit -m "fix: address step recommendation review"
```

Skip only if the independent review has no accepted changes and the worktree is clean.

## Part 2 completion criteria

- The official binding analyzes only valid complete card sequences from SQLite.
- Every source-row mutation changes the fingerprint and blocks stale application.
- CSV exists only as worker-memory bytes.
- Valid statistics-only and no-recommendation outcomes are not reported as failures.
- Raw seconds and saved minute values are both visible when they differ.
- Sub-minute recommendations cannot be silently rounded or auto-applied.
- Learning, relearning, both, and guarded restore paths are atomic and explicitly confirmed.
- Existing due dates are unchanged by step application.
- Training and step analysis cannot run concurrently.
- Restart, cancellation, deletion, restore swap, and worker crash leave durable truthful states.
- Arabic, English, pseudo-locale, RTL/LTR, keyboard, axe, unit, integration, E2E, production, backup, and Windows package checks pass.
- No automated process touches the user's installed NVDA.
