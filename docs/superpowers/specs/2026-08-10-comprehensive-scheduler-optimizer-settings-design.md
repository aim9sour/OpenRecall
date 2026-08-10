# OpenRecall Comprehensive Scheduler and Optimizer Settings Design

Date: 2026-08-10

Status: Approved for implementation

## Objective

Make OpenRecall's Settings page a complete, understandable, and durable control
surface for the user-adjustable capabilities of its spaced-repetition
scheduler and optimizer libraries without exposing developer plumbing,
dangerous machine-learning knobs, or controls that do not benefit even a power
user.

The design must remain local-first, SQLite-backed, multilingual, keyboard and
screen-reader accessible, and deliberately compatible with future stable
library upgrades. A future upstream field must never be ignored silently or
shown automatically without product review.

## Confirmed product decisions

- Use one layered Settings page rather than a separate optimizer laboratory.
- Show every upstream capability that is both intended to be configurable and
  useful to an OpenRecall user, including power users.
- Do not mirror every exported function or option merely because it is public.
- Keep the six existing scheduler controls.
- Keep the 21 FSRS model weights optimizer-managed. Users may inspect their
  source and metrics, train replacements, preview them, apply them, or restore
  official weights, but may not edit individual weights manually.
- Expose only three optimizer training controls: training epochs, batch size,
  and maximum review-sequence length.
- Keep optimizer seed, learning rate, and L2 regularization (`gamma`) at their
  official defaults and show them as read-only technical information.
- Derive `enableShortTerm` and the number of relearning steps from the
  effective scheduler settings instead of duplicating them in optimizer
  settings.
- Use general optimizer training settings with an optional per-section
  override. A section without an override inherits the general values.
- Do not permit arbitrary or extreme training values. Offer a small, hard-coded
  set of OpenRecall-safe choices centered on the upstream defaults.
- Add the binding's official optimal-step analysis as a tool that previews a
  recommendation and requires explicit application. It never changes settings
  automatically.
- Run training and optimal-step analysis away from the server's main thread.
- Store settings, run snapshots, and recommendation results in SQLite. Do not
  write temporary CSV files to disk.
- Descriptions must exist for every visible setting, but NVDA must not read a
  long description automatically whenever the user tabs to a field. Help is
  available through a dedicated disclosure for that field.
- Do not inspect, configure, start, stop, or otherwise interact with the
  owner's installed NVDA. Automated browser and DOM tests verify the
  accessibility contract.
- Stay on latest stable upstream releases. Beta releases are research inputs,
  not automatic upgrade targets.

## Verified upstream baseline

The design is based on the stable packages installed by OpenRecall and verified
against their published type declarations, changelogs, npm metadata, and
official repositories on 2026-08-10:

- `ts-fsrs@5.4.1`, the latest stable scheduler release. npm also publishes
  `6.0.0-beta.1`, which is intentionally not adopted by this work.
- `@open-spaced-repetition/binding@0.5.0`, the latest stable Node optimizer
  binding. npm also publishes `0.6.0-beta.1`, which is intentionally not
  adopted by this work.
- The binding uses the `fsrs` Rust crate 6.5.0 for parameter training.

The installed `FSRSParameters` interface contains these fields:

- `request_retention`;
- `maximum_interval`;
- `w`;
- `enable_fuzz`;
- `enable_short_term`;
- `learning_steps`;
- `relearning_steps`.

The installed binding's `TrainingConfig` contains:

- `numEpochs`, official default `5`;
- `batchSize`, official default `512`;
- `seed`, official default `2023`;
- `maxSeqLen`, official default `256`;
- `learningRate`, official default `0.04`;
- `gamma`, official default `1.0`.

The binding also exposes `computeOptimalSteps`, which accepts revlog CSV bytes,
desired retention, and either the FSRS decay value or the full parameter
array. It can recommend no more than two learning steps and one relearning
step. Its implementation requires at least 100 usable samples in a rating
group before making a recommendation for that group and rejects recommended
steps at or above 12 hours. A valid analysis can still return statistics with
no recommended step.

## Current OpenRecall behavior and gaps

OpenRecall already has a strong scheduler boundary:

- the scheduler package owns all `ts-fsrs` imports;
- a scheduler manifest describes the six user settings;
- the Settings page renders those controls in general or per-section scope;
- effective settings and model weights are resolved independently;
- optimizer candidates are trained in a worker, evaluated, persisted, and
  previewed before application;
- parameter profiles already support official, general, and section sources;
- scheduler and optimizer package versions are pinned rather than ranged.

The scheduler settings surface already covers all six non-weight fields that
are appropriate for user control. The material gaps are:

- no curated manifest or persisted settings for optimizer training;
- no way to pass the binding's `trainingConfig` to training and evaluation;
- no use of the binding's official optimal-step analysis;
- no durable snapshot of all effective training hyperparameters on each run;
- no exhaustive upstream capability inventory that forces a classification
  decision during future upgrades;
- technical version and model information is split across existing settings
  and optimizer views rather than presented as one coherent read-only area.

## Capability classification

OpenRecall will maintain an exhaustive inventory of the upstream scheduler and
optimizer surface used by the application. Each item has one of four product
classifications: user setting, user tool, read-only technical information, or
internal implementation detail.

### Scheduler capabilities

| Upstream capability | Classification | OpenRecall behavior |
| --- | --- | --- |
| Requested retention | User setting | Existing general/per-section control |
| Maximum interval | User setting | Existing general/per-section control |
| Fuzz | User setting | Existing boolean control |
| Short-term scheduling | User setting | Existing boolean control |
| Learning steps | User setting | Existing ordered minute list |
| Relearning steps | User setting | Existing ordered minute list |
| Twenty-one model weights | Optimizer-managed, read-only | Train, inspect source and metrics, preview, apply, restore |

### Optimizer capabilities

| Upstream capability | Classification | OpenRecall behavior |
| --- | --- | --- |
| Training epochs | Advanced user setting | Curated finite choices |
| Batch size | Advanced user setting | Curated finite choices |
| Maximum sequence length | Advanced user setting | Curated finite choices plus excluded-data preflight |
| Seed | Read-only technical information | Always use official `2023` |
| Learning rate | Read-only technical information | Always use official `0.04` |
| Gamma | Read-only technical information | Always use official `1.0` |
| Enable short-term model terms | Derived input | Resolve from effective scheduler settings |
| Number of relearning steps | Derived input | Resolve from effective relearning-step count |
| Compute parameters | User workflow | Existing training workflow, extended with settings snapshot |
| Evaluate with time-series splits | User workflow | Existing candidate metrics workflow |
| Compute optimal steps | User tool | New analyze, preview, and explicit-apply workflow |
| Progress callback | Internal detail | Cancellation and progress bridge owned by worker adapter |
| Progress polling timeout | Internal detail | Fixed by adapter; never a user deadline setting |
| CSV-to-training-item conversion | Internal detail | Not exposed as a preference |
| Dynamic WASI initialization and assets | Internal detail | Packaging/runtime concern only |
| Binding classes and review constructors | Internal detail | Confined to optimizer adapter |
| Binding scheduling, evaluation, universal-metrics, and SM-2 migration methods | Internal or purpose-built workflow | Never rendered as generic settings; remain adapter operations unless a separately designed workflow needs them |

The scheduler package also exports algorithm methods, date conversion,
parameter migration and clipping, seed strategies, formatting helpers, and
constants. These are implementation building blocks rather than independent
study preferences. The adapter may use them, and upgrade tests inventory their
imports, but the Settings page does not turn methods or constants into fields.

This inventory is intentionally broader than the UI manifest. Completeness
means every relevant upstream capability is reviewed and classified, not that
every API symbol becomes a control.

## Alternatives considered

### Layered capability-driven Settings page

This is the selected design. It keeps scope, inheritance, scheduler settings,
training, step recommendations, and technical information in one predictable
place while progressive disclosure prevents a long, noisy page.

### Separate optimizer laboratory

A separate page would reduce the visible size of Settings, but it would split
the effective scheduler configuration from the training configuration that
depends upon it. Users would need to move between pages to understand one
section, and scope and inheritance controls would be duplicated.

### Direct mirror of upstream options

This was rejected. It would expose callbacks, runtime loading, arbitrary model
weights, and unsafe hyperparameters; it would also turn upstream API churn into
unreviewed user-interface churn.

## Information architecture

The Settings page begins with one scope selector: general settings or a
specific section. Changing scope updates all scoped panels together. If any
panel contains unsaved edits, scope navigation requires confirmation and does
not discard those edits silently.

The page then presents these independent disclosures:

1. **Spaced-repetition scheduler.** Expanded by default because it contains
   ordinary study settings.
2. **Advanced optimizer training.** Collapsed by default.
3. **Learning-step recommendations.** Collapsed by default.
4. **Model and technical information.** Collapsed and read-only.

Language, appearance, backup, and restore settings remain in their existing
areas. This design does not turn the entire Settings page into a single
accordion and does not force only one disclosure to stay open.

Every scoped panel states the source of its effective value:

- this section;
- general settings;
- adapter or library defaults.

The scheduler and optimizer panels save independently. There is no page-wide
automatic save.

## Scheduler settings

The six existing scheduler controls remain manifest-driven and retain their
current persisted contract:

- requested retention, `0.80` through `0.95` in increments of `0.01`;
- maximum interval, 1 through 36,500 whole days;
- interval fuzz on or off;
- short-term scheduling on or off;
- zero or more strictly increasing learning steps expressed in whole minutes;
- zero or more strictly increasing relearning steps expressed in whole
  minutes.

The interface continues to explain that saved changes affect future ratings
and do not silently rewrite already stored due dates. Profile application and
rollback keep their existing separate replay preview.

The settings descriptions convey these meanings:

- requested retention is the target recall probability at the due time;
  raising it usually shortens intervals and increases workload;
- maximum interval is a cap, not a fixed or target interval;
- fuzz adds a small random variation to reduce clustering;
- disabling short-term scheduling makes the scheduler ignore configured
  learning and relearning steps;
- learning steps are increasing intraday delays for new cards;
- relearning steps are increasing intraday delays after a reviewed card is
  forgotten and rated Again;
- an empty step list requests scheduling without fixed steps.

## Optimizer training settings

The optimizer manifest exposes exactly three fields with enumerated values:

| Setting | OpenRecall choices | Upstream default |
| --- | --- | --- |
| Training epochs | 3, 5, 7, 10 | 5 |
| Batch size | 128, 256, 512, 1024 | 512 |
| Maximum review-sequence length | 64, 128, 256, 512 | 256 |

These are OpenRecall product guardrails, not claimed upstream limits. The form
uses select controls rather than free numeric input, so neither API calls nor
UI editing can persist a value outside the manifest.

The field help explains:

- epochs are passes over the training data; more passes take longer and are
  not promised to be more accurate;
- batch size affects memory use and training behavior;
- `maxSeqLen` filters out a training history whose review count exceeds the
  chosen value; it does not truncate that history.

Before a run starts, the panel displays raw review count, otherwise eligible
examples, and examples excluded by the selected maximum sequence length. A
section must still meet OpenRecall's optimizer eligibility policy after this
filter.

Seed, learning rate, and gamma are supplied explicitly from the adapter's
versioned official defaults. They appear in technical details but have no
editable controls.

### Scope and inheritance

There is one general optimizer training settings row. A section can enable an
override, initially copied from its currently effective general settings.
Removing the override deletes only the section row and immediately restores
inheritance.

Restoring official defaults sets the selected editable scope to `5`, `512`,
and `256`. For a section, the UI distinguishes this action from removing the
override and inheriting general settings.

## Manifests and future upgrade boundary

The scheduler retains its existing versioned manifest. The optimizer package
gains a versioned capability manifest containing:

- upstream package name and exact version;
- core FSRS version where relevant;
- adapter and schema versions;
- official full training configuration;
- the three editable controls, allowed choices, labels, descriptions, and
  default values;
- the classification of non-editable fields and tools.

Contracts and UI rendering consume these manifests instead of repeating
versions, defaults, and allowed values.

An upgrade-boundary test must fail when the pinned upstream public option
shape, known defaults, or OpenRecall classification inventory changes without
a corresponding manifest, migration, translation, and test decision. Unknown
future fields are never dropped silently and never auto-rendered. Deprecated
fields remain readable for migration but are not offered for new edits unless
the new adapter still supports them.

Stable version upgrades require documented review of semantics and migration.
Pre-release package tags never satisfy that upgrade automatically.

## Persistence model

The next SQLite migration adds an optimizer training-settings store with the
same concurrency and scope semantics as scheduler settings:

- stable row ID;
- `global` or `section` scope;
- nullable section ID constrained by scope;
- optimizer settings schema and adapter version;
- JSON containing only the three editable values;
- creation and update timestamps;
- one global row and at most one row per section.

Deleting a section cascades or explicitly removes its training override using
the existing section-deletion transaction.

Each optimizer run records an immutable input snapshot containing:

- all six training hyperparameters, including the three read-only defaults;
- effective short-term enablement and relearning-step count;
- editable-settings source and row revision;
- scheduler settings and parameter profile IDs used as inputs;
- optimizer package, FSRS core, algorithm, adapter, and schema versions;
- raw, eligible, maximum-sequence-excluded, and final training counts;
- source-review cutoff;
- a deterministic fingerprint of the canonical source review rows;
- status, timestamps, metrics, candidate profile, and stable failure code.

Historical runs are interpreted using their snapshot, not the current
settings manifest. Existing runs created before this migration remain valid
and are displayed as having the legacy official training configuration.

SQLite backups include the new tables and columns through the existing whole
database backup. No JSON backup format or sidecar configuration file is added.

## Training flow

Starting a training run resolves a single immutable context before queueing:

1. effective scheduler settings and parameter source;
2. effective optimizer training settings;
3. official read-only training defaults;
4. review-history snapshot and cutoff;
5. eligibility counts before and after `maxSeqLen` filtering.

The server rejects a run if the post-filter data is insufficient. The worker
receives the complete context and passes the same `trainingConfig` to parameter
training and time-series evaluation. Progress polling and cancellation remain
adapter-owned operational details.

Changing settings while a run is active does not mutate that run. A later run
uses the new values. Candidate application continues to require the existing
schedule-change preview and explicit confirmation.

## Optimal learning-step recommendation tool

### Data preparation

The tool queries review logs in the selected global or section scope and
constructs the binding's required columns in memory:

- learning-item ID as card ID;
- rating timestamp;
- stable rating 1 through 4;
- prior scheduler memory state mapped to the binding's review state;
- review duration.

Rows must have a valid timestamp, rating, state, duration, and monotonic order.
Because the algorithm depends on adjacent reviews, a malformed sequence causes
the affected learning item's sequence to be excluded rather than repaired
speculatively. The result reports excluded cards and rows by reason.

The CSV byte buffer exists only inside the optimizer worker and is released
after the call. It is not returned to the browser, written to disk, or added to
backup data.

The call uses the selected scope's effective requested retention and full
effective weight array, allowing the binding to obtain the decay parameter
from weight 20 without a user-editable decay control.

### Job lifecycle

Optimal-step analysis is represented as a durable run with queued, running,
succeeded, failed, and cancelled states. The synchronous native calculation
runs inside a disposable worker so it cannot block the server event loop. The
UI reports an indeterminate analyzing state because the binding supplies no
progress callback for this operation. Cancellation terminates the worker.

The persisted run stores:

- scope and source-review cutoff;
- a deterministic fingerprint of the canonical source rows used by the run;
- current learning and relearning steps;
- requested retention and parameter profile ID;
- package, algorithm, and adapter versions;
- per-group counts and statistics;
- recommended learning and relearning steps;
- excluded-data counts;
- status and timestamps;
- applied portions, prior values, and application timestamp if used.

Only one optimizer-owned CPU-heavy job may be active at a time. Training and
step analysis therefore share the existing optimizer conflict and
cancellation boundary.

### Result and application

The result view shows:

- usable and excluded data counts;
- per-group sample counts and the upstream 100-sample recommendation
  threshold;
- current and proposed steps using localized second/minute/hour formatting;
- partial recommendations separately;
- the legitimate states of statistics-only and no recommendation.

The binding returns integer seconds while OpenRecall's current scheduler
settings store whole minutes. Conversion is explicit and conservative rather
than hidden:

- a recommendation of at least 60 seconds is converted with
  `floor(seconds / 60)`, so OpenRecall never schedules later than the upstream
  recommendation because of rounding;
- converted values are sorted and deduplicated to preserve the scheduler's
  strictly increasing minute-list invariant;
- the preview shows both the exact upstream duration and the whole-minute value
  that will be saved whenever they differ;
- a recommendation below 60 seconds is displayed but cannot be applied
  automatically because it is below OpenRecall's supported step resolution;
- this feature does not widen the persisted scheduler-settings schema from
  minutes to seconds.

There are explicit actions to apply learning steps, apply relearning steps, or
apply both when available. Every action opens a final old-versus-new preview.

Application uses the selected scheduler-settings scope:

- a global analysis updates global scheduler settings;
- a section analysis creates or updates only that section's scheduler
  override, preserving all other effective scheduler fields;
- optimistic concurrency verifies that scheduler settings, parameter source,
  and the deterministic review-data fingerprint still match the analyzed
  snapshot;
- if either changed, the result becomes stale and application is disabled
  until analysis is repeated.

Application does not bulk-reschedule cards. Existing stored due dates remain
unchanged, and new steps affect subsequent ratings. The run stores the prior
and applied step lists. A restore action is available only while the current
values still equal that run's applied values, preventing an old restore from
overwriting later edits.

## API and contract shape

The API follows the existing `/api/v1` conventions and provides:

- `GET /api/v1/settings/optimizer` with an optional section query to load the
  effective optimizer settings and manifest;
- `PUT /api/v1/settings/optimizer/global` to save general settings with
  optimistic concurrency;
- `PUT` and `DELETE /api/v1/settings/optimizer/sections/:sectionId` to save or
  remove a section override;
- `POST /api/v1/optimizer/preflight` to calculate post-`maxSeqLen` training
  counts for a scoped draft without saving it;
- the existing `/api/v1/optimizer/runs` lifecycle, extended to return its
  immutable training snapshot;
- `POST /api/v1/optimizer/step-recommendations` to start an analysis;
- `GET /api/v1/optimizer/step-recommendations/:runId` to inspect it;
- `POST /api/v1/optimizer/step-recommendations/:runId/cancel` to cancel it;
- `POST /api/v1/optimizer/step-recommendations/:runId/apply` with an explicit
  learning, relearning, or both selection;
- `POST /api/v1/optimizer/step-recommendations/:runId/restore` to restore the
  captured prior values when the current-state guard still matches;
- `GET /api/v1/settings/technical` for consolidated model and version
  information.

All request schemas reject unknown properties. Server validation uses manifest
choices rather than trusting the browser. Error responses use stable codes and
localized client messages.

## Accessibility and localization

Every panel uses a real heading and a native disclosure button with
`aria-expanded` and `aria-controls`. Collapsed content is removed from the
accessibility tree and Tab order.

Each form control has a concise visible label. Tabbing to it announces its
label, selected value, and state only. Long help text is placed in a separate
native disclosure with a specific accessible name such as "Explain requested
retention". It is not attached as an always-spoken `aria-describedby` string.

When a field is invalid, `aria-invalid` and an associated error message expose
only the current error. A focused error summary links to invalid fields. Save,
conflict, job completion, cancellation, and failure announcements are short,
polite live-region updates emitted once per state transition. Tables and full
statistics are never spoken automatically.

Recommendation results use headings for navigation while questions, values,
and explanatory content remain ordinary text. Button names identify the exact
action, for example "Apply recommended relearning steps", rather than relying
on a surrounding group name that NVDA may repeat.

All new strings are added to Arabic, English, and pseudo-locale catalogs.
Catalog parity and static key analysis remain mandatory. Layout, number
formatting, duration formatting, and direction work in RTL and LTR. Numeric
input normalization continues to accept Arabic and Latin digits where free
numeric entry still exists in scheduler settings.

## Error handling and recovery

- Settings writes and recommendation application are atomic SQLite
  transactions.
- Worker failure, cancellation, or server restart never changes active
  settings or parameter profiles.
- Startup recovery marks interrupted durable jobs with a stable interrupted
  failure rather than leaving them running forever or reporting success.
- Manifest or adapter incompatibility disables only the affected settings
  panel and displays a stable compatibility error; it does not make study data
  inaccessible.
- Invalid persisted settings fail closed to a diagnosed compatibility state.
  They are not silently clamped or passed to a newer library.
- Section deletion quiesces optimizer jobs for that section and blocks new
  global or section jobs across the deletion transaction as required by the
  existing deletion boundary.
- Technical exception details remain in server logs. User-facing messages
  describe the safe next action without exposing stack traces.

## Test strategy

Implementation follows red-green-refactor and adds coverage at every boundary.

### Contracts and manifests

- Validate every optimizer manifest field, choice, default, classification,
  package version, and schema version.
- Prove that scheduler and optimizer UI contracts contain no unknown or
  unclassified capability.
- Add a compile-time or generated inventory assertion against pinned upstream
  option shapes and a runtime assertion for official defaults.
- Prove that beta versions cannot satisfy stable-version checks.

### Database and domain

- Migrate existing databases and interpret legacy optimizer runs correctly.
- Cover global settings, section overrides, inheritance, removal, restore,
  optimistic conflicts, and section deletion.
- Persist and reload complete immutable run snapshots.
- Property-test manifest validation and reject all values outside the enumerated
  choices.
- Verify settings and new tables are present in SQLite backup and restore.

### Optimizer adapter and workers

- Pass all six resolved training fields to the real installed binding for both
  training and evaluation.
- Prove seed, learning rate, and gamma remain official defaults regardless of
  API input.
- Verify `maxSeqLen` exclusion counts agree with the actual worker input.
- Exercise real-binding smoke fixtures in addition to mocked lifecycle tests.
- Cover progress, cancellation, forced worker termination, crash, and startup
  interruption recovery.
- Convert valid review logs to in-memory optimal-step input and reject malformed
  sequences deterministically.
- Cover sufficient, insufficient, partial, statistics-only, and no-
  recommendation results.

### Server services and routes

- Resolve one immutable effective context per run.
- Reject training after post-filter eligibility falls below the policy.
- Serialize CPU-heavy optimizer work through the shared conflict boundary.
- Detect stale settings, parameter source, or any source-review insertion,
  update, or deletion before recommendation application by comparing the
  canonical data fingerprint rather than relying on the latest timestamp
  alone.
- Apply each step subset atomically and restore prior values only when the
  current-state guard matches.
- Quiesce jobs safely during section deletion and shutdown.

### Web accessibility and behavior

- Verify initial disclosure states, concise accessible names, hidden focus
  exclusion, and keyboard operation.
- Verify field help is available but is not part of the control's automatically
  spoken description.
- Cover independent saves, unsaved scope-change confirmation, validation
  summary links, conflict preservation, restore semantics, and inherited
  source labels.
- Cover indeterminate analysis status without an invented percentage.
- Verify completion announcements occur once and result tables are not placed
  in live regions.
- Run Arabic, English, pseudo-locale, RTL, LTR, keyboard, axe, and Chrome
  end-to-end coverage.

### Release verification

- Run typechecking, unit and integration tests, real-binding tests, production
  build, server smoke tests, and browser end-to-end tests.
- Run Windows portable and installed-package smoke tests and the existing Linux
  CI matrix.
- Do not automate or touch the owner's physical NVDA installation.
- Request an independent code review after implementation because the change
  crosses algorithm, persistence, worker, API, localization, and accessibility
  boundaries.

## Compatibility and migration

- Existing scheduler settings and profiles retain their meanings.
- Existing due dates and review logs are never rewritten by settings save or
  optimal-step application.
- Existing optimizer runs remain displayable as legacy runs with inferred
  official training defaults.
- New SQLite data participates in the existing whole-database backup and needs
  no JSON export.
- The optimizer and scheduler remain behind package adapters so a future stable
  FSRS release can add a new adapter and explicit migration rather than
  leaking upstream types across the application.

## Non-goals

- Editing the 21 FSRS weights manually.
- Exposing seed, learning rate, gamma, progress callback cadence, worker
  timeout, WASI asset paths, or binding loader controls.
- Running beta scheduler or optimizer packages in the production release.
- Automatically applying trained weights or recommended steps.
- Automatically rescheduling every stored card when ordinary settings change.
- Exporting or backing up a generated revlog CSV.
- Providing arbitrary custom scheduling code on top of FSRS.
- Interacting with the user's installed NVDA.

## References

- ts-fsrs official repository and package documentation:
  <https://github.com/open-spaced-repetition/ts-fsrs>
- `@open-spaced-repetition/binding` 0.5 training-configuration change:
  <https://github.com/open-spaced-repetition/ts-fsrs/pull/381>
- `computeOptimalSteps` design and implementation change:
  <https://github.com/open-spaced-repetition/ts-fsrs/pull/325>
- fsrs-rs official optimizer repository:
  <https://github.com/open-spaced-repetition/fsrs-rs>
- FSRS configuration tutorial and learning-step guidance:
  <https://github.com/open-spaced-repetition/fsrs4anki/blob/main/docs/tutorial.md>
- Py-FSRS official explanation of scheduler settings and model weights:
  <https://github.com/open-spaced-repetition/py-fsrs#custom-parameters>
