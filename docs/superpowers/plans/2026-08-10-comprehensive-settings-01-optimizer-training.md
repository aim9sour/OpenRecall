# Comprehensive Settings Part 1: Optimizer Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add curated, versioned, general/per-section optimizer training settings, pass their complete immutable configuration through real FSRS training, and present them in an accessible layered Settings page.

**Architecture:** A new optimizer-owned manifest is the single source of truth for editable choices and official read-only defaults. TypeBox contracts cross the API boundary, a dedicated SQLite repository resolves general and section overrides, and every optimizer run stores the complete effective input snapshot. The web page renders independent disclosure panels and keeps long help text out of each field's automatic screen-reader announcement.

**Tech Stack:** TypeScript 7, React 19, React Router 8, Fastify 5, TypeBox, SQLite via better-sqlite3, `@open-spaced-repetition/binding@0.5.0`, `ts-fsrs@5.4.1`, Vitest, Playwright, axe-core, pnpm 11.

## Global Constraints

- Keep `ts-fsrs` pinned to stable `5.4.1`; do not adopt `6.0.0-beta.1`.
- Keep `@open-spaced-repetition/binding` pinned to stable `0.5.0`; do not adopt `0.6.0-beta.1`.
- Editable epochs are exactly `3 | 5 | 7 | 10`; upstream default is `5`.
- Editable batch sizes are exactly `128 | 256 | 512 | 1024`; upstream default is `512`.
- Editable maximum sequence lengths are exactly `64 | 128 | 256 | 512`; upstream default is `256`.
- Always pass read-only `seed: 2023`, `learningRate: 0.04`, and `gamma: 1.0`.
- Derive `enableShortTerm` and `numRelearningSteps` from effective scheduler settings.
- Do not expose manual editing of the 21 FSRS weights or any callback, timeout, WASI, loader, or CSV-conversion control.
- General settings are the fallback; a section may save or remove one override.
- Settings and immutable optimizer run snapshots live in SQLite and are included by whole-database backup.
- Long setting explanations use user-opened help disclosures; tabbing to a field announces its label and value, not the full explanation.
- Add every user-visible string to Arabic, English, and the generated pseudo-locale contract.
- Do not inspect or control the user's installed NVDA.
- The primary agent performs implementation. Independent agents may review but must not implement.
- Use test-driven development, preserve unrelated worktree changes, and commit after each task.

## File structure

### Create

- `packages/contracts/src/optimizer-settings.ts` — TypeBox request, response, manifest, snapshot, and technical-info contracts.
- `packages/optimizer/src/manifest.ts` — optimizer defaults, editable controls, capability classifications, and version metadata.
- `packages/optimizer/src/validate-settings.ts` — strict runtime validation and full training-config resolution.
- `packages/optimizer/src/manifest.test.ts` — default, choice, classification, and version boundary tests.
- `packages/database/src/migrations/007-optimizer-training-settings.ts` — optimizer settings table and legacy-compatible run snapshot columns.
- `packages/database/src/migrations/007-optimizer-training-settings.test.ts` — migration, constraints, legacy-run, cascade, and backup tests.
- `packages/database/src/optimizer-settings-repository.ts` — persistence, inheritance, optimistic writes, and effective resolution.
- `packages/database/src/optimizer-settings-repository.test.ts` — repository behavior tests.
- `apps/server/src/optimizer/optimizer-job-coordinator.ts` — one shared CPU-heavy optimizer job boundary and section deletion gate.
- `apps/server/src/optimizer/optimizer-job-coordinator.test.ts` — conflict, release, cancellation, and deletion tests.
- `apps/web/src/components/DisclosureSection.tsx` — reusable expanded/collapsed settings disclosure.
- `apps/web/src/components/DisclosureSection.test.tsx` — native button, hidden content, and lazy/non-lazy behavior tests.
- `apps/web/src/settings/SettingHelp.tsx` — field-specific help disclosure that is not auto-described by the input.
- `apps/web/src/settings/SettingHelp.test.tsx` — concise control announcement contract tests.
- `apps/web/src/settings/normalize-localized-number.ts` — Arabic-Indic, Persian, and Latin digit normalization for scheduler numeric fields.
- `apps/web/src/settings/normalize-localized-number.test.ts` — integer and decimal normalization tests.
- `apps/web/src/settings/OptimizerTrainingSettingsForm.tsx` — scoped optimizer settings form and preflight counts.
- `apps/web/src/settings/OptimizerTrainingSettingsForm.test.tsx` — validation, inheritance, help, saving, and preflight tests.
- `apps/web/src/settings/TechnicalSettingsPanel.tsx` — read-only model, package, source, and hidden-default information.
- `apps/web/src/settings/TechnicalSettingsPanel.test.tsx` — read-only and localization tests.

### Modify

- `packages/contracts/src/index.ts`
- `packages/contracts/src/optimizer.ts`
- `packages/contracts/src/contracts.test.ts`
- `packages/optimizer/src/index.ts`
- `packages/optimizer/src/types.ts`
- `packages/optimizer/src/build-training-set.ts`
- `packages/optimizer/src/build-training-set.test.ts`
- `packages/optimizer/src/optimizer-client.ts`
- `packages/optimizer/src/optimizer-client.test.ts`
- `packages/optimizer/src/optimizer-worker.ts`
- `packages/optimizer/src/upgrade-boundary.test.ts`
- `packages/database/src/constants.ts`
- `packages/database/src/migrate.ts`
- `packages/database/src/index.ts`
- `packages/database/src/optimizer-data-repository.ts`
- `packages/database/src/optimizer-data-repository.test.ts`
- `packages/database/src/backup-service.test.ts`
- `apps/server/src/optimizer/optimizer-run-service.ts`
- `apps/server/src/optimizer/optimizer-run-service.test.ts`
- `apps/server/src/routes/settings.ts`
- `apps/server/src/routes/settings.test.ts`
- `apps/server/src/routes/optimizer.ts`
- `apps/server/src/routes/optimizer.test.ts`
- `apps/server/src/app.ts`
- `apps/server/src/app.test.ts`
- `apps/web/src/settings/SchedulerSettingsForm.tsx`
- `apps/web/src/settings/SchedulerSettingsForm.test.tsx`
- `apps/web/src/settings/OptimizerPanel.tsx`
- `apps/web/src/settings/OptimizerPanel.test.tsx`
- `apps/web/src/pages/SettingsPage.tsx`
- `apps/web/src/pages/SettingsPage.test.tsx`
- `apps/web/src/router.tsx`
- `packages/i18n/src/catalog-keys.ts`
- `packages/i18n/src/locales/ar.ts`
- `packages/i18n/src/locales/en.ts`
- `packages/i18n/src/catalog-parity.test.ts`
- `apps/web/src/styles/layout.css`
- `tests/e2e/optimizer-durability.spec.ts`
- `tests/e2e/visual-accessibility.spec.ts`

---

### Task 1: Versioned optimizer manifest and API contracts

**Files:**
- Create: `packages/contracts/src/optimizer-settings.ts`
- Create: `packages/optimizer/src/manifest.ts`
- Create: `packages/optimizer/src/validate-settings.ts`
- Create: `packages/optimizer/src/manifest.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Modify: `packages/optimizer/src/index.ts`
- Modify: `packages/optimizer/src/upgrade-boundary.test.ts`

**Interfaces:**
- Produces: `OptimizerTrainingSettings`, `OptimizerTrainingConfig`, `OptimizerTrainingManifest`, `OptimizerSettingsView`, `OptimizerSettingsMutation`, `OptimizerSettingsReset`, `OptimizerTrainingPreflightRequest`, `OptimizerTrainingPreflight`, `OptimizerRunInputSnapshot`, and `OptimizerTechnicalInfo` contracts.
- Produces: `OPTIMIZER_TRAINING_MANIFEST`, `DEFAULT_OPTIMIZER_TRAINING_SETTINGS`, `OFFICIAL_OPTIMIZER_TRAINING_CONFIG`, `validateOptimizerTrainingSettings(value)`, `validateOptimizerTrainingConfig(value)`, and `resolveOptimizerTrainingConfig(settings)`.
- Consumes: no earlier task; this is the source-of-truth boundary for every later task.

- [ ] **Step 1: Write failing contract and manifest tests**

Add tests that require exact literal choices, reject unknown properties, and prove every binding option is classified:

```ts
expect(OPTIMIZER_TRAINING_MANIFEST.controls).toEqual([
  expect.objectContaining({ key: "numEpochs", choices: [3, 5, 7, 10], defaultValue: 5 }),
  expect.objectContaining({ key: "batchSize", choices: [128, 256, 512, 1024], defaultValue: 512 }),
  expect.objectContaining({ key: "maxSeqLen", choices: [64, 128, 256, 512], defaultValue: 256 }),
]);
expect(OPTIMIZER_TRAINING_MANIFEST.readOnly).toMatchObject({
  seed: 2023,
  learningRate: 0.04,
  gamma: 1,
});
expect(() => validateOptimizerTrainingSettings({
  numEpochs: 100,
  batchSize: 512,
  maxSeqLen: 256,
})).toThrow("OPTIMIZER_TRAINING_SETTINGS_INVALID");
```

- [ ] **Step 2: Run the focused tests and observe the missing exports**

Run:

```bash
pnpm exec vitest run packages/optimizer/src/manifest.test.ts packages/contracts/src/contracts.test.ts
```

Expected: FAIL because the contracts, manifest, and validators do not exist.

- [ ] **Step 3: Define strict TypeBox contracts**

Create `packages/contracts/src/optimizer-settings.ts` with literal unions and closed objects:

```ts
export const OptimizerTrainingSettingsSchema = Type.Object({
  numEpochs: Type.Union([3, 5, 7, 10].map((value) => Type.Literal(value))),
  batchSize: Type.Union([128, 256, 512, 1024].map((value) => Type.Literal(value))),
  maxSeqLen: Type.Union([64, 128, 256, 512].map((value) => Type.Literal(value))),
}, { additionalProperties: false });

export const OptimizerTrainingConfigSchema = Type.Object({
  numEpochs: OptimizerTrainingSettingsSchema.properties.numEpochs,
  batchSize: OptimizerTrainingSettingsSchema.properties.batchSize,
  seed: Type.Literal(2023),
  maxSeqLen: OptimizerTrainingSettingsSchema.properties.maxSeqLen,
  learningRate: Type.Literal(0.04),
  gamma: Type.Literal(1),
}, { additionalProperties: false });
```

Add closed schemas for the manifest controls, saved scope, settings view, mutations, preflight counts, immutable run input snapshot, and technical information. Export the static types from `packages/contracts/src/index.ts`.

- [ ] **Step 4: Implement the optimizer-owned manifest and validator**

Use exact stable version metadata and explicit classification:

```ts
export const OFFICIAL_OPTIMIZER_TRAINING_CONFIG = {
  numEpochs: 5,
  batchSize: 512,
  seed: 2023,
  maxSeqLen: 256,
  learningRate: 0.04,
  gamma: 1,
} as const satisfies OptimizerTrainingConfig;

export function resolveOptimizerTrainingConfig(
  settings: OptimizerTrainingSettings,
): OptimizerTrainingConfig {
  return { ...OFFICIAL_OPTIMIZER_TRAINING_CONFIG, ...settings };
}
```

`validateOptimizerTrainingConfig` checks all six exact values and is used at
the worker boundary. Define `EffectiveOptimizerTrainingSettings` in the
optimizer package as `{ settings, source }`, where source is the same
`global | section | adapter-default` discriminated union exposed by the
settings view.

The capability inventory must list scheduler-model weights, `enableShortTerm`, `numRelearningSteps`, progress, timeout, CSV conversion, WASI loading, binding constructors, evaluation helpers, and SM-2 migration as managed, derived, tool, or internal—not editable settings.

- [ ] **Step 5: Strengthen the upgrade boundary**

In `packages/optimizer/src/upgrade-boundary.test.ts`, import `ComputeParametersOptions` and `TrainingConfig` as types and make a compile-time exact-key assertion:

```ts
type ExpectedTrainingKeys =
  | "numEpochs" | "batchSize" | "seed"
  | "maxSeqLen" | "learningRate" | "gamma";
type UnknownTrainingKeys = Exclude<keyof TrainingConfig, ExpectedTrainingKeys>;
const noUnknownTrainingKeys: UnknownTrainingKeys extends never ? true : never = true;
expect(noUnknownTrainingKeys).toBe(true);
```

Also assert the installed package JSON versions equal the manifest versions so a dependency bump cannot leave stale UI metadata.

- [ ] **Step 6: Run focused tests and typechecking**

Run:

```bash
pnpm exec vitest run packages/optimizer/src/manifest.test.ts packages/optimizer/src/upgrade-boundary.test.ts packages/contracts/src/contracts.test.ts
pnpm --filter @openrecall/contracts check
pnpm --filter @openrecall/optimizer check
```

Expected: all commands PASS.

- [ ] **Step 7: Commit the manifest boundary**

```bash
git add packages/contracts/src/optimizer-settings.ts packages/contracts/src/index.ts packages/contracts/src/contracts.test.ts packages/optimizer/src/manifest.ts packages/optimizer/src/validate-settings.ts packages/optimizer/src/manifest.test.ts packages/optimizer/src/index.ts packages/optimizer/src/upgrade-boundary.test.ts
git commit -m "feat: define optimizer training capabilities"
```

### Task 2: SQLite settings persistence and immutable run snapshots

**Files:**
- Create: `packages/database/src/migrations/007-optimizer-training-settings.ts`
- Create: `packages/database/src/migrations/007-optimizer-training-settings.test.ts`
- Create: `packages/database/src/optimizer-settings-repository.ts`
- Create: `packages/database/src/optimizer-settings-repository.test.ts`
- Modify: `packages/database/src/constants.ts`
- Modify: `packages/database/src/migrate.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/database/src/backup-service.test.ts`

**Interfaces:**
- Consumes: `OptimizerTrainingSettings`, `OptimizerSettingsView`, and Task 1 manifest validation.
- Produces: `OptimizerSettingsRepository.getView(sectionId)`, `resolveEffective(sectionId)`, `saveGlobal`, `saveSection`, and `deleteSection`.
- Produces: schema version 7, `optimizer_setting_scopes`, and nullable legacy-compatible `optimizer_runs.input_snapshot_json`.

- [ ] **Step 1: Write migration and repository tests first**

Require a seeded general row, one override per section, cascade deletion, optimistic conflict handling, and legacy run compatibility:

```ts
expect(repository.resolveEffective(null).settings).toEqual({
  numEpochs: 5,
  batchSize: 512,
  maxSeqLen: 256,
});
repository.saveSection({
  sectionId,
  expectedUpdatedAtMs: null,
  settings: { numEpochs: 7, batchSize: 256, maxSeqLen: 128 },
  nowMs: 10,
});
expect(repository.resolveEffective(sectionId).source.kind).toBe("section");
```

Add a backup test that creates a section override and a run snapshot, creates a SQLite snapshot, opens it read-only, and asserts both values are present.

- [ ] **Step 2: Run tests to verify schema and repository failures**

```bash
pnpm exec vitest run packages/database/src/migrations/007-optimizer-training-settings.test.ts packages/database/src/optimizer-settings-repository.test.ts packages/database/src/backup-service.test.ts
```

Expected: FAIL because schema version 7 and repository are absent.

- [ ] **Step 3: Add migration 7**

Create the settings table and extend runs without invalidating old rows:

```sql
CREATE TABLE optimizer_setting_scopes (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global','section')),
  section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
  adapter_version INTEGER NOT NULL CHECK(adapter_version >= 1),
  settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),
  updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms >= 0),
  CHECK(
    (scope_type = 'global' AND section_id IS NULL) OR
    (scope_type = 'section' AND section_id IS NOT NULL)
  )
) STRICT;
CREATE UNIQUE INDEX ux_optimizer_settings_global
  ON optimizer_setting_scopes(scope_type) WHERE scope_type = 'global';
CREATE UNIQUE INDEX ux_optimizer_settings_section
  ON optimizer_setting_scopes(section_id) WHERE scope_type = 'section';
ALTER TABLE optimizer_runs ADD COLUMN input_snapshot_json TEXT
  CHECK(input_snapshot_json IS NULL OR json_valid(input_snapshot_json));
ALTER TABLE optimizer_runs ADD COLUMN max_sequence_excluded_count INTEGER
  NOT NULL DEFAULT 0 CHECK(max_sequence_excluded_count >= 0);
ALTER TABLE optimizer_runs ADD COLUMN source_review_fingerprint TEXT
  CHECK(source_review_fingerprint IS NULL OR length(source_review_fingerprint) = 64);
```

Seed the general settings row from `DEFAULT_OPTIMIZER_TRAINING_SETTINGS`, bump `SCHEMA_VERSION` to 7, and register the migration after version 6.

- [ ] **Step 4: Implement strict repository mapping and inheritance**

Mirror the scheduler repository's optimistic write semantics but use Task 1 validation:

```ts
resolveEffective(sectionId: string | null): EffectiveOptimizerTrainingSettings {
  const global = this.getGlobal();
  const section = sectionId === null ? null : this.getSection(sectionId);
  const selected = section ?? global;
  return {
    settings: selected?.settings ?? DEFAULT_OPTIMIZER_TRAINING_SETTINGS,
    source: selected === section && section !== null
      ? { kind: "section", settingsId: section.id, updatedAtMs: section.updatedAtMs }
      : global !== null
        ? { kind: "global", settingsId: global.id, updatedAtMs: global.updatedAtMs }
        : { kind: "adapter-default", settingsId: null, updatedAtMs: null },
  };
}
```

Reject a persisted adapter version newer than the current manifest with `OPTIMIZER_SETTINGS_PERSISTED_INCOMPATIBLE`; never clamp JSON.

- [ ] **Step 5: Export the repository and prove backup behavior**

Update `packages/database/src/index.ts`. Extend the whole-database backup test to assert that the new table, run snapshot JSON, and schema version survive snapshot validation and restore-candidate opening.

- [ ] **Step 6: Run focused tests**

```bash
pnpm exec vitest run packages/database/src/migrations/007-optimizer-training-settings.test.ts packages/database/src/optimizer-settings-repository.test.ts packages/database/src/backup-service.test.ts packages/database/src/open-database.test.ts
pnpm --filter @openrecall/database check
```

Expected: PASS, including `PRAGMA quick_check` and foreign-key checks.

- [ ] **Step 7: Commit persistence**

```bash
git add packages/database/src/constants.ts packages/database/src/migrate.ts packages/database/src/index.ts packages/database/src/migrations/007-optimizer-training-settings.ts packages/database/src/migrations/007-optimizer-training-settings.test.ts packages/database/src/optimizer-settings-repository.ts packages/database/src/optimizer-settings-repository.test.ts packages/database/src/backup-service.test.ts
git commit -m "feat: persist optimizer training settings"
```

### Task 3: Training preflight and real binding configuration

**Files:**
- Modify: `packages/optimizer/src/types.ts`
- Modify: `packages/optimizer/src/build-training-set.ts`
- Modify: `packages/optimizer/src/build-training-set.test.ts`
- Modify: `packages/optimizer/src/optimizer-client.ts`
- Modify: `packages/optimizer/src/optimizer-client.test.ts`
- Modify: `packages/optimizer/src/optimizer-worker.ts`
- Modify: `packages/database/src/optimizer-data-repository.ts`
- Modify: `packages/database/src/optimizer-data-repository.test.ts`

**Interfaces:**
- Consumes: Task 1 `OptimizerTrainingConfig` and Task 2 persisted settings.
- Produces: `buildTrainingSet(reviews, { maxSeqLen })` with `preFilterEligibleExampleCount`, `eligibleExampleCount`, and `maxSequenceExcludedCount`.
- Produces: `TrainOptimizerInput.trainingConfig` and `OptimizerWorkerData.trainingConfig` passed unchanged to both binding calls.

- [ ] **Step 1: Write failing max-sequence and worker-option tests**

Add a history with review prefixes of lengths 2, 3, and 4, then require filtering rather than truncation:

```ts
const summary = buildTrainingSet(reviews, { maxSeqLen: 2 });
expect(summary.preFilterEligibleExampleCount).toBe(3);
expect(summary.eligibleExampleCount).toBe(1);
expect(summary.maxSequenceExcludedCount).toBe(2);
expect(summary.examples.every((example) => example.reviews.length <= 2)).toBe(true);
expect(summary.sourceReviewFingerprint).toMatch(/^[0-9a-f]{64}$/);
```

Update the fake worker assertion to require the complete config:

```ts
expect(receivedWorkerData.trainingConfig).toEqual({
  numEpochs: 7,
  batchSize: 256,
  seed: 2023,
  maxSeqLen: 128,
  learningRate: 0.04,
  gamma: 1,
});
```

- [ ] **Step 2: Run focused tests and observe failures**

```bash
pnpm exec vitest run packages/optimizer/src/build-training-set.test.ts packages/optimizer/src/optimizer-client.test.ts packages/database/src/optimizer-data-repository.test.ts
```

Expected: FAIL because the summary and worker data do not carry training configuration.

- [ ] **Step 3: Filter training examples at the OpenRecall boundary**

Extend `TrainingSetSummary` and make `buildTrainingSet` accept an exact maximum:

```ts
const allExamples = buildEligibleExamples(reviews);
const examples = allExamples.filter(
  (example) => example.reviews.length <= options.maxSeqLen,
);
return {
  rawReviewCount: reviews.length,
  preFilterEligibleExampleCount: allExamples.length,
  eligibleExampleCount: examples.length,
  maxSequenceExcludedCount: allExamples.length - examples.length,
  sourceReviewCutoffMs,
  sourceReviewFingerprint: fingerprintOptimizerReviews(reviews),
  examples,
};
```

Keep filtering in the adapter even though fsrs-rs also filters, so preflight and actual worker input cannot disagree.

Implement `fingerprintOptimizerReviews` with SHA-256 over length-prefixed
`reviewLogId`, `learningItemId`, `sectionId`, `rating`, `deltaDays`, and
`ratedAtMs` fields in deterministic repository order. Add tests proving an
insert, deletion, or mutation of any field changes the fingerprint.

- [ ] **Step 4: Pass and validate the complete binding config**

Add `trainingConfig` to client and worker types. In the worker validate via `validateOptimizerTrainingConfig`, then use one shared options object:

```ts
const options = {
  enableShortTerm: data.enableShortTerm,
  numRelearningSteps,
  trainingConfig,
  timeout: 250,
  progress,
};
weights = await computeParameters(items, options);
const evaluation = await evaluateWithTimeSeriesSplits(items, options);
```

The `timeout` comment must continue to identify it as progress polling, not a user deadline.

- [ ] **Step 5: Add a real-binding smoke assertion**

Use the upstream minimal valid item pattern in a focused integration test:

```ts
const item = new FSRSBindingItem([
  new FSRSBindingReview(3, 0),
  new FSRSBindingReview(4, 1),
]);
await expect(computeParameters([item], {
  enableShortTerm: true,
  numRelearningSteps: 1,
  trainingConfig: OFFICIAL_OPTIMIZER_TRAINING_CONFIG,
})).resolves.toHaveLength(21);
```

Keep this test inside `packages/optimizer` so the binding upgrade boundary remains intact. Give it a 180-second Vitest timeout but expect normal completion much sooner.

- [ ] **Step 6: Run optimizer and database tests**

```bash
pnpm exec vitest run packages/optimizer/src packages/database/src/optimizer-data-repository.test.ts
pnpm --filter @openrecall/optimizer check
pnpm --filter @openrecall/database check
```

Expected: PASS with no binding imports outside `packages/optimizer`.

- [ ] **Step 7: Commit the training pipeline**

```bash
git add packages/optimizer/src packages/database/src/optimizer-data-repository.ts packages/database/src/optimizer-data-repository.test.ts
git commit -m "feat: configure optimizer training runs"
```

### Task 4: Server settings, preflight, snapshots, and shared job coordination

**Files:**
- Create: `apps/server/src/optimizer/optimizer-job-coordinator.ts`
- Create: `apps/server/src/optimizer/optimizer-job-coordinator.test.ts`
- Modify: `apps/server/src/optimizer/optimizer-run-service.ts`
- Modify: `apps/server/src/optimizer/optimizer-run-service.test.ts`
- Modify: `apps/server/src/routes/settings.ts`
- Modify: `apps/server/src/routes/settings.test.ts`
- Modify: `apps/server/src/routes/optimizer.ts`
- Modify: `apps/server/src/routes/optimizer.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/app.test.ts`
- Modify: `packages/contracts/src/optimizer.ts`

**Interfaces:**
- Consumes: Task 2 repository and Task 3 preflight/training functions.
- Produces: `OptimizerJobCoordinator.acquire(job): () => void` and `quiesceForSectionDeletion(sectionId): Promise<() => void>`.
- Produces: optimizer settings GET/PUT/DELETE routes, preflight route, and `OptimizerRun.inputSnapshot`.

- [ ] **Step 1: Write failing service and route tests**

Require effective settings resolution, post-filter eligibility, immutable snapshot persistence, route rejection of arbitrary values, and technical information for the effective profile:

```ts
const run = service.startRun({ scopeType: "section", sectionId });
expect(run.inputSnapshot).toMatchObject({
  trainingConfig: {
    numEpochs: 7,
    batchSize: 256,
    seed: 2023,
    maxSeqLen: 128,
    learningRate: 0.04,
    gamma: 1,
  },
  settingsSource: { kind: "section" },
  enableShortTerm: true,
  numRelearningSteps: 1,
});
expect(service.getTechnicalInfo({ scopeType: "section", sectionId })).toMatchObject({
  parameterSource: { kind: "section", profileId: expect.any(String) },
  activeProfile: {
    eligibleExampleCount: expect.any(Number),
    metricLogLoss: expect.any(Number),
    metricRmseBins: expect.any(Number),
  },
});
```

Add route tests for `GET /api/v1/settings/optimizer`, global save, section save/delete, `POST /api/v1/optimizer/preflight`, and a 400 response for `numEpochs: 100`.
Also require `GET /api/v1/settings/technical` to return the exact package,
algorithm, adapter, schema, read-only training defaults, effective parameter
source, and the active profile's eligible count, review cutoff, creation time,
package version, log loss, and RMSE when a trained profile is active. Official
profiles return null metrics rather than invented values.

- [ ] **Step 2: Run focused server tests**

```bash
pnpm exec vitest run apps/server/src/optimizer/optimizer-job-coordinator.test.ts apps/server/src/optimizer/optimizer-run-service.test.ts apps/server/src/routes/settings.test.ts apps/server/src/routes/optimizer.test.ts
```

Expected: FAIL on missing coordinator, routes, and snapshot properties.

- [ ] **Step 3: Implement the coordinator and migrate the run service to it**

The coordinator owns one active job and the section deletion gates:

```ts
export interface OptimizerJobIdentity {
  readonly id: string;
  readonly kind: "training" | "step-recommendation";
  readonly scope: OptimizerScope;
  readonly cancel: () => void;
  readonly settled: Promise<void>;
}

acquire(job: OptimizerJobIdentity): () => void {
  if (this.#active !== null || this.#scopeBlocked(job.scope)) {
    throw new Error("OPTIMIZER_RUN_CONFLICT");
  }
  this.#active = job;
  return () => { if (this.#active?.id === job.id) this.#active = null; };
}
```

Move deletion waiting and conflict decisions out of `OptimizerRunService`; retain its public methods by delegation so section routes do not change behavior.

- [ ] **Step 4: Resolve and persist one immutable context per run**

Before inserting the run, resolve scheduler settings, optimizer settings, full training config, parameter source, and filtered summary. Persist `input_snapshot_json` in the same transaction as the queued/running state. Pass the exact snapshot values to `trainOptimizer`.

Legacy rows with null snapshot map to:

```ts
{
  kind: "legacy-official",
  trainingConfig: OFFICIAL_OPTIMIZER_TRAINING_CONFIG,
  settingsSource: null,
  enableShortTerm: null,
  numRelearningSteps: null,
}
```

Do not fabricate historical scheduler-derived values that were not stored.

Add `OptimizerRunService.getTechnicalInfo(scope)` and query the run whose
`result_profile_id` matches the effective profile ID. Return null metric fields
for the official profile and for legacy profiles without a recorded producing
run.

- [ ] **Step 5: Add settings and preflight routes**

Register exact closed-schema routes:

```ts
server.get<{ Querystring: SettingsQuery }>(
  "/api/v1/settings/optimizer",
  { schema: { querystring: SettingsQuerySchema, response: { 200: OptimizerSettingsViewSchema, 404: ApiErrorSchema } } },
  async (request, reply) => {
    const sectionId = request.query.sectionId ?? null;
    if (sectionId !== null && !ensureSection(sectionId, reply)) return;
    return reply.code(200).send(optimizerSettings.getView(sectionId));
  },
);
server.put<{ Body: OptimizerSettingsMutation }>(
  "/api/v1/settings/optimizer/global",
  { schema: { body: OptimizerSettingsMutationSchema, response: { 200: OptimizerSettingsViewSchema, 400: ApiErrorSchema, 409: ApiErrorSchema } } },
  async (request, reply) => saveGlobalOptimizerSettings(request.body, reply),
);
server.put<{ Params: SectionParams; Body: OptimizerSettingsMutation }>(
  "/api/v1/settings/optimizer/sections/:sectionId",
  { schema: { params: SectionParamsSchema, body: OptimizerSettingsMutationSchema, response: { 200: OptimizerSettingsViewSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema } } },
  async (request, reply) => saveSectionOptimizerSettings(request.params.sectionId, request.body, reply),
);
server.delete<{ Params: SectionParams; Body: OptimizerSettingsReset }>(
  "/api/v1/settings/optimizer/sections/:sectionId",
  { schema: { params: SectionParamsSchema, body: OptimizerSettingsResetSchema, response: { 200: OptimizerSettingsViewSchema, 404: ApiErrorSchema, 409: ApiErrorSchema } } },
  async (request, reply) => deleteSectionOptimizerSettings(request.params.sectionId, request.body, reply),
);
server.post<{ Body: OptimizerTrainingPreflightRequest }>(
  "/api/v1/optimizer/preflight",
  { schema: { body: OptimizerTrainingPreflightRequestSchema, response: { 200: OptimizerTrainingPreflightSchema, 400: ApiErrorSchema, 404: ApiErrorSchema } } },
  async (request, reply) => reply.code(200).send(optimizer.preflight(request.body.scope, request.body.settings)),
);
server.get<{ Querystring: SettingsQuery }>(
  "/api/v1/settings/technical",
  { schema: { querystring: SettingsQuerySchema, response: { 200: OptimizerTechnicalInfoSchema, 404: ApiErrorSchema } } },
  async (request, reply) => {
    const sectionId = request.query.sectionId ?? null;
    if (sectionId !== null && !ensureSection(sectionId, reply)) return;
    return reply.code(200).send(buildOptimizerTechnicalInfo(sectionId));
  },
);
```

Define the four named save/delete helpers in `routes/settings.ts`; each helper
validates manifest choices, passes `expectedUpdatedAtMs` into the repository,
maps `SETTINGS_EDIT_CONFLICT` to 409, and returns a freshly built scoped view.

Use `SETTINGS_EDIT_CONFLICT` for optimistic failures, `SECTION_NOT_FOUND` for missing sections, `VALIDATION_ERROR` for values outside manifest choices, and `OPTIMIZER_INSUFFICIENT_DATA` only when starting a run after post-filter counts are insufficient.

- [ ] **Step 6: Wire dynamic services and startup recovery**

Instantiate one `OptimizerSettingsRepository` and one `OptimizerJobCoordinator` per live database in `rebuildServices`. Inject both into the run service and relevant routes so restore swaps rebuild them against the new connection. Keep interrupted-run recovery after database replacement.

- [ ] **Step 7: Run server and contract tests**

```bash
pnpm exec vitest run apps/server/src/optimizer apps/server/src/routes/settings.test.ts apps/server/src/routes/optimizer.test.ts apps/server/src/app.test.ts packages/contracts/src
pnpm --filter @openrecall/server check
```

Expected: PASS, including restore-service rebuild coverage.

- [ ] **Step 8: Commit the server boundary**

```bash
git add apps/server/src packages/contracts/src/optimizer.ts
git commit -m "feat: expose optimizer training settings"
```

### Task 5: Accessible layered Settings page

**Files:**
- Create: `apps/web/src/components/DisclosureSection.tsx`
- Create: `apps/web/src/components/DisclosureSection.test.tsx`
- Create: `apps/web/src/settings/SettingHelp.tsx`
- Create: `apps/web/src/settings/SettingHelp.test.tsx`
- Create: `apps/web/src/settings/normalize-localized-number.ts`
- Create: `apps/web/src/settings/normalize-localized-number.test.ts`
- Create: `apps/web/src/settings/OptimizerTrainingSettingsForm.tsx`
- Create: `apps/web/src/settings/OptimizerTrainingSettingsForm.test.tsx`
- Create: `apps/web/src/settings/TechnicalSettingsPanel.tsx`
- Create: `apps/web/src/settings/TechnicalSettingsPanel.test.tsx`
- Modify: `apps/web/src/settings/SchedulerSettingsForm.tsx`
- Modify: `apps/web/src/settings/SchedulerSettingsForm.test.tsx`
- Modify: `apps/web/src/settings/OptimizerPanel.tsx`
- Modify: `apps/web/src/settings/OptimizerPanel.test.tsx`
- Modify: `apps/web/src/pages/SettingsPage.tsx`
- Modify: `apps/web/src/pages/SettingsPage.test.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/styles/layout.css`

**Interfaces:**
- Consumes: Task 4 API views and preflight endpoint.
- Produces: one Settings page with scheduler expanded, advanced training collapsed, and technical information collapsed.
- Produces: `onDirtyChange(panelId, dirty)` contract used to guard scope navigation.

- [ ] **Step 1: Write disclosure, help, form, and route-loader tests first**

Require native disclosure state, no long automatic description, isolated
manifest incompatibility, and localized numeric input:

```tsx
render(<SettingHelp id="retention-help" label="شرح معدل الاحتفاظ">الوصف الطويل</SettingHelp>);
expect(screen.getByRole("button", { name: "شرح معدل الاحتفاظ" })).toHaveAttribute("aria-expanded", "false");
expect(screen.getByText("الوصف الطويل")).not.toBeVisible();
expect(screen.getByLabelText("معدل الاحتفاظ المطلوب")).not.toHaveAttribute("aria-describedby", "retention-help");
expect(normalizeLocalizedNumber("٠٫٩٢")).toBe("0.92");
expect(normalizeLocalizedNumber("۱۲۸")).toBe("128");
```

Require three select controls with only manifest choices, independent save, section inheritance removal, preflight excluded count, and preserved drafts after a 409 conflict.

- [ ] **Step 2: Run focused web tests**

```bash
pnpm exec vitest run apps/web/src/components/DisclosureSection.test.tsx apps/web/src/settings/SettingHelp.test.tsx apps/web/src/settings/OptimizerTrainingSettingsForm.test.tsx apps/web/src/settings/TechnicalSettingsPanel.test.tsx apps/web/src/settings/SchedulerSettingsForm.test.tsx apps/web/src/pages/SettingsPage.test.tsx
```

Expected: FAIL because the new components and loader data are missing.

- [ ] **Step 3: Implement native disclosures and field help**

`DisclosureSection` accepts `defaultExpanded` and renders its children immediately when expanded or after first opening when collapsed. `SettingHelp` uses `<details>` and a specific summary:

```tsx
export function SettingHelp({ label, children }: Props) {
  return (
    <details className="setting-help">
      <summary>{label}</summary>
      <div>{children}</div>
    </details>
  );
}
```

Do not add the help ID to the setting control. Keep error association separate through `aria-invalid` and `aria-errormessage`.

Implement `normalizeLocalizedNumber` by translating Arabic-Indic `٠`–`٩`
and Persian `۰`–`۹` to ASCII and translating the Arabic decimal separator `٫`
to `.`. Do not accept grouping separators in numeric settings. Use this helper
before `Number(...)` in `SchedulerSettingsForm`.

- [ ] **Step 4: Implement the optimizer settings form**

Initialize from `savedOverride?.settings ?? effective.settings`. Render selects from `view.manifest.controls`, call preflight when the panel opens and whenever a saved value becomes effective, and provide an explicit refresh for unsaved draft preflight.

Save to the global or section route with expected timestamps. Section actions must distinguish:

- "Use general optimizer settings" — DELETE the section row;
- "Restore official optimizer defaults" — save `5`, `512`, and `256` in the selected scope.

Emit `onDirtyChange("optimizer-training", dirty)` by comparing the canonical draft with the loaded baseline.

- [ ] **Step 5: Refine scheduler help and scope navigation**

Replace long `aria-describedby` field descriptions with `SettingHelp`, retaining only format errors through `aria-errormessage`. Add `onDirtyChange("scheduler", dirty)`.

In `SettingsPage`, replace the GET form with local scope selection and `useNavigate`. When any panel is dirty, open the existing `ConfirmDialog`; only confirmed navigation changes `?sectionId=`. A rejected confirmation leaves route and drafts unchanged.

- [ ] **Step 6: Load and render technical information**

Extend the settings loader to request optimizer settings and `/api/v1/settings/technical` in the existing `Promise.all`. Render package versions, algorithm/adapter/schema versions, parameter source, active-profile eligible count, review cutoff, creation time, log loss, RMSE, and read-only `seed`, learning rate, and gamma in a `<dl>`. Do not render inputs for these values or the 21 weights.

Wrap each settings panel in its own compatibility boundary. If an unsupported
manifest/schema reaches one panel, render that panel's localized compatibility
error and keep language, scheduler, optimizer, backup, and restore siblings
usable. Add a test that supplies an optimizer manifest version greater than
the supported UI version and still saves scheduler settings successfully.

- [ ] **Step 7: Run web tests and accessibility assertions**

```bash
pnpm exec vitest run apps/web/src/settings apps/web/src/pages/SettingsPage.test.tsx apps/web/src/components
pnpm --filter @openrecall/web check
```

Expected: PASS; collapsed controls are absent from Tab order and help is user-invoked.

- [ ] **Step 8: Commit the Settings UI**

```bash
git add apps/web/src/components apps/web/src/settings apps/web/src/pages/SettingsPage.tsx apps/web/src/pages/SettingsPage.test.tsx apps/web/src/router.tsx apps/web/src/styles/layout.css
git commit -m "feat: add layered optimizer settings UI"
```

### Task 6: Localization, capability documentation, and end-to-end coverage

**Files:**
- Modify: `packages/i18n/src/catalog-keys.ts`
- Modify: `packages/i18n/src/locales/ar.ts`
- Modify: `packages/i18n/src/locales/en.ts`
- Modify: `packages/i18n/src/catalog-parity.test.ts`
- Modify: `tests/e2e/optimizer-durability.spec.ts`
- Modify: `tests/e2e/visual-accessibility.spec.ts`
- Modify: `docs/architecture/scheduler-upgrades.md`

**Interfaces:**
- Consumes: all Part 1 behavior.
- Produces: complete Arabic/English copy, pseudo-locale parity, browser proof, and future upgrade instructions.

- [ ] **Step 1: Add failing catalog and browser assertions**

Add keys for each panel, field, help disclosure, source, default, preflight count, conflict, restore action, and technical label. In Playwright require:

```ts
await expect(page.getByRole("button", { name: /إعدادات تدريب المحسّن/ })).toHaveAttribute("aria-expanded", "false");
await page.getByRole("button", { name: /إعدادات تدريب المحسّن/ }).click();
await expect(page.getByLabel("دورات التدريب")).toHaveValue("5");
await expect(page.getByText(/المستبعدة بسبب طول السجل/)).toBeVisible();
```

Add an axe scan after opening each new disclosure in Arabic and English.

- [ ] **Step 2: Run catalog and E2E tests to see missing copy/behavior**

```bash
pnpm exec vitest run packages/i18n/src
pnpm exec playwright test tests/e2e/optimizer-durability.spec.ts tests/e2e/visual-accessibility.spec.ts
```

Expected: catalog or locator failures until keys and browser behavior are complete.

- [ ] **Step 3: Add concise Arabic and English copy**

Use the approved meanings verbatim in substance:

- epochs: repeated passes, longer is not guaranteed better;
- batch size: memory and training-behavior tradeoff;
- maximum sequence: longer histories are excluded, not truncated;
- scheduler descriptions distinguish target, cap, fuzz, short-term, learning, and relearning behavior;
- technical values are official and read-only.

Let `en-XA` continue to derive through the pseudo-locale mechanism; do not hand-maintain a third resource dictionary.

- [ ] **Step 4: Document the upgrade checklist**

Extend `docs/architecture/scheduler-upgrades.md` with exact commands:

```bash
pnpm view ts-fsrs version dist-tags --json
pnpm view @open-spaced-repetition/binding version dist-tags --json
pnpm exec vitest run packages/scheduler/src/upgrade-boundary.test.ts packages/optimizer/src/upgrade-boundary.test.ts
```

Document that any new upstream field must be classified before the dependency commit passes CI and that beta dist-tags are never selected for release.

- [ ] **Step 5: Run focused localization and browser suites**

```bash
pnpm exec vitest run packages/i18n/src apps/web/src/settings apps/web/src/pages/SettingsPage.test.tsx
pnpm exec playwright test tests/e2e/optimizer-durability.spec.ts tests/e2e/visual-accessibility.spec.ts
```

Expected: PASS in Arabic, English, RTL, and LTR.

- [ ] **Step 6: Commit localization and E2E coverage**

```bash
git add packages/i18n/src tests/e2e/optimizer-durability.spec.ts tests/e2e/visual-accessibility.spec.ts docs/architecture/scheduler-upgrades.md
git commit -m "test: cover optimizer settings accessibility"
```

### Task 7: Part 1 verification and independent review gate

**Files:**
- Modify only files required by failures found during this gate.

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: a clean, independently testable Part 1 baseline for the step-recommendation plan.

- [ ] **Step 1: Run repository verification**

```bash
pnpm check
pnpm release:licenses
pnpm test
pnpm build
```

Expected: every command exits 0.

- [ ] **Step 2: Run production and browser verification**

```bash
node scripts/smoke-production.mjs --skip-build
pnpm test:e2e
pnpm test:package
```

Expected: server smoke, all Playwright projects, and Windows package contract tests PASS.

- [ ] **Step 3: Run Windows package smoke if the packaging prerequisites are present**

```bash
pnpm package:windows
pnpm smoke:package:windows
```

Expected: the portable and installed launchers start the current build and the smoke test exits 0. If a documented external packaging prerequisite is absent, record that exact prerequisite rather than claiming the smoke passed.

- [ ] **Step 4: Inspect the final diff and repository state**

```bash
git diff --check
git status --short
git log --oneline --decorate -10
```

Expected: no whitespace errors and no unrelated modifications.

- [ ] **Step 5: Request independent review**

Invoke `superpowers:requesting-code-review` and give the reviewer the approved spec, this plan, the Part 1 commit range, and explicit focus areas: upstream completeness, immutable snapshot correctness, SQLite migration safety, accessible-name noise, and forbidden editable fields.

- [ ] **Step 6: Address verified review findings and re-run affected suites**

Apply only findings reproduced against the current branch. Use `superpowers:receiving-code-review` before changing code, add a regression test for each accepted defect, and rerun the focused suite plus `pnpm verify`.

- [ ] **Step 7: Commit gate fixes if any**

```bash
git add -A
git commit -m "fix: address optimizer settings review"
```

Skip this commit only when the review produced no accepted changes and the worktree is already clean.

## Part 1 completion criteria

- The Settings page exposes all six scheduler controls and exactly three optimizer training controls.
- No API path can persist optimizer values outside the manifest choices.
- General/per-section inheritance and optimistic concurrency work.
- Real binding training and evaluation receive one identical full configuration.
- Every run stores enough input data to interpret it after later settings changes.
- Seed, learning rate, gamma, weights, callbacks, and timeout remain non-editable.
- Scheduler is expanded; optimizer and technical panels are collapsed by default.
- Field help is available without being spoken on every Tab stop.
- Arabic, English, pseudo-locale, RTL/LTR, unit, integration, E2E, production, and package checks pass.
- The branch is ready for `2026-08-10-comprehensive-settings-02-step-recommendations.md`.
