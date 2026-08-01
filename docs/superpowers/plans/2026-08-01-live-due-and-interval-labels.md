# Live Due Cards and Interval Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a waiting review claim newly due cards at their exact stored due time even when SSE is missed, and show rating intervals in a human-scale localized unit.

**Architecture:** Keep the server's exact SQLite-backed due timer and SSE path as the primary mechanism. Add a second exact, one-shot client claim scheduled from the server-relative `nextDueAtMs - remainingSnapshotAtMs` interval; the existing `/next` transaction remains the only client-triggered merge/claim path, so no fixed polling is introduced and client/server wall-clock skew is irrelevant. Put interval unit selection in the existing i18n formatter layer and render its locale-aware output in rating buttons.

**Tech Stack:** React 19, React Router 8 revalidation, Fastify review API, SQLite queue repository, TypeScript 7, Vitest, Testing Library, Playwright, `Intl.NumberFormat` unit formatting.

## Global Constraints

- Never interact with the user's real NVDA process; verify DOM, focus, API, and Chrome automation only.
- SQLite `due_at_ms` remains the source of truth; do not add fixed learning-step assumptions or a recurring polling loop.
- Keep Arabic, English, and future locale support in the central i18n package.
- Run focused tests during TDD and `pnpm verify:full` serially for the final gate, per `AGENTS.md`.

---

### Task 1: Exact client fallback for newly due cards

**Files:**
- Modify: `apps/web/src/pages/ReviewPage.tsx`
- Modify: `apps/web/src/pages/ReviewPage.test.tsx`

**Interfaces:**
- Consumes: `ReviewPageState` waiting fields `session.currentlyRemaining`, `session.status`, and `nextDueAtMs`; existing `POST /api/v1/review-sessions/:id/next`.
- Produces: one-shot waiting-state claim behavior that immediately claims queued work or waits until the exact next due time and then asks SQLite to merge/claim it.

- [x] **Step 1: Write the failing waiting fallback test**

Add a Vitest fake-clock test that renders a waiting state with zero remaining cards and `nextDueAtMs = now + 60_000`. Assert no `/next` request before the deadline, advance to the deadline, then assert one `/next` request and focus on the returned question content without dispatching an SSE event.

- [x] **Step 2: Run the test and verify RED**

Run: `pnpm exec vitest run apps/web/src/pages/ReviewPage.test.tsx`

Expected: FAIL because the current waiting effect returns whenever `currentlyRemaining === 0`.

- [x] **Step 3: Implement the one-shot exact claim**

Replace the immediate-only waiting effect with an effect that computes:

```ts
const delayMs =
  page.session.currentlyRemaining > 0
    ? 0
    : page.nextDueAtMs === null
      ? null
      : Math.max(
          0,
          page.nextDueAtMs - page.session.remainingSnapshotAtMs,
        );
```

When non-null, convert the server-relative delay into a local monotonic deadline and schedule one `setTimeout` (sliced at the platform-safe maximum if necessary). Each slice recomputes actual elapsed time so waking a suspended device cannot add another slice. The callback posts to the existing `/next` endpoint and stores the returned canonical state. Clear the timer on effect cleanup. Retain the in-flight claim promise so SSE, focus recovery, and the timer cannot create concurrent claims; transient failures use bounded exponential retry. Defer claims and content focus while the end-session dialog is open, and reject stale claim responses after pause or finish.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm exec vitest run apps/web/src/pages/ReviewPage.test.tsx`

Expected: all ReviewPage tests pass, including no request before due and exactly one request at due.

- [x] **Step 5: Commit the due fallback independently**

```bash
git add apps/web/src/pages/ReviewPage.tsx apps/web/src/pages/ReviewPage.test.tsx
git commit -m "fix(review): claim cards when their due time arrives"
```

### Task 2: Localized human-scale rating intervals

**Files:**
- Modify: `packages/i18n/src/formatters.ts`
- Modify: `packages/i18n/src/formatters.test.ts`
- Modify: `packages/i18n/src/index.ts`
- Modify: `apps/web/src/review/RatingButtons.tsx`
- Create: `apps/web/src/review/RatingButtons.test.tsx`

**Interfaces:**
- Produces: `formatReviewInterval(intervalMs: number, locale: LocaleTag): string`.
- Consumes: `OutcomePreview.intervalMs` and `i18n.language` in `RatingButtons`.

- [x] **Step 1: Write failing formatter boundary tests**

Assert English unit selection at `0`, just below/at one hour, just below/at 24 hours, just below/at 30 days, and multiple months. Assert Arabic output contains Arabic digits and the expected localized minute/hour/day/month unit. Invalid negative, fractional, or unsafe durations must throw `FORMAT_REVIEW_INTERVAL_INVALID`.

- [x] **Step 2: Run formatter tests and verify RED**

Run: `pnpm exec vitest run packages/i18n/src/formatters.test.ts`

Expected: FAIL because `formatReviewInterval` is not exported.

- [x] **Step 3: Implement centralized unit selection**

Validate a nonnegative safe integer. Select minute below `3_600_000`, hour below `86_400_000`, day below `2_592_000_000` (30 days), otherwise month. Round to the nearest selected unit with a minimum displayed count of one, then use:

```ts
new Intl.NumberFormat(formatLocale(locale), {
  style: "unit",
  unit,
  unitDisplay: "long",
}).format(count)
```

Export the formatter from `packages/i18n/src/index.ts`.

- [x] **Step 4: Test and update rating buttons**

Add a component test with minute, hour, day, and month outcomes in English and Arabic. Replace the hard-coded minute calculation and `review.minutes` lookup with `formatReviewInterval(outcome.intervalMs, i18n.language)`.

- [x] **Step 5: Run focused formatter and component tests**

Run: `pnpm exec vitest run packages/i18n/src/formatters.test.ts apps/web/src/review/RatingButtons.test.tsx`

Expected: all interval boundary and localized button-label tests pass.

- [x] **Step 6: Commit interval formatting independently**

```bash
git add packages/i18n/src/formatters.ts packages/i18n/src/formatters.test.ts packages/i18n/src/index.ts apps/web/src/review/RatingButtons.tsx apps/web/src/review/RatingButtons.test.tsx
git commit -m "feat(review): format rating intervals by human-scale units"
```

### Task 3: Regression, documentation, and release verification

**Files:**
- Modify: `README.md`
- Modify: `README.ar.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-07-28-openrecall-design.md`
- Modify: relevant Playwright review assertions if accessible button names change.

**Interfaces:**
- Consumes: completed Task 1 and Task 2 behavior.
- Produces: documented review contract and a clean serial release gate.

- [x] **Step 1: Update the product contract**

Document that the client schedules an exact `/next` fallback from stored `nextDueAtMs` without recurring polling, and that rating intervals use minute/hour/day/30-day-month units through locale-aware formatting.

- [x] **Step 2: Run focused and static checks**

Run: `pnpm exec vitest run apps/web/src/pages/ReviewPage.test.tsx apps/web/src/review/RatingButtons.test.tsx packages/i18n/src/formatters.test.ts`

Run: `pnpm check`

Expected: all pass.

- [x] **Step 3: Run the complete serial verification**

Run with an isolated port offset and stable Chrome: `pnpm verify:full`.

Expected: type/license/Vitest/build, production smoke, and all Playwright projects pass without a real NVDA interaction.

- [x] **Step 4: Request read-only code review and commit documentation**

Resolve Critical and Important findings, then commit the remaining test/docs changes with:

```bash
git add README.md README.ar.md CHANGELOG.md docs/superpowers/specs/2026-07-28-openrecall-design.md tests/e2e
git commit -m "docs: record live due and interval display contract"
```

## Self-Review

- Spec coverage: exact in-session due arrival, missed-SSE recovery, all requested duration thresholds, localization, and final Chrome verification are each mapped to a task.
- Placeholder scan: no deferred placeholders or unspecified implementation steps remain.
- Type consistency: Task 2 defines and consumes the same `formatReviewInterval(intervalMs, locale)` signature; Task 1 uses the existing `/next` `ReviewPageState` response.
