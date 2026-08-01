# OpenRecall Review Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add correct FSRS-6 scheduling, smart variant rotation, atomic ratings, continuous due-time sessions, pause/resume, summaries, and the exact Chrome/NVDA focus contract.

**Architecture:** An application-owned scheduler adapter and clock projection isolate `ts-fsrs`. SQLite stores normalized state and immutable logs; session appearances use a partial uniqueness rule so a card can re-enter only after a prior appearance completes and its exact new due time arrives. One server wake service queries the nearest due time and sends content-free SSE invalidations.

**Tech Stack:** The Stage 1 stack plus `ts-fsrs@5.4.1`, `@js-temporal/polyfill@0.5.1`, and `@fastify/sse@0.6.0`.

## Global Constraints

- Only `packages/scheduler` may import `ts-fsrs`.
- The initial algorithm is FSRS-6 through `ts-fsrs@5.4.1`; FSRS-7 is not claimed.
- The database stores OpenRecall-owned state, algorithm/adapter versions, and exact `due_at_ms`.
- Every historical rating captures effective timezone, study-day boundary, settings, and parameter profile.
- No fixed learning-delay assumption may appear outside scheduler fixtures.
- A card joins an active session only when stored `due_at_ms <= nowMs`.
- A far-future timer is sliced below Node's 2,147,483,647 ms limit and always re-queries SQLite.
- One learning item may have only one queued/active appearance per session, but may return after a completed appearance.
- Rating is idempotent and revision-checked in one synchronous `BEGIN IMMEDIATE` transaction.
- Localized “Question,” “Answer,” and optional “Notes” labels are headings; actual card content is normal text and receives focus for content-only automatic speech.
- `Space` reveals; `1`–`4` rate after reveal; `0` focuses but never activates the end action.
- Card content uses `dir="auto"` and never enters a live region.

---

### Task 1: Study-Day Clock Projection

**Files:**
- Create: `packages/domain/src/time/types.ts`
- Create: `packages/domain/src/time/scheduler-clock.ts`
- Create: `packages/domain/src/time/scheduler-clock.test.ts`
- Create: `packages/domain/src/time/scheduler-clock.property.test.ts`

**Interfaces:**
- Produces:
  `StudyDayConfig = { timeZone: string; boundaryMinutes: number }`.
- Produces:
  `toSchedulerDate(epochMs, config): Date`.
- Produces:
  `fromSchedulerDate(date, config): number`.
- Produces:
  `studyDayDelta(previousMs, currentMs, config): number`.

- [ ] **Step 1: Write failing fixed-zone tests**

Assert that Cairo `2026-07-28T01:30` with a 04:00 boundary projects to the
previous synthetic UTC study day, while 04:00 starts the next study day. Assert
UTC with boundary zero is field-for-field identity.

- [ ] **Step 2: Write failing DST tests**

Cover `America/New_York` spring-forward and fall-back instants. Assert
round-tripping `fromSchedulerDate(toSchedulerDate(ms))` preserves the real
instant for normal instants and uses Temporal's documented `compatible`
disambiguation for boundary wall times that are skipped or repeated.

- [ ] **Step 3: Run and verify RED**

Run: `pnpm vitest run packages/domain/src/time`

Expected: FAIL because the clock functions are missing.

- [ ] **Step 4: Implement the forward projection**

```ts
export function toSchedulerDate(
  epochMs: number,
  config: StudyDayConfig,
): Date {
  const shifted = Temporal.Instant.fromEpochMilliseconds(epochMs)
    .toZonedDateTimeISO(config.timeZone)
    .subtract({ minutes: config.boundaryMinutes });

  return new Date(Date.UTC(
    shifted.year,
    shifted.month - 1,
    shifted.day,
    shifted.hour,
    shifted.minute,
    shifted.second,
    shifted.millisecond,
  ));
}
```

Validate IANA timezone and integer boundary `0..1439` before conversion.

- [ ] **Step 5: Implement inverse projection and day delta**

Interpret the scheduler date's UTC fields as wall-clock fields in the configured
zone, add the boundary, and return `toInstant().epochMilliseconds`.
`studyDayDelta` subtracts the synthetic UTC calendar dates and returns a
nonnegative whole-day integer; reject reversed inputs.

- [ ] **Step 6: Add property tests**

Generate instants over ten years, valid boundary minutes, and a fixed zone set
(`UTC`, `Africa/Cairo`, `America/New_York`, `Asia/Kolkata`). Assert projection
is deterministic, day delta is integral, and ordinary non-transition instants
round-trip exactly.

- [ ] **Step 7: Run and commit**

Run: `pnpm vitest run packages/domain/src/time && pnpm check`

```bash
git add packages/domain/src/time
git commit -m "feat: project instants into FSRS study days"
```

### Task 2: Versioned FSRS-6 Adapter

**Files:**
- Create: `packages/scheduler/package.json`
- Create: `packages/scheduler/src/types.ts`
- Create: `packages/scheduler/src/manifest.ts`
- Create: `packages/scheduler/src/validate-settings.ts`
- Create: `packages/scheduler/src/fsrs6-adapter.ts`
- Create: `packages/scheduler/src/fsrs6-adapter.test.ts`
- Create: `packages/scheduler/src/upgrade-boundary.test.ts`
- Create: `packages/scheduler/src/index.ts`

**Interfaces:**
- Produces:

```ts
export type Rating = 1 | 2 | 3 | 4;
export type MemoryState = "new" | "learning" | "review" | "relearning";

export interface SchedulerStateV1 {
  schemaVersion: 1;
  dueAtMs: number;
  memoryState: MemoryState;
  stepIndex: number | null;
  stability: number;
  difficulty: number;
  elapsedDaysAtLastReview: number;
  scheduledDays: number;
  lastReviewAtMs: number | null;
  repetitions: number;
  lapses: number;
  revision: number;
}

export interface SchedulerSettingsV1 {
  requestedRetention: number;
  maximumIntervalDays: number;
  enableFuzz: boolean;
  enableShortTerm: boolean;
  learningStepsMinutes: number[];
  relearningStepsMinutes: number[];
}

export interface ScheduleContext {
  nowMs: number;
  studyDay: StudyDayConfig;
  settings: SchedulerSettingsV1;
  weights: readonly number[];
  parameterProfileId: string;
}

export interface RatingOutcome {
  rating: Rating;
  state: SchedulerStateV1;
  dueAtMs: number;
  retrievabilityBefore: number | null;
}
```

- Produces:
  `createInitialState(nowMs): SchedulerStateV1`,
  `previewRatings(state, context): Record<Rating, RatingOutcome>`,
  `applyRating(state, rating, context): RatingOutcome`,
  `getRetrievability(state, nowMs, context): number | null`.

- [ ] **Step 1: Write failing manifest and validation tests**

Assert manifest algorithm `FSRS-6`, package `ts-fsrs@5.4.1`, adapter schema 1,
21 weights, official defaults, and settings rejection for NaN retention,
noninteger maximum interval, duplicate/decreasing steps, zero steps, and steps
at or above 24 hours.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/scheduler/src/fsrs6-adapter.test.ts`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement strict settings conversion**

Convert minute arrays to upstream strings such as `"1m"` and `"2h"` only after
validation. Never pass raw form strings to `ts-fsrs`. Copy the official
21-weight default array into the manifest fixture and assert it equals the
installed library export.

- [ ] **Step 4: Implement state mappers and adapter**

Only `fsrs6-adapter.ts` imports:

```ts
import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating as UpstreamRating,
  State as UpstreamState,
} from "ts-fsrs";
```

Map between `SchedulerStateV1` and the stable upstream card shape. Use
`toSchedulerDate` for input instants and `fromSchedulerDate` for returned due
dates. Increment `revision` exactly once in `applyRating`.

- [ ] **Step 5: Add exact golden fixtures**

At `2026-07-28T10:00:00Z`, official defaults must produce initial due offsets
of 1 minute, 6 minutes, 10 minutes, and 8 days for ratings 1–4. Add fixtures for
learning, review, relearning, same-study-day, Cairo 04:00 boundary, and a
long-interval card.

- [ ] **Step 6: Add adapter-boundary test**

Scan `apps/**` and `packages/**` source files and fail if `ts-fsrs` appears
outside `packages/scheduler`. Assert serialized fixtures contain no upstream
enum names or package object dumps.

- [ ] **Step 7: Run and commit**

Run: `pnpm vitest run packages/scheduler && pnpm check`

```bash
git add packages/scheduler
git commit -m "feat: isolate stable FSRS-6 scheduling"
```

### Task 3: Review Schema Migration and Typed Repositories

**Files:**
- Create: `packages/database/src/migrations/002-review-core.ts`
- Create: `packages/database/src/migrations/002-review-core.test.ts`
- Create: `packages/database/src/review-types.ts`
- Modify: `packages/database/src/migrate.ts`
- Modify: `packages/database/src/card-import-repository.ts`

**Interfaces:**
- Raises database `user_version` from 1 to 2.
- Creates `parameter_profiles`, `scheduler_states`, `review_logs`,
  `review_sessions`, `session_queue_entries`, and `rating_requests`.
- Backfills one initial scheduler state for every existing learning item.

- [ ] **Step 1: Write failing migration tests**

Open a schema-v1 fixture with one imported card, migrate, and assert:

- Official profile `official-fsrs6-v1` exists with 21 weights.
- The card has state `new`, revision 0, and due at its creation time.
- A second queued/active appearance for the same session/item is rejected.
- A completed appearance followed by a new queued appearance is accepted.
- Only one open session (`active`, `waiting`, or `paused`) can exist globally.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/database/src/migrations/002-review-core.test.ts`

Expected: FAIL because migration 002 is missing.

- [ ] **Step 3: Add exact review tables**

Create strict tables with these essential keys:

```sql
CREATE TABLE parameter_profiles (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('official', 'global', 'section')),
  section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
  algorithm_id TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  adapter_version INTEGER NOT NULL,
  weights_json TEXT NOT NULL,
  eligible_example_count INTEGER NOT NULL DEFAULT 0,
  review_cutoff_ms INTEGER,
  status TEXT NOT NULL CHECK(status IN ('candidate', 'active', 'superseded')),
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE scheduler_states (
  learning_item_id TEXT PRIMARY KEY
    REFERENCES learning_items(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  due_at_ms INTEGER NOT NULL,
  memory_state TEXT NOT NULL
    CHECK(memory_state IN ('new','learning','review','relearning')),
  step_index INTEGER,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  elapsed_days_at_last_review REAL NOT NULL,
  scheduled_days REAL NOT NULL,
  last_review_at_ms INTEGER,
  repetitions INTEGER NOT NULL,
  lapses INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  algorithm_id TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  adapter_version INTEGER NOT NULL,
  parameter_profile_id TEXT NOT NULL
    REFERENCES parameter_profiles(id)
) STRICT;

CREATE TABLE review_sessions (
  id TEXT PRIMARY KEY,
  singleton INTEGER NOT NULL DEFAULT 1 CHECK(singleton = 1),
  section_id TEXT NOT NULL REFERENCES sections(id),
  status TEXT NOT NULL
    CHECK(status IN ('active','waiting','paused','completed')),
  started_at_ms INTEGER NOT NULL,
  resumed_at_ms INTEGER,
  paused_at_ms INTEGER,
  completed_at_ms INTEGER,
  revision INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE UNIQUE INDEX ux_one_open_review_session
  ON review_sessions(singleton)
  WHERE status IN ('active','waiting','paused');

CREATE TABLE session_queue_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
  learning_item_id TEXT NOT NULL REFERENCES learning_items(id),
  status TEXT NOT NULL CHECK(status IN ('queued','active','completed','removed')),
  enqueued_due_at_ms INTEGER NOT NULL,
  enqueued_at_ms INTEGER NOT NULL,
  activated_at_ms INTEGER,
  presentation_id TEXT REFERENCES presentations(id),
  shown_at_ms INTEGER,
  revealed_at_ms INTEGER,
  completed_at_ms INTEGER
) STRICT;

CREATE UNIQUE INDEX ux_session_pending_item
  ON session_queue_entries(session_id, learning_item_id)
  WHERE status IN ('queued','active');
```

`review_logs` stores immutable prior/result state JSON, presentation ID plus
front/back/notes snapshots, rating, all three UI timestamps, duration,
`study_day_delta` calculated at rating time,
algorithm/adapter/profile, timezone, boundary, settings JSON, retrievability
before, and exact resulting due. `rating_requests` has
`idempotency_key TEXT PRIMARY KEY`, session/item/revision, and response JSON.

- [ ] **Step 4: Add due indexes and backfill**

```sql
CREATE INDEX idx_scheduler_due
  ON scheduler_states(due_at_ms, learning_item_id);
CREATE INDEX idx_scheduler_section_due
  ON scheduler_states(section_id, due_at_ms, learning_item_id);
CREATE INDEX idx_queue_session_status
  ON session_queue_entries(session_id, status, enqueued_due_at_ms, id);
CREATE INDEX idx_review_logs_item_time
  ON review_logs(learning_item_id, rated_at_ms, id);
```

Backfill `section_id` and initial states from `learning_items`, and modify future
imports to insert state/section/official profile reference in the same
transaction. Verify with `EXPLAIN QUERY PLAN` that section-scoped due queries
use `idx_scheduler_section_due`.

- [ ] **Step 5: Run migration verification**

Run: `pnpm vitest run packages/database/src/migrations && pnpm check`

Expected: v1 migration, v2 migration, backfill, and partial uniqueness pass.

- [ ] **Step 6: Commit**

```bash
git add packages/database
git commit -m "feat: add review history and session schema"
```

### Task 4: Smart Presentation Rotation and Current-Card Claim

**Files:**
- Create: `packages/domain/src/rotation/select-presentation.ts`
- Create: `packages/domain/src/rotation/select-presentation.test.ts`
- Create: `packages/domain/src/rotation/select-presentation.property.test.ts`
- Create: `packages/database/src/review-session-repository.ts`
- Create: `packages/database/src/review-session-repository.test.ts`

**Interfaces:**
- Produces:
  `selectPresentation(candidates, randomIndex): PresentationId`.
- Produces:
  `claimNext(sessionId, nowMs, randomIndex): ReviewCardView | null`.
- Claim returns the existing active appearance if one exists; otherwise it
  atomically activates the oldest due queued appearance and selects a variant.

- [ ] **Step 1: Write failing rotation examples**

Assert:

1. One presentation always wins.
2. The last shown is excluded when another exists.
3. Oldest nullable `lastShownAtMs` wins.
4. Lowest show count breaks the next tie.
5. Injected unbiased random index breaks only a complete tie.

- [ ] **Step 2: Add property tests**

Prove returned IDs always belong to candidates, the last card is never repeated
when an alternative exists, and exposure counts differing by more than one
eventually choose the lesser-shown candidate.

- [ ] **Step 3: Run and verify RED**

Run: `pnpm vitest run packages/domain/src/rotation`

Expected: FAIL on missing selector.

- [ ] **Step 4: Implement pure selector**

Sort no caller-owned array in place. Treat `lastShownAtMs = null` as oldest.
Generate the tie random integer using rejection sampling over
`crypto.randomBytes`, exposed through an injected `randomIndex(maxExclusive)`.

- [ ] **Step 5: Write failing claim repository tests**

Assert deterministic due ordering, idempotent repeated claim, no exposure write
at claim time, trashed item removal, and only one active appearance.

- [ ] **Step 6: Implement claim transaction**

Within `BEGIN IMMEDIATE`, return an already active row or activate one queued
row ordered by `enqueued_due_at_ms, id`; remove invalid/trashed rows; select and
store `presentation_id`; return front only before reveal.

- [ ] **Step 7: Run and commit**

Run: `pnpm vitest run packages/domain/src/rotation packages/database/src/review-session-repository.test.ts`

```bash
git add packages/domain/src/rotation packages/database/src/review-session-repository*
git commit -m "feat: rotate and claim review presentations"
```

### Task 5: Dynamic Session Start, Resume, and Queue Merge

**Files:**
- Create: `packages/domain/src/review/session-status.ts`
- Create: `packages/database/src/review-queue-repository.ts`
- Create: `packages/database/src/review-queue-repository.test.ts`

**Interfaces:**
- Produces:
  `startOrResumeSession(sectionId, nowMs): ReviewSessionSnapshot`.
- Produces:
  `mergeDueItems(sessionId, nowMs): { added: number; revision: number }`.
- Produces:
  `getNearestFutureDue(sectionId, nowMs): number | null`.

- [ ] **Step 1: Write failing queue tests**

Cover:

- Every new/due active item joins; no daily limit.
- Future items do not join.
- `due_at_ms === nowMs` joins.
- Merge is idempotent while an item is queued/active.
- A completed appearance can re-enter after its updated due time.
- Resume merges items that became due while paused.
- A second section cannot start while an open session exists.
- An empty queue reports nearest future due exactly.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/database/src/review-queue-repository.test.ts`

Expected: FAIL because queue repository is missing.

- [ ] **Step 3: Implement indexed insertion**

Use one `INSERT ... SELECT` joining `scheduler_states` to active
`learning_items`, filtering section and `due_at_ms <= nowMs`, with
`ON CONFLICT DO NOTHING` against the partial pending index. Increment session
revision only when rows are added or status changes.

- [ ] **Step 4: Implement snapshot counters**

Return `completedAppearances`, `currentlyRemaining`, `newRemaining`,
`repeatedWithinSession`, elapsed active milliseconds, `newlyJoined`, and
nullable `nextDueAtMs`. Label remaining as a snapshot in UI contracts.

- [ ] **Step 5: Run and commit**

Run: `pnpm vitest run packages/database/src/review-queue-repository.test.ts && pnpm check`

```bash
git add packages/domain/src/review packages/database/src/review-queue-repository*
git commit -m "feat: maintain continuous due review queues"
```

### Task 6: Atomic Reveal, Exposure, and Rating

**Files:**
- Create: `packages/domain/src/review/rating-service.ts`
- Create: `packages/domain/src/review/rating-service.test.ts`
- Create: `packages/database/src/rating-transaction.ts`
- Create: `packages/database/src/rating-transaction.test.ts`

**Interfaces:**
- Produces:
  `markShown(sessionId, entryId, presentationId, nowMs): void`.
- Produces:
  `markRevealed(sessionId, entryId, nowMs): RevealedCardView`.
- Produces:

```ts
rate(input: {
  sessionId: string;
  entryId: string;
  learningItemId: string;
  rating: Rating;
  expectedStateRevision: number;
  idempotencyKey: string;
  nowMs: number;
}): RatingResponse;
```

- [ ] **Step 1: Write failing shown/reveal tests**

Assert exposure increments only on the first idempotent `markShown`, reveal
requires shown, reveal returns back and optional notes, a second reveal returns
the same timestamp, and neither endpoint mutates scheduler state.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/database/src/rating-transaction.test.ts`

Expected: FAIL because transaction functions are missing.

- [ ] **Step 3: Implement shown and reveal transactions**

Verify session/entry/presentation relationships. On first shown, update the
exposure row and queue `shown_at_ms`. On first reveal, set `revealed_at_ms`.
Return back/notes only from reveal.

- [ ] **Step 4: Write failing rating tests**

Assert:

- Rating before reveal is rejected.
- Expected revision mismatch returns `STALE_SCHEDULER_STATE`.
- Reusing an idempotency key returns byte-equivalent response without a second
  log.
- One log, one state update, and one completed appearance commit together.
- A forced insert error rolls everything back.
- Rating uses server `nowMs`, captures timezone/boundary/settings/profile, and
  computes duration from reveal.
- Newly due items merge in the same transaction.

- [ ] **Step 5: Implement short immediate rating transaction**

Inside `db.transaction(...).immediate`:

1. Return stored response for an existing idempotency key.
2. Load and validate active appearance/state revision.
3. Resolve effective settings/profile synchronously.
4. Call `applyRating`.
5. Append immutable log with prior/result JSON.
6. Update normalized state with `WHERE revision = expected`.
7. Mark appearance completed.
8. Merge currently due items, including a newly re-due item only if exact due
   is now.
9. Update session status/counters/revision.
10. Store canonical response JSON under the idempotency key.

Throw on every SQLite error; do not catch and continue inside the transaction.

- [ ] **Step 6: Run concurrency/idempotency verification**

Run: `pnpm vitest run packages/domain/src/review packages/database/src/rating-transaction.test.ts`

Expected: all four ratings, stale revision, duplicate request, rollback, and
same-session repeat cases pass.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/review packages/database/src/rating-transaction*
git commit -m "feat: record atomic idempotent ratings"
```

### Task 7: Nearest-Due Wake Service and SSE

**Files:**
- Create: `apps/server/src/review/due-wake-service.ts`
- Create: `apps/server/src/review/due-wake-service.test.ts`
- Create: `apps/server/src/review/review-events.ts`
- Create: `apps/server/src/routes/events.ts`
- Create: `apps/server/src/routes/events.test.ts`

**Interfaces:**
- Produces:
  `DueWakeService.start()`, `.rearm()`, `.stop()`.
- Produces SSE event:
  `{ event: "review-invalidated", data: { sessionId, revision } }`.
- SSE never contains card content.

- [ ] **Step 1: Write failing fake-clock timer tests**

Assert one timer only, exact due requery, rearm after merge, no busy polling,
clock-jump recovery, stop cleanup, and a 90-day due time is split into safe
delays no larger than `2_147_000_000` ms.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/server/src/review/due-wake-service.test.ts`

Expected: FAIL because wake service is missing.

- [ ] **Step 3: Implement wake service**

Inject `now`, `setTimer`, and `clearTimer`. Query only sessions in `active` or
`waiting` state and their nearest due; paused sessions receive no timer until
resume. Cap delay and call `.unref()` when available. At every wake, call
`mergeDueItems` before publishing an invalidation and calculating the next
timer.

- [ ] **Step 4: Write failing SSE route tests**

Assert valid Host/Origin connects, wrong values reject, heartbeat is content
free, close removes subscriber, and a published invalidation includes only
session ID/revision.

- [ ] **Step 5: Implement SSE registry and route**

Use `@fastify/sse` with `sse: "only"`, `keepAlive()`, `send`, and `onClose`.
Never treat SSE delivery as durable state; reconnecting clients must refetch.

- [ ] **Step 6: Run and commit**

Run: `pnpm vitest run apps/server/src/review apps/server/src/routes/events.test.ts`

```bash
git add apps/server/src/review apps/server/src/routes/events*
git commit -m "feat: wake sessions at exact due times"
```

### Task 8: Review API

**Files:**
- Create: `packages/contracts/src/review.ts`
- Create: `apps/server/src/routes/review.ts`
- Create: `apps/server/src/routes/review.test.ts`
- Modify: `apps/server/src/app.ts`

**Interfaces:**
- Routes:
  `POST /api/v1/review-sessions`,
  `GET /api/v1/review-sessions/:id`,
  `POST /api/v1/review-sessions/:id/next`,
  `POST /api/v1/review-sessions/:id/current/shown`,
  `POST /api/v1/review-sessions/:id/current/reveal`,
  `POST /api/v1/review-sessions/:id/current/rate`,
  `POST /api/v1/review-sessions/:id/pause`,
  `POST /api/v1/review-sessions/:id/resume`,
  `POST /api/v1/review-sessions/:id/finish`.

- [ ] **Step 1: Write failing route flow test**

Through Fastify injection: start, claim, shown, reveal, rate, fetch next/wait,
pause, resume, and finish. Assert front is absent from error logs and back/notes
are absent before reveal.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/server/src/routes/review.test.ts`

Expected: FAIL because contracts/routes are absent.

- [ ] **Step 3: Define strict request and response schemas**

Use UUID/idempotency strings, rating union `1|2|3|4`, integer revisions, and
discriminated review states:

```ts
type ReviewPageState =
  | { kind: "question"; card: QuestionView; session: SessionProgress }
  | { kind: "answer"; card: AnswerView; outcomes: OutcomePreview[]; session: SessionProgress }
  | { kind: "waiting"; nextDueAtMs: number | null; session: SessionProgress }
  | { kind: "completed"; summary: SessionSummary };
```

- [ ] **Step 4: Implement routes and wake-service hooks**

Call `rearm()` after start, rating, pause/resume, finish, and empty-queue
transitions. Publish only invalidation metadata after committed changes.

- [ ] **Step 5: Run API verification**

Run: `pnpm vitest run apps/server/src/routes/review.test.ts && pnpm check`

Expected: complete API flow and response disclosure tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/review.ts apps/server/src
git commit -m "feat: expose the review session API"
```

### Task 9: Accessible Review Page and Keyboard Contract

**Files:**
- Create: `apps/web/src/pages/ReviewPage.tsx`
- Create: `apps/web/src/review/use-review-shortcuts.ts`
- Create: `apps/web/src/review/use-review-events.ts`
- Create: `apps/web/src/review/SessionProgress.tsx`
- Create: `apps/web/src/review/RatingButtons.tsx`
- Create: `apps/web/src/pages/ReviewPage.test.tsx`
- Modify: `apps/web/src/pages/HomePage.tsx`
- Modify: `apps/web/src/pages/SectionPage.tsx`
- Modify: `apps/web/src/router.tsx`

**Interfaces:**
- Produces route `/review/:sessionId`.
- Consumes the discriminated `ReviewPageState` from Task 8.
- Revalidates after SSE, reconnect, focus, and visibility restoration.

- [ ] **Step 1: Write failing focus tests**

Assert:

- The localized “Question” label is the only `<h1>`; actual question content is
  normal text and receives focus.
- Reveal focuses normal answer content while the localized “Answer” label is an
  `h2`; automatic speech does not prepend that label.
- Nonempty notes have a localized `h2` label followed by normal text. Empty
  notes and their label are absent.
- Rating focuses the next normal question content.
- The status live region never contains front/back/notes.
- When due items join, the live region announces only the localized added count
  and does not interrupt or reread the current question.

- [ ] **Step 2: Write failing shortcut tests**

Assert Space reveals; 1–4 rate only after reveal; 0 focuses the end button
without clicking it; all shortcuts are ignored in input/textarea/select/content
editable elements and while a modal dialog is open.

- [ ] **Step 3: Run and verify RED**

Run: `pnpm vitest run apps/web/src/pages/ReviewPage.test.tsx`

Expected: FAIL because review components are absent.

- [ ] **Step 4: Implement semantic review states**

Use refs and post-commit effects to focus:

```tsx
<h1>{t("review.question")}</h1>
<p ref={questionRef} tabIndex={-1} dir="auto">{front}</p>
<h2>{t("review.answer")}</h2>
<p ref={answerRef} tabIndex={-1} dir="auto">{back}</p>
{notes ? <><h2>{t("review.notes")}</h2><p dir="auto">{notes}</p></> : null}
```

Keep translated label headings separate from normal card content so focus
announces the content directly. Keep one pre-mounted
`<div role="status" aria-atomic="true">` for short queue messages.

- [ ] **Step 5: Connect external start-review actions**

Enable the native start-review button on every Home section summary and the
Section detail page. Submit the section ID to the session-start route and
navigate to the returned `/review/:sessionId`; if an open session already
exists, navigate to that session and show the server's localized conflict
explanation rather than creating another.

- [ ] **Step 6: Implement progress and ratings**

Show completed, current remaining snapshot, new, repeated, elapsed active time,
and newly joined. Use a native progress element only with an equivalent visible
text summary. Each rating button shows translated rating and formatted predicted
interval. Compare session revisions after revalidation and announce only the
localized number of newly joined items.

- [ ] **Step 7: Implement SSE/recovery revalidation**

Open `EventSource("/api/v1/events")`; on invalidation call React Router
`revalidate()`. Also revalidate on `online`, window focus, and
`visibilityState === "visible"`. Do not announce reconnect attempts.

- [ ] **Step 8: Run component accessibility verification**

Run: `pnpm vitest run apps/web/src/pages/ReviewPage.test.tsx`

Expected: focus/shortcut/live-region tests and axe checks pass in Arabic and
English.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/ReviewPage* apps/web/src/pages/HomePage.tsx apps/web/src/pages/SectionPage.tsx apps/web/src/review apps/web/src/router.tsx
git commit -m "feat: add NVDA-first review interaction"
```

### Task 10: Waiting, Pause/Resume, Completion, and End-to-End Review

**Files:**
- Create: `apps/web/src/review/WaitingState.tsx`
- Create: `apps/web/src/review/SessionSummary.tsx`
- Create: `apps/web/src/review/EndSessionDialog.tsx`
- Create: `apps/web/src/review/session-states.test.tsx`
- Create: `tests/e2e/review-core.spec.ts`
- Create: `docs/accessibility/nvda-review-checklist.md`

**Interfaces:**
- Waiting state shows exact next due, wait/end/home actions.
- Completion shows events, unique cards, rating distribution, repeats, active
  duration, and home/section actions.

- [ ] **Step 1: Write failing state component tests**

Assert waiting with/without a next due time, focus transition when SSE makes a
card available, end dialog focus trap/restore, paused session persistence after
reload, and completion home link.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/web/src/review/session-states.test.tsx`

Expected: FAIL because state components are missing.

- [ ] **Step 3: Implement waiting and pause/end behavior**

“End now” maps to pause when cards/future due work remain and to completed only
when the user explicitly finishes. Persist state on the server before
navigation. The confirmation dialog names the consequence and restores focus
to its opener on cancel.

- [ ] **Step 4: Implement completion summary**

Calculate the server summary from immutable logs/session appearances, not client
counters. Display a semantic definition list and rating table.

- [ ] **Step 5: Add deterministic E2E flow**

Use a fake server clock:

1. Import an item with two variants.
2. Start, show, reveal, rate Again.
3. Verify waiting and exact next due.
4. Advance to due, trigger timer, verify the item rejoins with another variant.
5. Rate, pause, reload, resume, and finish.
6. Verify summary and home return.

- [ ] **Step 6: Write the manual NVDA checklist**

Record exact expected speech/focus for question, reveal, notes, rating, due-item
announcement, waiting transition, dialog, and completion. Include the tested
Chrome/NVDA versions and Arabic/English runs.

- [ ] **Step 7: Run complete Stage 2 verification**

Run:

```bash
pnpm check
pnpm test
pnpm build
pnpm test:e2e --grep "review core"
```

Expected: all adapter, time, transaction, timer, API, component, and E2E tests
pass with no serious/critical axe findings.

- [ ] **Step 8: Commit**

```bash
git add apps/web tests/e2e docs/accessibility
git commit -m "feat: complete continuous review sessions"
```

## Stage 2 Exit Gate

- [ ] Run scheduler golden fixtures against the exact installed lockfile.
- [ ] Demonstrate that no fixed “10 minute” queue code exists outside tests or
  the upstream-default documentation fixture.
- [ ] Inspect the rating transaction under forced failure and confirm zero
  partial logs/states.
- [ ] Complete the manual Chrome/NVDA checklist in Arabic and English.
- [ ] Confirm the same item can return after due but cannot appear twice
  simultaneously.
