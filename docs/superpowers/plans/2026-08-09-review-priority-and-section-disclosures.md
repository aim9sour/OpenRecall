# Review Priority and Section Disclosures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make due intra-session learning repetitions become the next card after the active card, make End review finish directly, and make section statistics, cards, and management accessible lazy disclosures.

**Architecture:** Keep exact due-time merging and FSRS scheduling unchanged, and alter only the SQLite queue selection policy by deriving a session-repetition lane with `EXISTS`. Simplify the React review page to call the existing finish endpoint directly, then introduce a reusable mount-on-first-open disclosure plus a focused section-statistics loader so the section route fetches only its summary initially.

**Tech Stack:** TypeScript 7, React 19.2.8, React Router 8.3.0, Fastify 5.10.0, SQLite through better-sqlite3 13.0.1, Vitest 4.1.10, Testing Library 16.3.2, Playwright 1.62.0, pnpm 11.17.0, Node 24.18.0.

## Global Constraints

- Implement in the existing `feature/openrecall-implementation` worktree; do not rewrite or remove user work.
- The primary agent performs all implementation. A separate agent may perform only the final independent code review.
- Follow red-green-refactor: add each regression test, observe the intended failure, make the minimum production change, and rerun the focused test.
- Do not add dependencies, a SQLite migration, polling, a fixed review cadence, or any scheduler/FSRS calculation change.
- Preserve legacy server pause/resume compatibility, but expose no new pause action from End review.
- All new user-visible text must exist in both English and Arabic catalogs and in the typed catalog key list.
- Disclosure controls follow the W3C accordion contract: a native button inside an appropriate heading, `aria-expanded`, `aria-controls`, and a labelled panel.
- Do not query, configure, launch, stop, or otherwise interact with the owner's installed NVDA.
- Run the final gate with Node `v24.18.0` and pnpm `11.17.0`, matching `.node-version` and `packageManager`.

---

## File structure

- `packages/database/src/review-session-repository.ts` remains the sole owner of selecting and activating the next queued appearance.
- `packages/database/src/review-session-repository.test.ts` owns deterministic queue-policy regression coverage.
- `apps/server/src/routes/review.test.ts` proves the queue rule through the public shown/reveal/rate workflow and controlled clock.
- `apps/web/src/pages/ReviewPage.tsx` owns direct finish state, stale-response invalidation, and legacy resume rendering.
- `apps/web/src/pages/ReviewPage.test.tsx` owns direct-finish and asynchronous race coverage.
- Delete `apps/web/src/review/EndSessionDialog.tsx`; its pause-or-finish interaction no longer exists.
- `apps/web/src/review/session-states.test.tsx` retains WaitingState and SessionSummary coverage but drops the deleted dialog harness.
- Create `apps/web/src/sections/DisclosurePanel.tsx` as the generic accessible, mount-on-first-open UI boundary.
- Create `apps/web/src/statistics/SectionStatisticsPanel.tsx` as the only owner of lazy section-statistics fetch, loading, failure, retry, and dashboard rendering.
- `apps/web/src/pages/SectionPage.tsx` composes the three disclosure panels and keeps primary review/import actions visible.
- `apps/web/src/pages/SectionPage.test.tsx` owns initial-request, disclosure, state-preservation, keyboard, rename, and deletion integration coverage.
- `apps/web/src/router.tsx` narrows `SectionPageData` to `section` and stops eager statistics loading.
- `apps/web/src/cards/CardList.tsx` becomes disclosure content and removes its redundant outer Cards heading.
- `packages/i18n/src/catalog-keys.ts`, `packages/i18n/src/locales/en.ts`, and `packages/i18n/src/locales/ar.ts` remove dialog-only copy and add lazy statistics status/error copy.
- `apps/web/src/styles/layout.css` gives disclosure headings and panels a consistent full-width presentation without changing keyboard semantics.
- `CHANGELOG.md` records all three user-visible changes under Unreleased.

### Task 1: Prioritize due session repetitions

**Files:**
- Modify: `packages/database/src/review-session-repository.test.ts`
- Modify: `packages/database/src/review-session-repository.ts:138-155`
- Modify: `apps/server/src/routes/review.test.ts`

**Interfaces:**
- Consumes: existing `ReviewSessionRepository.claimNext(sessionId: string, nowMs: number, randomIndex?: RandomIndex): ReviewCardView | null`.
- Produces: the same public signature and return type; only queued selection order changes to session repetition first, then due time, then ID.

- [ ] **Step 1: Add the failing repository ordering test**

Extend the queue fixture helper so it can seed completed entries, then add this case before the variant-selection test:

```ts
it("claims a due session repetition before the ordinary backlog", async () => {
  await withTempDatabase((databasePath) => {
    const db = openDatabase(databasePath);
    try {
      insertFixture(db);
      insertQueueEntry(db, {
        id: "entry-completed",
        learningItemId: "item-1",
        dueAtMs: 1_000,
        status: "completed",
        presentationId: "presentation-1a",
      });
      insertQueueEntry(db, {
        id: "entry-normal",
        learningItemId: "item-2",
        dueAtMs: 1_000,
      });
      insertQueueEntry(db, {
        id: "entry-repeat",
        learningItemId: "item-1",
        dueAtMs: 4_000,
      });

      const claimed = new ReviewSessionRepository(db).claimNext(
        "session-1",
        4_000,
        () => 0,
      );

      expect(claimed?.entryId).toBe("entry-repeat");
    } finally {
      db.close();
    }
  });
});
```

Update `insertQueueEntry` so `status` accepts `"completed"`, include
`completed_at_ms` in its INSERT, and bind fixture timestamps explicitly:

```ts
input: {
  id: string;
  learningItemId: string;
  dueAtMs: number;
  status?: "queued" | "active" | "completed";
  presentationId?: string;
}

const status = input.status ?? "queued";
statement.run({
  id: input.id,
  learningItemId: input.learningItemId,
  status,
  dueAtMs: input.dueAtMs,
  activatedAtMs: status === "active" || status === "completed" ? 3_500 : null,
  presentationId:
    status === "active" || status === "completed"
      ? (input.presentationId ?? null)
      : null,
  completedAtMs: status === "completed" ? 3_600 : null,
});
```

Keep the existing tests unchanged.

- [ ] **Step 2: Add the failing public-route regression**

Add two lexically later items so the original card is claimed first, the second
card can remain active, and the third card remains as the ordinary backlog that
exposes the old defect:

```ts
const SECOND_ITEM_ID = "c8f65aa8-122b-41e1-985c-61cd3cbb3210";
const SECOND_PRESENTATION_ID = "d8f65aa8-122b-41e1-985c-61cd3cbb3210";
const THIRD_ITEM_ID = "e8f65aa8-122b-41e1-985c-61cd3cbb3210";
const THIRD_PRESENTATION_ID = "f8f65aa8-122b-41e1-985c-61cd3cbb3210";
```

Create an `insertAdditionalDueCard(db, itemId, presentationId, front)` helper
that inserts one active learning item, its primary presentation/exposure, and a
`scheduler_states` row with `due_at_ms = 1000`, `memory_state = 'new'`, revision
0, and the official profile, matching the columns already used by
`insertDueCard`. Call it for the second and third constants before building the
server. Make initial selection deterministic by assigning distinct due times:

```ts
db.prepare(
  `
    UPDATE scheduler_states
    SET due_at_ms = CASE learning_item_id
      WHEN @firstItemId THEN 800
      WHEN @secondItemId THEN 900
      WHEN @thirdItemId THEN 1000
    END
    WHERE learning_item_id IN (@firstItemId, @secondItemId, @thirdItemId)
  `,
).run({
  firstItemId: ITEM_ID,
  secondItemId: SECOND_ITEM_ID,
  thirdItemId: THIRD_ITEM_ID,
});
```

The new test starts the server with a mutable `nowMs`, then uses the public API
for both cards:

```ts
const started = await server.inject({
  method: "POST",
  url: "/api/v1/review-sessions",
  headers,
  payload: { sectionId: SECTION_ID },
});
const first = started.json<{
  session: { id: string };
  card: {
    entryId: string;
    learningItemId: string;
    presentationId: string;
    stateRevision: number;
  };
}>();
expect(first.card.learningItemId).toBe(ITEM_ID);

await server.inject({
  method: "POST",
  url: `/api/v1/review-sessions/${first.session.id}/current/shown`,
  headers,
  payload: {
    entryId: first.card.entryId,
    presentationId: first.card.presentationId,
  },
});
await server.inject({
  method: "POST",
  url: `/api/v1/review-sessions/${first.session.id}/current/reveal`,
  headers,
  payload: { entryId: first.card.entryId },
});
const ratedFirst = await server.inject({
  method: "POST",
  url: `/api/v1/review-sessions/${first.session.id}/current/rate`,
  headers,
  payload: {
    entryId: first.card.entryId,
    learningItemId: first.card.learningItemId,
    rating: 1,
    expectedStateRevision: first.card.stateRevision,
    idempotencyKey: "repeat-priority-first",
  },
});
const second = ratedFirst.json<{
  card: {
    entryId: string;
    learningItemId: string;
    presentationId: string;
    stateRevision: number;
  };
  session: { nextDueAtMs: number };
}>();
expect(second.card.learningItemId).toBe(SECOND_ITEM_ID);

await server.inject({
  method: "POST",
  url: `/api/v1/review-sessions/${first.session.id}/current/shown`,
  headers,
  payload: {
    entryId: second.card.entryId,
    presentationId: second.card.presentationId,
  },
});
await server.inject({
  method: "POST",
  url: `/api/v1/review-sessions/${first.session.id}/current/reveal`,
  headers,
  payload: { entryId: second.card.entryId },
});
nowMs = second.session.nextDueAtMs;
const afterSecondRating = await server.inject({
  method: "POST",
  url: `/api/v1/review-sessions/${first.session.id}/current/rate`,
  headers,
  payload: {
    entryId: second.card.entryId,
    learningItemId: second.card.learningItemId,
    rating: 3,
    expectedStateRevision: second.card.stateRevision,
    idempotencyKey: "repeat-priority-second",
  },
});
expect(afterSecondRating.json()).toMatchObject({
  kind: "question",
  card: { learningItemId: ITEM_ID },
  session: { repeatedWithinSession: 1 },
});
expect(afterSecondRating.json()).not.toMatchObject({
  card: { learningItemId: THIRD_ITEM_ID },
});
```

Use the `dueAtMs` returned by A's rating response rather than assuming a fixed one-minute constant. This proves compatibility with scheduler settings while reproducing the user's exact queue symptom.

- [ ] **Step 3: Run both focused tests and verify the old ordering fails**

Run:

```powershell
pnpm exec vitest run packages/database/src/review-session-repository.test.ts apps/server/src/routes/review.test.ts
```

Expected: the new repository assertion reports `entry-normal`, and the route regression returns the ordinary queued item instead of the due repetition. Existing tests remain green.

- [ ] **Step 4: Implement the minimal derived priority**

Change only `selectQueued` ordering in `review-session-repository.ts`:

```sql
ORDER BY
  EXISTS (
    SELECT 1
    FROM session_queue_entries AS completed
    WHERE completed.session_id = queue.session_id
      AND completed.learning_item_id = queue.learning_item_id
      AND completed.status = 'completed'
  ) DESC,
  queue.enqueued_due_at_ms,
  queue.id
LIMIT 1
```

Do not add a column, migration, update statement, scheduler predicate, or client-side reorder.

- [ ] **Step 5: Run the focused database and route tests**

Run:

```powershell
pnpm exec vitest run packages/database/src/review-session-repository.test.ts apps/server/src/routes/review.test.ts
```

Expected: all tests in both files pass, including deterministic original due-time/ID ordering and the new re-entry case.

- [ ] **Step 6: Commit the queue-policy change**

```powershell
git add -- packages/database/src/review-session-repository.ts packages/database/src/review-session-repository.test.ts apps/server/src/routes/review.test.ts
git commit -m "fix: prioritize due learning repetitions"
```

### Task 2: Make End review finish directly

**Files:**
- Modify: `apps/web/src/pages/ReviewPage.test.tsx`
- Modify: `apps/web/src/pages/ReviewPage.tsx`
- Modify: `apps/web/src/review/session-states.test.tsx`
- Delete: `apps/web/src/review/EndSessionDialog.tsx`
- Modify: `packages/i18n/src/catalog-keys.ts`
- Modify: `packages/i18n/src/locales/en.ts`
- Modify: `packages/i18n/src/locales/ar.ts`

**Interfaces:**
- Consumes: existing `POST /api/v1/review-sessions/:id/finish -> ReviewPageState` and `SessionSummary` rendering.
- Produces: `finish(): void` as the direct click handler for active question, answer, and waiting states; legacy `resume(): void` remains unchanged.

- [ ] **Step 1: Replace dialog tests with failing direct-finish tests**

Delete tests that open, cancel, pause through, or race the old dialog. Preserve the paused-session rendering/resume tests. Add a direct completion race test:

```ts
it("finishes immediately and ignores an older due-claim response", async () => {
  vi.useFakeTimers();
  let releaseClaim: ((state: ReviewPageState) => void) | undefined;
  const claim = new Promise<ReviewPageState>((resolve) => {
    releaseClaim = resolve;
  });
  const { posts } = await renderReview(
    "en",
    {
      ...waitingForDueState,
      nextDueAtMs: 1_000,
      session: progress({
        currentlyRemaining: 0,
        newRemaining: 0,
        nextDueAtMs: 1_000,
        remainingSnapshotAtMs: 1_000,
      }),
    },
    undefined,
    (path) => {
      if (path.endsWith("/next")) return claim;
      if (path.endsWith("/finish")) return Promise.resolve(completedState);
      return undefined;
    },
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
  fireEvent.click(await screen.findByRole("button", { name: "End review" }));

  await screen.findByRole("heading", { name: "Review complete" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(posts.filter(({ path }) => path.endsWith("/finish"))).toHaveLength(1);
  expect(posts.filter(({ path }) => path.endsWith("/pause"))).toHaveLength(0);

  await act(async () => {
    releaseClaim?.(nextQuestionState);
    await claim;
  });
  expect(screen.queryByText("What comes next?")).toBeNull();
});
```

Hoist the existing completed-state fixture beside the other page states. Add a
failure-recovery test using a rejected `/finish` override:

```ts
it("restores the active review after finish fails", async () => {
  const { posts } = await renderReview("en", questionState, undefined, (path) =>
    path.endsWith("/finish")
      ? Promise.reject(new Error("temporary finish failure"))
      : undefined,
  );
  const end = await screen.findByRole("button", { name: "End review" });
  fireEvent.click(end);
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe(
    "The review could not be updated. Try again.",
  ));
  expect(screen.getByText("What is active recall?")).not.toBeNull();
  expect((end as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(end);
  await waitFor(() =>
    expect(posts.filter(({ path }) => path.endsWith("/finish"))).toHaveLength(2),
  );
});
```

Remove the `EndSessionDialog` import, React `createRef`/`useState` imports used only by its test harness, and its entire describe block from `session-states.test.tsx`.

- [ ] **Step 2: Run the review tests and verify they fail against the dialog flow**

Run:

```powershell
pnpm exec vitest run apps/web/src/pages/ReviewPage.test.tsx apps/web/src/review/session-states.test.tsx
```

Expected: direct finish is not posted on the first click because the current implementation opens the dialog; the new no-dialog assertions fail.

- [ ] **Step 3: Simplify ReviewPage and protect asynchronous state**

Remove `EndSessionDialog`, `endDialogOpen`, `pause`, dialog focus/generation refs, `openEndDialog`, and `cancelEndDialog`. Begin `finish` with a new claim generation and interaction block:

```ts
const finish = (): void => {
  if (
    page.kind === "completed" ||
    page.kind === "section-deleted" ||
    busy
  ) return;

  const generation = ++claimGeneration.current;
  const operation = ++busyOperation.current;
  interactionBlocked.current = true;
  dueDeadline.current = null;
  setBusy(true);

  void api
    .post<ReviewPageState>(
      `/api/v1/review-sessions/${encodeURIComponent(page.session.id)}/finish`,
      {},
    )
    .then((state) => {
      if (generation === claimGeneration.current) setPage(state);
    })
    .catch(() => {
      if (generation === claimGeneration.current) {
        interactionBlocked.current = false;
        setAnnouncement(t("review.error"));
        setClaimWakeRevision((revision) => revision + 1);
      }
    })
    .finally(() => {
      if (operation === busyOperation.current) setBusy(false);
    });
};
```

Pass `finish` directly to `WaitingState.onEnd` and both visible End review button `onClick` handlers. Keep the existing paused heading and Resume review compatibility paths.

- [ ] **Step 4: Remove dead dialog code and translations**

Delete `apps/web/src/review/EndSessionDialog.tsx`. Remove these catalog keys and both locale values because they have no remaining consumer:

```text
review.endDialogTitle
review.endDialogDescription
review.continueLater
review.finish
```

Keep `review.cancel`; card editing and deletion dialogs still consume it. Confirm no dialog-only reference remains:

```powershell
rg -n "EndSessionDialog|endDialog|continueLater|review\.finish" apps packages
```

Expected: no output.

- [ ] **Step 5: Run focused review and i18n tests**

Run:

```powershell
pnpm exec vitest run apps/web/src/pages/ReviewPage.test.tsx apps/web/src/review/session-states.test.tsx packages/i18n/src
```

Expected: all focused tests pass; completion summary keeps focus through its existing heading effect; legacy paused WaitingState remains resumable.

- [ ] **Step 6: Commit direct finishing**

```powershell
git add -- apps/web/src/pages/ReviewPage.tsx apps/web/src/pages/ReviewPage.test.tsx apps/web/src/review/session-states.test.tsx apps/web/src/review/EndSessionDialog.tsx packages/i18n/src/catalog-keys.ts packages/i18n/src/locales/en.ts packages/i18n/src/locales/ar.ts
git commit -m "fix: finish review sessions directly"
```

### Task 3: Add accessible lazy section disclosures

**Files:**
- Create: `apps/web/src/sections/DisclosurePanel.tsx`
- Create: `apps/web/src/statistics/SectionStatisticsPanel.tsx`
- Modify: `apps/web/src/pages/SectionPage.test.tsx`
- Modify: `apps/web/src/pages/SectionPage.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/cards/CardList.tsx`
- Modify: `apps/web/src/styles/layout.css`
- Modify: `packages/i18n/src/catalog-keys.ts`
- Modify: `packages/i18n/src/locales/en.ts`
- Modify: `packages/i18n/src/locales/ar.ts`

**Interfaces:**
- Produces: `DisclosurePanel({ id, label, children }: { id: string; label: string; children: ReactNode }): JSX.Element`, which renders a persistent hidden panel shell and mounts `children` only after first expansion.
- Produces: `SectionStatisticsPanel({ api, sectionId }: { api: ApiClient; sectionId: string }): JSX.Element`, which fetches `/api/v1/sections/:id/statistics` on mount and owns retry state.
- Changes: `SectionPageData` becomes `{ readonly section: SectionSummary }`.
- Consumes: unchanged `CardList({ api, sectionId })` public props; its redundant internal Cards heading is removed because the disclosure supplies the label.

- [ ] **Step 1: Rewrite SectionPage tests for lazy initial behavior**

Extract the repeated route setup into a local helper with an injectable GET
function:

```ts
async function renderSection(
  get = vi.fn(async (path: string) => {
    if (path === `/api/v1/sections/${section.id}`) return section;
    if (path === `/api/v1/sections/${section.id}/statistics`) return statistics;
    return { items: [], nextCursor: null } satisfies CardPage;
  }),
) {
  const api: ApiClient = {
    bootstrap: async () => ({
      apiVersion: 1,
      csrfToken: "token",
      databaseRevision: 1,
      locale: "en",
      localeUpdatedAtMs: 0,
    }),
    get: async <T,>(path: string) => (await get(path)) as T,
    patch: async <T,>() => ({}) as T,
    post: async <T,>() => ({}) as T,
    put: async <T,>() => ({}) as T,
    delete: async <T,>() => undefined as T,
  };
  const i18n = await createI18n("en");
  const router = createMemoryRouter(createRoutes({ api, i18n }), {
    initialEntries: [`/sections/${section.id}`],
  });
  render(<RouterProvider router={router} />);
  return { api, get, router, user: userEvent.setup() };
}
```

Replace the eager-dashboard test with assertions that route entry requests only the section summary:

```ts
expect(await screen.findByRole("heading", { level: 1, name: "Biology" })).not.toBeNull();

for (const name of ["Section statistics", "Cards", "Section management"]) {
  expect(screen.getByRole("button", { name }).getAttribute("aria-expanded"))
    .toBe("false");
}
expect(get).toHaveBeenCalledTimes(1);
expect(get).toHaveBeenCalledWith(`/api/v1/sections/${section.id}`);
expect(screen.queryByText("100%")).toBeNull();
expect(screen.queryByRole("textbox", { name: "Section name" })).toBeNull();
```

Add a test that opens Statistics with Enter, observes its data, collapses it,
and reopens without another request:

```ts
const statisticsButton = screen.getByRole("button", {
  name: "Section statistics",
});
statisticsButton.focus();
await user.keyboard("{Enter}");
expect(await screen.findByText("100%")).not.toBeNull();
await user.click(statisticsButton);
expect(screen.queryByText("100%")).toBeNull();
await user.click(statisticsButton);
expect(await screen.findByText("100%")).not.toBeNull();
expect(get.mock.calls.filter(([path]) =>
  path === `/api/v1/sections/${section.id}/statistics`,
)).toHaveLength(1);
```

Then exercise Cards with the same mount-preservation rule:

```ts
const cardsButton = screen.getByRole("button", { name: "Cards" });
await user.click(cardsButton);
await screen.findByText("No cards matched this view.");
await user.click(cardsButton);
expect(screen.queryByText("No cards matched this view.")).toBeNull();
await user.click(cardsButton);
expect(await screen.findByText("No cards matched this view.")).not.toBeNull();
expect(get.mock.calls.filter(([path]) =>
  String(path).startsWith(`/api/v1/sections/${section.id}/cards?`),
)).toHaveLength(1);
```

Add a statistics retry test with a first rejected request and a second
successful request:

```ts
let statisticsAttempts = 0;
const get = vi.fn(async (path: string) => {
  if (path === `/api/v1/sections/${section.id}`) return section;
  if (path === `/api/v1/sections/${section.id}/statistics`) {
    statisticsAttempts += 1;
    if (statisticsAttempts === 1) throw new Error("temporary");
    return statistics;
  }
  return { items: [], nextCursor: null } satisfies CardPage;
});
const { user } = await renderSection(get);
await screen.findByRole("heading", { level: 1, name: "Biology" });
await user.click(screen.getByRole("button", { name: "Section statistics" }));
expect((await screen.findByRole("alert")).textContent).toContain(
  "Section statistics could not be loaded.",
);
await user.click(screen.getByRole("button", { name: "Retry" }));
expect(await screen.findByText("100%")).not.toBeNull();
expect(statisticsAttempts).toBe(2);
```

Update the rename/deletion test to open Section management before querying its
textbox and checkbox. Assert collapsing it hides those controls from role
queries and reopening preserves the in-progress rename value.

- [ ] **Step 2: Run the SectionPage test and verify eager behavior fails**

Run:

```powershell
pnpm exec vitest run apps/web/src/pages/SectionPage.test.tsx
```

Expected: statistics and cards are requested immediately, disclosure buttons do not exist, and management controls are visible before expansion.

- [ ] **Step 3: Create the reusable disclosure boundary**

Create `DisclosurePanel.tsx` with a persistent controlled panel and lazy child mount:

```tsx
import { useState, type ReactNode } from "react";

export function DisclosurePanel({
  id,
  label,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [opened, setOpened] = useState(false);
  const buttonId = `${id}-button`;

  return (
    <section className="section-disclosure">
      <h2>
        <button
          id={buttonId}
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => {
            const next = !expanded;
            setExpanded(next);
            if (next) setOpened(true);
          }}
        >
          {label}
        </button>
      </h2>
      <div
        id={id}
        role="region"
        aria-labelledby={buttonId}
        hidden={!expanded}
        className="section-disclosure-panel"
      >
        {opened ? children : null}
      </div>
    </section>
  );
}
```

Do not add custom arrow-key handling; native Enter, Space, Tab, and Shift+Tab behavior matches the selected W3C pattern.

- [ ] **Step 4: Create the lazy statistics owner**

Create `SectionStatisticsPanel.tsx` with `statistics`, `busy`, and `failed`
state. Its mount effect invokes a `useCallback` load function depending only
on `api` and `sectionId`, so changing locale does not cause a data reload.
Render:

```tsx
{busy && statistics === null && (
  <p role="status">{t("section.statistics.loading")}</p>
)}
{failed && (
  <div role="alert">
    <p>{t("section.statistics.loadError")}</p>
    <button type="button" disabled={busy} onClick={() => void load()}>
      {t("serverUnavailable.retry")}
    </button>
  </div>
)}
{statistics !== null && <StatisticsDashboard statistics={statistics} />}
```

The request is exactly:

```ts
api.get<StudyStatistics>(
  `/api/v1/sections/${encodeURIComponent(sectionId)}/statistics`,
)
```

Add `section.statistics.loading` and `section.statistics.loadError` to the typed catalog and both locales. English copy: `Loading section statistics…` and `Section statistics could not be loaded.` Arabic copy: `جارٍ تحميل إحصاءات القسم…` and `تعذّر تحميل إحصاءات القسم.`

- [ ] **Step 5: Compose the three disclosures and narrow the route loader**

Change `SectionPageData` to contain only `section`. Replace eager content with:

```tsx
<DisclosurePanel id="section-statistics" label={t("section.statistics")}>
  <SectionStatisticsPanel api={api} sectionId={currentSection.id} />
</DisclosurePanel>
<DisclosurePanel id="section-cards" label={t("card.listTitle")}>
  <CardList api={api} sectionId={currentSection.id} />
</DisclosurePanel>
<DisclosurePanel
  id="section-management"
  label={t("section.management.heading")}
>
  <SectionManagementPanel
    api={api}
    section={currentSection}
    onRenamed={setCurrentSection}
    onDeleted={() => {
      navigate("/", {
        replace: true,
        state: { announcementKey: "section.delete.success" },
      });
    }}
  />
</DisclosurePanel>
```

Keep Import cards and Start review before these disclosures. In `router.tsx`, remove `StudyStatistics` from the section loader and return only:

```ts
loader: async ({ params }): Promise<SectionPageData> => ({
  section: await api.get<SectionSummary>(
    `/api/v1/sections/${encodeURIComponent(params["sectionId"] ?? "")}`,
  ),
}),
```

Change the outer `CardList` `<section aria-labelledby="cards-heading">` to a
plain `<div>` and remove its `cards-heading` `<h2>`; the enclosing labelled
disclosure region becomes its structural owner. Do not change card pagination,
search, edit, statistics, trash, or delete behavior.

- [ ] **Step 6: Add compact disclosure styling**

Add rules using existing tokens only:

```css
.section-disclosure {
  margin-block: var(--space-4);
}

.section-disclosure > h2 {
  margin: 0;
}

.section-disclosure > h2 > button {
  inline-size: 100%;
  text-align: start;
}

.section-disclosure-panel {
  padding: clamp(var(--space-4), 2vw, var(--space-5));
  border: var(--border-width) solid var(--color-border);
  border-block-start: 0;
  border-radius: 0 0 var(--radius-md) var(--radius-md);
  background: var(--color-surface);
}
```

Verify RTL relies on logical properties and `text-align: start`; do not add direction-specific duplication.

- [ ] **Step 7: Run focused section, card, i18n, and axe-related tests**

Run:

```powershell
pnpm exec vitest run apps/web/src/pages/SectionPage.test.tsx apps/web/src/cards/CardList.test.tsx packages/i18n/src
```

Expected: all focused tests pass. In SectionPage assertions, collapsed descendants are absent from accessible role queries, reopening does not issue duplicate requests, and no duplicate Cards level-two heading exists.

- [ ] **Step 8: Commit the lazy section page**

```powershell
git add -- apps/web/src/sections/DisclosurePanel.tsx apps/web/src/statistics/SectionStatisticsPanel.tsx apps/web/src/pages/SectionPage.tsx apps/web/src/pages/SectionPage.test.tsx apps/web/src/router.tsx apps/web/src/cards/CardList.tsx apps/web/src/styles/layout.css packages/i18n/src/catalog-keys.ts packages/i18n/src/locales/en.ts packages/i18n/src/locales/ar.ts
git commit -m "feat: add lazy section disclosures"
```

### Task 4: Document, verify, and independently review

**Files:**
- Modify: `CHANGELOG.md`
- Modify only if review identifies a defect: files already named in Tasks 1-3 and their focused tests.

**Interfaces:**
- Consumes: all task deliverables and existing `pnpm verify:full` release gate.
- Produces: a clean worktree whose behavior and documentation agree, with an independent read-only review report and any accepted fixes covered by regression tests.

- [ ] **Step 1: Update Unreleased changelog**

Replace `No changes yet.` with:

```markdown
### Changed

- Section statistics, cards, and management are now collapsed by default and
  load their heavy content only when opened.
- End review now finishes the session immediately instead of opening a
  pause-or-finish dialog.

### Fixed

- Learning repetitions that become due during a review now appear immediately
  after the active card instead of waiting behind the original session backlog.
```

- [ ] **Step 2: Run static checks and the complete unit/integration suite**

First activate Node `24.18.0` from `.node-version`, then run:

```powershell
node --version
pnpm --version
pnpm check
pnpm test
```

Expected versions: `v24.18.0` and `11.17.0`. Expected results: TypeScript checks pass and every Vitest test passes with zero unhandled errors.

- [ ] **Step 3: Run production build, smoke, and browser accessibility gates**

Run:

```powershell
pnpm build
node scripts/smoke-production.mjs --skip-build
pnpm test:e2e
```

Expected: production build succeeds, smoke returns success, all Playwright scenarios pass, and axe reports no serious or critical accessibility violations. These tests use browser automation only and must not start or control NVDA.

- [ ] **Step 4: Inspect the final diff and commit documentation**

Run:

```powershell
git diff --check
git status --short
git diff HEAD~3 --stat
git add -- CHANGELOG.md
git commit -m "docs: record review and section usability changes"
```

Expected: no whitespace errors; only planned files are changed before the changelog commit.

- [ ] **Step 5: Request an independent code review**

Invoke `superpowers:requesting-code-review` and dispatch one independent reviewer agent in read-only review mode. Give it the design spec, this plan, base commit `221ba6a`, and current HEAD. Require findings ordered by severity with file/line evidence, explicit checks for queue starvation/regression, stale async finish responses, disclosure accessibility, lazy request counts, Arabic/English parity, and no NVDA interaction.

The reviewer must not edit files. The primary agent evaluates findings with `superpowers:receiving-code-review`; any accepted defect gets a failing regression test, minimal primary-agent fix, focused rerun, and a normal follow-up commit.

- [ ] **Step 6: Rerun the final release-equivalent gate after review fixes**

Run under Node `v24.18.0`:

```powershell
pnpm verify:full
git status --short
```

Expected: `verify:full` exits 0, every unit/integration/build/smoke/E2E gate passes, and `git status --short` is empty.

- [ ] **Step 7: Prepare the completion handoff**

Report the exact commits, focused and full verification counts/output, independent review result, remaining compatibility note that legacy paused sessions remain resumable, and links to the design and plan. Do not claim a release or push unless the user separately requests publishing.
