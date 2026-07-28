# OpenRecall Management and Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add complete card editing/trash/deletion and trustworthy per-card, section, session, and global statistics with accessible visual and tabular representations.

**Architecture:** Repository queries aggregate immutable review logs and current scheduler states; pure statistics functions define every denominator and missing-data rule. The React interface treats tables/text summaries as the information source and adds decorative or redundant visual charts without hiding data from screen readers.

**Tech Stack:** The Stage 1–2 stack; no charting dependency is added. CSS/SVG visualizations consume the same typed series as semantic tables.

## Global Constraints

- Editing content never creates a new scheduler identity or review history.
- Trash is indefinite and reversible; trashed items leave active queues immediately.
- Permanent deletion is a separate named confirmation and cascades atomically.
- Statistical calculations come from SQLite logs/state, never browser counters.
- “Actual recall” means ratings Hard/Good/Easy divided by all rated events in scope.
- Missing duration or retrievability values are excluded and their exclusion count is shown.
- Date grouping uses the current timezone/study boundary; immutable review instants do not change.
- Every visualization has an adjacent text summary and native data table.
- Color is never the only status indicator; RTL/LTR and 400% zoom remain usable.
- Pagination/search queries are bounded and stable.

---

### Task 1: Card Editing, Trash, Restore, and Permanent Delete Repository

**Files:**
- Create: `packages/contracts/src/cards.ts`
- Create: `packages/domain/src/cards/validate-card-edit.ts`
- Create: `packages/domain/src/cards/validate-card-edit.test.ts`
- Create: `packages/database/src/card-repository.ts`
- Create: `packages/database/src/card-repository.test.ts`

**Interfaces:**
- Produces:
  `listCards(sectionId, cursor, query, lifecycle, limit): CardPage`.
- Produces:
  `updateLearningItem(itemId, expectedUpdatedAtMs, presentations, nowMs): Card`.
- Produces: `trashItem`, `restoreItem`, `permanentlyDeleteItem`.
- Card page cursor is opaque base64url JSON of `{ updatedAtMs, id }`; maximum
  page size is 100.

- [ ] **Step 1: Write failing edit-validation tests**

Assert the primary is required, variant order is preserved, empty optional notes
normalize to null, markup is rejected by the existing domain rule, and changing
content leaves learning-item ID untouched.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/domain/src/cards`

Expected: FAIL because edit validation is missing.

- [ ] **Step 3: Implement edit validation with existing import primitives**

Reuse exported plain-text validation and normalization functions; do not fork
the rules. Return field paths rooted at `presentations[0]` and
`presentations[n]`.

- [ ] **Step 4: Write failing repository lifecycle tests**

Assert:

- Update atomically replaces variant rows but preserves the primary
  presentation ID where possible and scheduler state always.
- Stale `updated_at_ms` is rejected.
- Trash removes queued/active appearances as `removed` and never deletes logs.
- Restore does not silently add the card to a session before its due check.
- Permanent delete cascades content, state, logs, exposures, and appearances.
- Deleting one card cannot affect a sibling.

- [ ] **Step 5: Run and verify RED**

Run: `pnpm vitest run packages/database/src/card-repository.test.ts`

Expected: FAIL because repository functions are absent.

- [ ] **Step 6: Implement short immediate transactions**

For edits, update matching presentation IDs, insert new variants, and delete
removed variants inside one transaction. For trash, set lifecycle/timestamp and
mark pending appearances removed. For permanent deletion require:

```ts
{
  itemId: string;
  confirmationItemId: string;
  expectedUpdatedAtMs: number;
}
```

Reject unless both IDs are equal and the optimistic revision matches.

- [ ] **Step 7: Run and commit**

Run: `pnpm vitest run packages/domain/src/cards packages/database/src/card-repository.test.ts`

```bash
git add packages/contracts/src/cards.ts packages/domain/src/cards packages/database/src/card-repository*
git commit -m "feat: manage card content and lifecycle"
```

### Task 2: Card Management API and Accessible UI

**Files:**
- Create: `apps/server/src/routes/cards.ts`
- Create: `apps/server/src/routes/cards.test.ts`
- Create: `apps/web/src/cards/CardList.tsx`
- Create: `apps/web/src/cards/CardEditor.tsx`
- Create: `apps/web/src/cards/DeleteCardDialog.tsx`
- Create: `apps/web/src/cards/CardStatisticsDisclosure.tsx`
- Create: `apps/web/src/cards/CardList.test.tsx`
- Modify: `apps/web/src/pages/SectionPage.tsx`

**Interfaces:**
- Routes:
  `GET /api/v1/sections/:sectionId/cards`,
  `GET /api/v1/cards/:itemId`,
  `PUT /api/v1/cards/:itemId`,
  `POST /api/v1/cards/:itemId/trash`,
  `POST /api/v1/cards/:itemId/restore`,
  `DELETE /api/v1/cards/:itemId/permanent`.

- [ ] **Step 1: Write failing API tests**

Cover bounded search, cursor stability, active/trash filtering, edit conflict
`409`, queue removal after trash, restore, explicit permanent confirmation, and
response schemas that do not expose internal normalized text.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/server/src/routes/cards.test.ts`

Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement routes**

Validate every path/body/query with TypeBox. Return stable error codes
`CARD_EDIT_CONFLICT`, `CARD_NOT_FOUND`, and
`PERMANENT_DELETE_CONFIRMATION_MISMATCH`.

- [ ] **Step 4: Write failing component tests**

Assert keyboard search, native pagination links/buttons, primary/variant labels,
add/remove variant controls with visible text, persistent field errors, trash
undo, and permanent-delete dialog focus trap/restoration.

- [ ] **Step 5: Run and verify RED**

Run: `pnpm vitest run apps/web/src/cards/CardList.test.tsx`

Expected: FAIL because components are missing.

- [ ] **Step 6: Implement management UI**

Use native `<fieldset>`/`<legend>` around each presentation editor. A delete
button deletes the whole learning item and all variants, never an implicitly
selected child. Native disclosure buttons carry `aria-expanded` and
`aria-controls`.

- [ ] **Step 7: Run and commit**

Run: `pnpm vitest run apps/server/src/routes/cards.test.ts apps/web/src/cards`

```bash
git add apps/server/src/routes/cards* apps/web/src/cards apps/web/src/pages/SectionPage.tsx
git commit -m "feat: add accessible card management"
```

### Task 3: Pure Statistics Definitions

**Files:**
- Create: `packages/domain/src/statistics/types.ts`
- Create: `packages/domain/src/statistics/calculate-summary.ts`
- Create: `packages/domain/src/statistics/group-study-days.ts`
- Create: `packages/domain/src/statistics/calculate-summary.test.ts`
- Create: `packages/domain/src/statistics/statistics.property.test.ts`

**Interfaces:**
- Produces:

```ts
export interface StatisticsSummary {
  reviewEvents: number;
  uniqueItems: number;
  ratingCounts: Record<Rating, number>;
  actualRecall: number | null;
  meanPredictedRetrievability: number | null;
  retrievabilityExcluded: number;
  studyDurationMs: number;
  durationExcluded: number;
}
```

- Produces:
  `studyDayKey(epochMs, config): "YYYY-MM-DD"`.
- Produces daily activity and 30-day current-due forecast series.

- [ ] **Step 1: Write failing metric examples**

For ratings `[1,2,3,4]`, assert actual recall `0.75`; empty scope returns null,
not zero. Assert invalid/missing retrievability and duration are excluded and
counted. Assert unique items differ from review events.

- [ ] **Step 2: Write failing study-day boundary tests**

At Cairo 03:59 with boundary 04:00, assert the prior day key; at 04:00 assert
the current day. Cover DST and locale-independent ISO keys.

- [ ] **Step 3: Add property tests**

Prove rating totals equal event totals, ratios remain `[0,1]`, duration never
becomes negative, and regrouping never loses an event.

- [ ] **Step 4: Run and verify RED**

Run: `pnpm vitest run packages/domain/src/statistics`

Expected: FAIL because statistics functions are absent.

- [ ] **Step 5: Implement pure calculations**

Use integer totals and explicit nullable means. Clamp no values silently;
invalid inputs return a typed validation error during row mapping so corrupt
data cannot distort aggregates.

- [ ] **Step 6: Run and commit**

Run: `pnpm vitest run packages/domain/src/statistics`

```bash
git add packages/domain/src/statistics
git commit -m "feat: define trustworthy study metrics"
```

### Task 4: Statistics Query Repository

**Files:**
- Create: `packages/database/src/statistics-repository.ts`
- Create: `packages/database/src/statistics-repository.test.ts`
- Create: `packages/database/src/card-statistics-repository.ts`
- Create: `packages/database/src/card-statistics-repository.test.ts`

**Interfaces:**
- Produces:
  `getGlobalStatistics(filter, nowMs, studyDay): GlobalStatistics`.
- Produces:
  `getSectionStatistics(sectionId, filter, nowMs, studyDay): SectionStatistics`.
- Produces:
  `getCardStatistics(itemId, nowMs): CardStatistics`.
- Filter includes nullable `sectionId`, inclusive `fromStudyDay`, and exclusive
  `toStudyDay`.

- [ ] **Step 1: Write failing fixture-based aggregate tests**

Seed new/learning/review/relearning cards, four ratings, missing duration, two
presentations, a trashed item, and boundary-crossing timestamps. Assert every
metric and denominator against hand-calculated expected values.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/database/src/*statistics*.test.ts`

Expected: FAIL because repositories are absent.

- [ ] **Step 3: Implement bounded SQL row retrieval**

SQL calculates counts and returns only fields needed by pure domain functions.
The 30-day workload series counts active current states by the study day
containing `due_at_ms`; label this in contracts as “currently scheduled
workload forecast,” not a promise of future behavior after ratings.

- [ ] **Step 4: Implement per-card disclosure data**

Return current state/due, last review/rating, repetitions/lapses, stability,
difficulty, current retrievability, algorithm/profile source, presentation show
counts, and paginated chronological history including presentation text
snapshot/ID and rating.

- [ ] **Step 5: Verify query plans**

In tests, run `EXPLAIN QUERY PLAN` for date-range log queries, per-item history,
and due forecast. Assert the named log/item/due indexes occur and no unbounded
card-content scan is introduced.

- [ ] **Step 6: Run and commit**

Run: `pnpm vitest run packages/database/src/*statistics*.test.ts && pnpm check`

```bash
git add packages/database/src/*statistics*
git commit -m "feat: query card and study statistics"
```

### Task 5: Statistics API

**Files:**
- Create: `packages/contracts/src/statistics.ts`
- Create: `apps/server/src/routes/statistics.ts`
- Create: `apps/server/src/routes/statistics.test.ts`
- Modify: `apps/server/src/app.ts`

**Interfaces:**
- Routes:
  `GET /api/v1/statistics`,
  `GET /api/v1/sections/:sectionId/statistics`,
  `GET /api/v1/cards/:itemId/statistics`.

- [ ] **Step 1: Write failing response-contract tests**

Assert valid date filters, rejected reversed/oversized ranges, section scope,
nullable metrics, exact exclusion counters, no card content in global response,
and bounded per-card history pages.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/server/src/routes/statistics.test.ts`

Expected: FAIL because contracts/routes are missing.

- [ ] **Step 3: Define exact contracts**

Use integer count schemas, probability `0..1` unions with null, epoch
milliseconds, ISO study-day strings, and `{ labelKey, value }` summary entries.
Cap range at five years and history page at 100 events.

- [ ] **Step 4: Implement routes**

Resolve current timezone/study-boundary setting once per request and pass it to
repositories. Return `404` for missing section/item and stable validation codes
for range problems.

- [ ] **Step 5: Run and commit**

Run: `pnpm vitest run apps/server/src/routes/statistics.test.ts`

```bash
git add packages/contracts/src/statistics.ts apps/server/src/routes/statistics*
git commit -m "feat: expose scoped statistics APIs"
```

### Task 6: Accessible Statistics Views

**Files:**
- Create: `apps/web/src/statistics/MetricSummary.tsx`
- Create: `apps/web/src/statistics/AccessibleBarChart.tsx`
- Create: `apps/web/src/statistics/RatingDistribution.tsx`
- Create: `apps/web/src/statistics/ActivityTable.tsx`
- Create: `apps/web/src/statistics/WorkloadForecast.tsx`
- Create: `apps/web/src/pages/StatisticsPage.tsx`
- Create: `apps/web/src/pages/StatisticsPage.test.tsx`
- Modify: `apps/web/src/pages/SectionPage.tsx`
- Modify: `apps/web/src/cards/CardStatisticsDisclosure.tsx`
- Modify: `apps/web/src/router.tsx`

**Interfaces:**
- Produces route `/statistics`.
- `AccessibleBarChart` receives
  `{ titleKey, series, xLabelKey, yLabelKey, tableCaptionKey }`.
- The visual chart is `aria-hidden`; the native table is authoritative.

- [ ] **Step 1: Write failing accessible-chart tests**

Assert a titled summary precedes each chart, a captioned data table contains
every series value, SVG/CSS bars are ignored by accessibility APIs, and
high-contrast mode retains text labels.

- [ ] **Step 2: Write failing page-filter tests**

Assert date/section filters use labels and native controls, submission updates
URL search params, loaders refetch, focus stays on the results heading, and
empty/missing-data explanations differ from a zero result.

- [ ] **Step 3: Run and verify RED**

Run: `pnpm vitest run apps/web/src/pages/StatisticsPage.test.tsx`

Expected: FAIL because statistics views are absent.

- [ ] **Step 4: Implement summary and redundant visuals**

Use `Intl.NumberFormat`, `Intl.DateTimeFormat`, and translated plural keys.
Visual bars use CSS logical dimensions and currentColor/pattern labels. Never
put required values only in tooltip/title attributes.

- [ ] **Step 5: Implement global and section statistics**

Global page shows activity, actual/predicted retention, rating distribution,
study time, section progress, and 30-day current-schedule forecast. Section page
reuses the same components with fixed scope.

- [ ] **Step 6: Complete per-card disclosure**

Lazy-load on expansion, set `aria-busy`, render a definition list plus native
history table, and preserve the disclosure button as focus owner. Include
presentation show counts and last shown times.

- [ ] **Step 7: Run and commit**

Run: `pnpm vitest run apps/web/src/statistics apps/web/src/pages/StatisticsPage.test.tsx`

```bash
git add apps/web/src/statistics apps/web/src/pages/StatisticsPage* apps/web/src/pages/SectionPage.tsx apps/web/src/cards/CardStatisticsDisclosure.tsx apps/web/src/router.tsx
git commit -m "feat: present screen-reader-equivalent statistics"
```

### Task 7: Management and Statistics End-to-End Gate

**Files:**
- Create: `tests/e2e/management-statistics.spec.ts`
- Create: `docs/statistics/metric-definitions.md`
- Modify: `docs/accessibility/nvda-review-checklist.md`

**Interfaces:**
- Documents each metric formula, scope, denominator, exclusions, and workload
  forecast limitation.

- [ ] **Step 1: Add E2E content lifecycle flow**

Create/import a multi-presentation card, edit it, verify state/history
preservation, trash/restore it, then permanently delete a second fixture and
verify only that fixture's history disappears.

- [ ] **Step 2: Add E2E statistics flow**

Seed deterministic logs, select date/section filters, compare displayed summary
and table values with the API fixture, expand per-card statistics, and verify
keyboard navigation at 400% viewport zoom.

- [ ] **Step 3: Add axe and RTL checks**

Run every management/statistics page in Arabic RTL and English LTR. Require zero
serious/critical axe findings and ensure horizontal page scrolling is not
needed at 400% zoom except inside intentionally scrollable data tables.

- [ ] **Step 4: Document formulas**

Write exact formulas matching Task 3 and label excluded samples. Explain that
the 30-day series is based on currently stored due timestamps and changes after
future reviews.

- [ ] **Step 5: Run complete Stage 3 verification**

Run:

```bash
pnpm check
pnpm test
pnpm build
pnpm test:e2e --grep "management|statistics"
```

Expected: all lifecycle, query, API, accessibility, and E2E tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e docs/statistics docs/accessibility
git commit -m "test: verify management and statistics flows"
```

## Stage 3 Exit Gate

- [ ] Hand-calculate the seeded statistics fixture and compare every exposed
  number.
- [ ] Verify trash is reversible and permanent delete is isolated and atomic.
- [ ] Navigate every chart through its text/table equivalent with NVDA.
- [ ] Verify English and Arabic date/number/plural formatting and RTL layout.
