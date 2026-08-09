# OpenRecall 1.0.1 Windows Runtime Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship OpenRecall `v1.0.1` with truthful due-card summaries, an immediate first review card, reliable default-browser launch after server readiness, and permanent retirement of the stale PWA update path.

**Architecture:** Keep the existing loopback Fastify server, React Router client, SQLite database, and thin CMD-to-PowerShell Windows launcher. Fix truth at its owning boundary: SQLite computes section scheduling summaries, the review creation route claims the first card, React revalidates summaries when time or visibility changes, the PowerShell launcher opens the Windows default browser only after health succeeds, and Vite emits a one-time self-destroying compatibility worker without registering a new worker.

**Tech Stack:** Node.js 24.18.x, pnpm 11.17.0, TypeScript 7, React 19, React Router 7, Fastify 5, SQLite/better-sqlite3, Vitest 4, Playwright 1.62, Vite 8, vite-plugin-pwa 1.2, PowerShell 5.1+, GitHub Actions, GitHub CLI.

## Global Constraints

- Preserve the user's SQLite data in normal and portable modes; this release has no database migration.
- Never invoke, configure, stop, or otherwise touch the user's NVDA installation.
- Keep `OpenRecall.cmd` and `OpenRecall-Portable.cmd` as the double-click entry points. They are the reliable Windows shell bridge; the implementation remains in `Start-OpenRecall.ps1`.
- Open the URL with the Windows default HTTP handler. Do not locate or launch `chrome.exe` directly.
- Do not claim readiness or open a browser before `GET /api/v1/health` returns HTTP 200.
- Do not register a service worker in a fresh profile. Keep `/sw.js` only as the same-URL self-destroying migration for profiles that ran `v1.0.0`.
- Run every behavioral change test-first. Observe the focused test fail for the intended reason before editing production code.
- Use exact Node 24.18.x and pnpm 11.17.0 for release verification.
- Publish a new immutable `v1.0.1`; do not replace or mutate `v1.0.0`.
- Keep commits small and use author `Abdullah Mansour <abdullahmansour.marketing@gmail.com>`.

## File Map

- `packages/database/src/section-repository.ts`: canonical SQL for active, new, due-now, and next-due section statistics.
- `packages/database/src/section-repository.test.ts`: time-bound and lifecycle-bound summary regressions.
- `apps/web/src/pages/HomePage.tsx`: time, focus, and visibility revalidation of section summaries.
- `apps/web/src/pages/HomePage.test.tsx`: fake-clock regressions for due-time revalidation.
- `apps/server/src/routes/review.ts`: claim the first queued card before returning a newly created session.
- `apps/server/src/routes/review.test.ts`: prove the first create response is already a question and leaks no answer.
- `apps/web/vite.config.ts`: emit a self-destroying compatibility `/sw.js`.
- `apps/web/src/main.tsx`, `apps/web/src/router.tsx`, `apps/web/src/app/AppShell.tsx`: remove PWA registration/update-controller wiring.
- `apps/web/src/pwa/*`: delete the obsolete update prompt and controller; retain only build coverage.
- `packages/i18n/src/catalog-keys.ts`, `packages/i18n/src/locales/ar.ts`, `packages/i18n/src/locales/en.ts`: remove unreachable update-prompt messages.
- `tests/e2e/pwa.spec.ts`: verify an old same-origin worker and caches are removed by the compatibility worker.
- `distribution/windows/Start-OpenRecall.ps1`: open the default browser after health and expose a harmless marker seam for package smoke tests.
- `tests/ci/windows-package.test.ts`, `scripts/smoke-windows-package.mjs`: verify no browser-specific path remains and both packaged modes open only after readiness.
- Workspace `package.json` files, `README.md`, Windows getting-started guides, `distribution/windows/README.txt`, `CHANGELOG.md`, `docs/releases/v1.0.1.md`: version and release documentation.
- `scripts/release/windows-package-core.mjs`, `tests/ci/release-gates.test.ts`, `tests/ci/windows-package.test.ts`, `tests/documentation/documentation.test.ts`: packaging and version gate updates.

---

### Task 1: Make SQLite section summaries canonical

**Files:**

- Modify: `packages/database/src/section-repository.test.ts`
- Modify: `packages/database/src/section-repository.ts`

- [ ] **Step 1: Add a failing mixed-state summary test**

Add a test that creates one section and inserts these scheduler-backed learning items:

```ts
const rows = [
  ["new-due", "active", 2_000, "new"],
  ["review-due", "active", 2_000, "review"],
  ["review-future", "active", 3_000, "review"],
  ["trashed-due", "trashed", 1_000, "review"],
] as const;

for (const [id, lifecycle, dueAtMs, memoryState] of rows) {
  db.prepare(`
    INSERT INTO learning_items
      (id, section_id, lifecycle, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, 1000, 1000)
  `).run(id, section.id, lifecycle);
  db.prepare(`
    INSERT INTO scheduler_states
      (learning_item_id, section_id, due_at_ms, memory_state, step_index,
       stability, difficulty, elapsed_days_at_last_review, scheduled_days,
       last_review_at_ms, repetitions, lapses, revision, algorithm_id,
       algorithm_version, adapter_version, parameter_profile_id)
    VALUES (?, ?, ?, ?, NULL, 0, 0, 0, 0, NULL, 0, 0, 0,
            'FSRS-6', '6.0', 1, 'official-fsrs6-v1')
  `).run(id, section.id, dueAtMs, memoryState);
}

expect(repository.listSections(2_000)[0]).toMatchObject({
  counts: { total: 3, new: 1, dueNow: 2 },
  nextDueAtMs: 3_000,
});
expect(repository.getSection(section.id, 3_000)).toMatchObject({
  counts: { total: 3, new: 1, dueNow: 3 },
  nextDueAtMs: null,
});
```

- [ ] **Step 2: Run the focused test and confirm the intended failure**

Run:

```powershell
pnpm vitest run packages/database/src/section-repository.test.ts
```

Expected: the new assertion fails because `new` equals every active item, `dueNow` is hard-coded to zero, and `nextDueAtMs` is null.

- [ ] **Step 3: Parameterize the summary SQL by `nowMs`**

Extend `SectionSummaryRow` with `due_count` and `next_due_at_ms`. Join `scheduler_states` by learning item and section, then calculate:

```sql
count(learning_items.id) AS total_count,
count(learning_items.id) FILTER (
  WHERE scheduler_states.memory_state = 'new'
) AS new_count,
count(learning_items.id) FILTER (
  WHERE scheduler_states.due_at_ms <= @nowMs
) AS due_count,
min(scheduler_states.due_at_ms) FILTER (
  WHERE scheduler_states.due_at_ms > @nowMs
) AS next_due_at_ms
```

Prepare both statements with named parameters. Call list with `{ nowMs }` and get with `{ sectionId, nowMs }`. Map `due_count` and `next_due_at_ms` directly into `SectionSummary`.

- [ ] **Step 4: Keep delete conflict checks compatible with the parameterized query**

Inside `deleteSection`, call `getSection(input.sectionId, input.expectedUpdatedAtMs)` for the revision check instead of using the old positional `#get` statement. Preserve the transaction and cascading delete behavior.

- [ ] **Step 5: Run database verification**

Run:

```powershell
pnpm vitest run packages/database/src/section-repository.test.ts packages/database/src/migrations/006-section-deletion.test.ts
pnpm --filter @openrecall/database check
```

Expected: all selected tests and the database typecheck pass.

- [ ] **Step 6: Commit the canonical summary fix**

```powershell
git add packages/database/src/section-repository.ts packages/database/src/section-repository.test.ts
git commit -m "fix: compute truthful section review summaries"
```

---

### Task 2: Revalidate the home page when due time changes

**Files:**

- Modify: `apps/web/src/pages/HomePage.test.tsx`
- Modify: `apps/web/src/pages/HomePage.tsx`

- [ ] **Step 1: Make the home test harness mutable and observable**

Allow `renderHome` to accept a `get` implementation. In a new fake-timer test, return one section with `dueNow: 0` and `nextDueAtMs: 2_000`, advance the clock to the deadline, and then return `dueNow: 1` and `nextDueAtMs: null`. Record calls to `/api/v1/sections`.

Use this assertion shape:

```ts
vi.useFakeTimers();
vi.setSystemTime(1_000);
const sectionRequests: string[] = [];
let dueNow = 0;
await renderHome(undefined, "/", async <T,>(path: string) => {
  sectionRequests.push(path);
  return [{ ...sections[0]!, counts: { ...sections[0]!.counts, dueNow },
    nextDueAtMs: dueNow === 0 ? 2_000 : null }] as T;
});

dueNow = 1;
await vi.advanceTimersByTimeAsync(1_000);
await waitFor(() => expect(screen.getByText("Due now").nextElementSibling?.textContent).toBe("1"));
expect(sectionRequests.filter((path) => path === "/api/v1/sections")).toHaveLength(2);
```

Restore real timers in `afterEach` so other accessibility tests remain deterministic.

- [ ] **Step 2: Add focus and visibility regression assertions**

In a second test, dispatch `window.focus` and `document.visibilitychange` after returning the page to visible state. Assert each event causes one revalidation, while a hidden document does not claim that data is current.

- [ ] **Step 3: Run the focused test and confirm no revalidation occurs yet**

```powershell
pnpm vitest run apps/web/src/pages/HomePage.test.tsx
```

Expected: the timer/focus assertions fail because `HomePage` never calls React Router's revalidator.

- [ ] **Step 4: Implement a single reschedulable revalidation effect**

Import `useRevalidator`, calculate the earliest non-null future `nextDueAtMs`, and schedule one timeout. Convert the initial wall-clock difference into a `performance.now()` deadline, and compare only that monotonic clock while the timer is active. On timeout, window focus, or visible `visibilitychange`, call `revalidate()`. Clear the timeout and listeners during cleanup. After loader data changes, the effect schedules the next earliest deadline.

Use a monotonic delay calculation and clamp the delay to the platform timer maximum:

```ts
const MAX_TIMEOUT_MS = 2_147_483_647;
const deadline = performance.now() + Math.max(0, earliestNextDueAtMs - Date.now());
const delayMs = Math.min(MAX_TIMEOUT_MS, Math.max(0, deadline - performance.now()));
```

Do not add polling and do not display a temporary zero state while a revalidation is loading; retain the last confirmed loader data until the new loader result arrives.

- [ ] **Step 5: Run home and route tests**

```powershell
pnpm vitest run apps/web/src/pages/HomePage.test.tsx apps/web/src/app/AppShell.test.tsx
pnpm --filter @openrecall/web check
```

Expected: all selected tests and web typecheck pass.

- [ ] **Step 6: Commit time-aware home summaries**

```powershell
git add apps/web/src/pages/HomePage.tsx apps/web/src/pages/HomePage.test.tsx
git commit -m "fix: refresh section summaries at due time"
```

---

### Task 3: Return the first review question from session creation

**Files:**

- Modify: `apps/server/src/routes/review.test.ts`
- Modify: `apps/server/src/routes/review.ts`

- [ ] **Step 1: Change the route regression to require an immediate question**

Replace the initial `kind: "waiting"` expectation and first `/next` request with:

```ts
const question = started.json<{
  kind: string;
  session: { id: string; currentlyRemaining: number };
  card: {
    entryId: string;
    learningItemId: string;
    presentationId: string;
    stateRevision: number;
  };
}>();
expect(question).toMatchObject({
  kind: "question",
  session: { currentlyRemaining: 1 },
  card: {
    learningItemId: ITEM_ID,
    presentationId: PRESENTATION_ID,
    front: "PRIVATE QUESTION",
    stateRevision: 0,
  },
});
expect(started.body).not.toContain("PRIVATE ANSWER");
expect(started.body).not.toContain("PRIVATE NOTES");
const sessionId = question.session.id;
```

Keep the shown/reveal/rate/wait/pause/resume/finish assertions after this point.

- [ ] **Step 2: Run the route test and observe the waiting/question mismatch**

```powershell
pnpm vitest run apps/server/src/routes/review.test.ts
```

Expected: session creation returns `waiting`, so the new question assertion fails.

- [ ] **Step 3: Claim before rendering the create-session response**

Immediately after `startOrResumeSession` and before `pageState`, run:

```ts
options.sessions.claimNext(snapshot.id, nowMs);
```

Then publish and build `pageState`. Keep `waiting` for a truly empty session and keep the existing conflict behavior for another open session.

- [ ] **Step 4: Run server review tests and typecheck**

```powershell
pnpm vitest run apps/server/src/routes/review.test.ts packages/database/src/review-session-repository.test.ts packages/database/src/review-queue-repository.test.ts
pnpm --filter @openrecall/server check
```

Expected: the first response is a question, private answer fields remain absent, and all selected tests pass.

- [ ] **Step 5: Commit the atomic session start**

```powershell
git add apps/server/src/routes/review.ts apps/server/src/routes/review.test.ts
git commit -m "fix: claim first card when review starts"
```

---

### Task 4: Retire the browser-cached update system safely

**Files:**

- Modify: `apps/web/src/pwa/pwa-build.test.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/app/AppShell.tsx`
- Delete: `apps/web/src/pwa/UpdatePrompt.tsx`
- Delete: `apps/web/src/pwa/UpdatePrompt.test.tsx`
- Delete: `apps/web/src/pwa/register-openrecall-service-worker.ts`
- Delete: `apps/web/src/pwa/register-service-worker.ts`
- Delete: `apps/web/src/pwa/register-service-worker.test.ts`
- Modify: `packages/i18n/src/catalog-keys.ts`
- Modify: `packages/i18n/src/locales/ar.ts`
- Modify: `packages/i18n/src/locales/en.ts`

- [ ] **Step 1: Replace cache expectations with tombstone-worker expectations**

Change `pwa-build.test.ts` to build production output and assert:

```ts
const serviceWorker = await readFile(resolve(outputDirectory, "sw.js"), "utf8");
expect(serviceWorker).toMatch(/registration\.unregister/);
expect(serviceWorker).toMatch(/caches\.keys/);
expect(serviceWorker).toMatch(/caches\.delete/);
expect(serviceWorker).not.toMatch(/precacheAndRoute|NetworkOnly|SKIP_WAITING/);
```

Keep the manifest and icon dimension tests; this task removes runtime caching, not existing visual assets.

- [ ] **Step 2: Add static proof that application bundles cannot register a worker**

Read built asset JavaScript and assert it contains neither `virtual:pwa-register` behavior nor `navigator.serviceWorker.register`, and add a source-tree assertion that `main.tsx`, `router.tsx`, and `AppShell.tsx` do not import files under `src/pwa`.

- [ ] **Step 3: Run the PWA build test and confirm it fails on Workbox output**

```powershell
pnpm vitest run apps/web/src/pwa/pwa-build.test.ts
```

Expected: current `sw.js` contains precaching and does not self-unregister.

- [ ] **Step 4: Configure the same-URL self-destroying worker**

In `vite.config.ts`, retain `injectRegister: false`, retain the manifest/icons, and replace prompt/workbox configuration with:

```ts
VitePWA({
  injectRegister: false,
  selfDestroying: true,
  manifest: {
    name: "OpenRecall",
    short_name: "OpenRecall",
    description: "A private, local-first spaced-repetition study application.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#103d32",
    background_color: "#f2f7f4",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
})
```

The plugin must continue emitting `/sw.js`; that filename is the migration boundary for old registrations.

- [ ] **Step 5: Remove all client registration and prompt wiring**

Delete the five obsolete PWA/controller files. In `main.tsx`, remove registration imports, try/catch registration, and the `updates` argument. In `router.tsx`, remove the controller type/default and render `<AppShell />`. In `AppShell.tsx`, remove the `updates` prop and `<UpdatePrompt>`. Remove only the six unreachable `pwa.*` keys from both locales and the catalog key list.

- [ ] **Step 6: Run focused PWA, router, shell, and i18n tests**

```powershell
pnpm vitest run apps/web/src/pwa/pwa-build.test.ts apps/web/src/app/AppShell.test.tsx packages/i18n/src/catalog-parity.test.ts packages/i18n/src/catalog-static-analysis.test.ts
pnpm --filter @openrecall/web check
pnpm --filter @openrecall/i18n check
```

Expected: the tombstone worker is emitted, app bundles do not register it, and all selected checks pass.

- [ ] **Step 7: Commit the PWA retirement**

```powershell
git add apps/web packages/i18n
git commit -m "fix: retire stale service worker updates"
```

---

### Task 5: Prove old browser profiles clean themselves once

**Files:**

- Modify: `tests/e2e/pwa.spec.ts`

- [ ] **Step 1: Replace update-prompt E2E behavior with a same-URL migration test**

Remove both obsolete prompt/offline-shell tests from the file. Preserve the generated self-destroying `sw.js` text. Temporarily write a legacy `/sw.js` that precaches a sentinel cache, register it at scope `/`, and wait until it is active. Restore the generated `sw.js`, call `registration.update()`, and wait for both conditions:

```ts
await expect.poll(() => page.evaluate(async () =>
  (await navigator.serviceWorker.getRegistration("/")) === undefined,
)).toBe(true);

await expect.poll(() => page.evaluate(async () =>
  (await caches.keys()).length,
)).toBe(0);
```

Use a `try/finally` block to restore the generated worker even if the test fails. Do not manipulate Chrome or NVDA settings.

- [ ] **Step 2: Run the test and verify the migration against the production build**

```powershell
pnpm playwright test tests/e2e/pwa.spec.ts --project=chromium
```

Expected: the old same-origin worker updates from the same `/sw.js` URL, deletes its caches, unregisters, and does not return.

- [ ] **Step 3: Commit browser migration coverage**

```powershell
git add tests/e2e/pwa.spec.ts
git commit -m "test: verify legacy service worker cleanup"
```

---

### Task 6: Open the Windows default browser only after readiness

**Files:**

- Modify: `tests/ci/windows-package.test.ts`
- Modify: `scripts/smoke-windows-package.mjs`
- Modify: `distribution/windows/Start-OpenRecall.ps1`

- [ ] **Step 1: Strengthen the static launcher contract**

Extend the launcher test with:

```ts
expect(powerShell).not.toMatch(/chrome\.exe|Google\\Chrome/iu);
expect(powerShell).toContain("Start-Process -FilePath $origin");
expect(powerShell).toContain("OPENRECALL_LAUNCHER_BROWSER_MARKER");
```

This retains both thin CMD entry points and rejects browser-specific discovery.

- [ ] **Step 2: Make package smoke observe the browser-open boundary**

For each mode, create an absolute `browserMarker` path and pass `OPENRECALL_LAUNCHER_BROWSER_MARKER`. Remove `OPENRECALL_LAUNCHER_NO_BROWSER` in this smoke path. After `waitForReady`, wait for the marker and assert its UTF-8 content equals `http://127.0.0.1:3210`. Keep the existing database-isolation and stop-signal assertions.

- [ ] **Step 3: Run focused launcher tests and observe the intended failure**

```powershell
pnpm vitest run tests/ci/windows-package.test.ts
```

Expected: the static test fails because Chrome-specific paths still exist and no marker seam exists.

- [ ] **Step 4: Replace Chrome discovery with the default HTTP handler**

Implement:

```powershell
function Open-OpenRecallBrowser {
  if ($env:OPENRECALL_LAUNCHER_BROWSER_MARKER) {
    if (-not [IO.Path]::IsPathRooted($env:OPENRECALL_LAUNCHER_BROWSER_MARKER)) {
      throw "OPENRECALL_LAUNCHER_BROWSER_MARKER_INVALID"
    }
    [IO.File]::WriteAllText(
      $env:OPENRECALL_LAUNCHER_BROWSER_MARKER,
      $origin,
      [Text.UTF8Encoding]::new($false)
    )
    return
  }
  Start-Process -FilePath $origin -ErrorAction Stop | Out-Null
}
```

Keep the call after the health loop and ready message. Wrap browser opening so a failure signals the launcher host to stop before exiting with `OPENRECALL_BROWSER_OPEN_FAILED`; do not leave the server orphaned.

- [ ] **Step 5: Run launcher/package tests**

```powershell
pnpm vitest run tests/ci/windows-package.test.ts
pnpm test:package
```

Expected: static contracts and package unit tests pass.

- [ ] **Step 6: Commit the launcher fix**

```powershell
git add distribution/windows/Start-OpenRecall.ps1 scripts/smoke-windows-package.mjs tests/ci/windows-package.test.ts
git commit -m "fix: open default browser after server readiness"
```

---

### Task 7: Version and document the patch release

**Files:**

- Modify: `package.json`
- Modify: `apps/server/package.json`
- Modify: `apps/web/package.json`
- Modify: `packages/contracts/package.json`
- Modify: `packages/database/package.json`
- Modify: `packages/domain/package.json`
- Modify: `packages/i18n/package.json`
- Modify: `packages/optimizer/package.json`
- Modify: `packages/scheduler/package.json`
- Modify: `packages/test-support/package.json`
- Modify: `scripts/release/windows-package-core.mjs`
- Modify: `tests/ci/release-gates.test.ts`
- Modify: `tests/ci/windows-package.test.ts`
- Modify: `tests/documentation/documentation.test.ts`
- Modify: `README.md`
- Modify: `docs/getting-started/windows-en.md`
- Modify: `docs/getting-started/windows-ar.md`
- Modify: `distribution/windows/README.txt`
- Modify: `CHANGELOG.md`
- Create: `docs/releases/v1.0.1.md`

- [ ] **Step 1: Update version-gate tests first**

Change project-version expectations and release artifact examples from `1.0.0` to `1.0.1`. Do not alter third-party fixture versions such as `runtime-package/1.0.0`, invalid semantic-version examples, or dependency versions.

- [ ] **Step 2: Run release/documentation tests and observe version mismatches**

```powershell
pnpm vitest run tests/ci/release-gates.test.ts tests/ci/windows-package.test.ts tests/documentation/documentation.test.ts
```

Expected: project manifest, package script, launcher readme, and download documentation assertions fail at `1.0.0`.

- [ ] **Step 3: Bump every first-party manifest and packaging boundary**

Set all ten first-party package versions to `1.0.1`, change root `package:windows` to `--version 1.0.1`, and allow first-party license fallback only at version `1.0.1` in `windows-package-core.mjs`. Run `pnpm install --lockfile-only` only if pnpm reports lockfile changes are required; do not rewrite dependency versions.

- [ ] **Step 4: Update user-facing Windows instructions**

Point the README and English/Arabic Windows guides to `OpenRecall-v1.0.1-windows-x64.zip`. State that both CMD launchers wait for health and open the user's default browser. Keep normal and portable data locations explicit.

- [ ] **Step 5: Write patch notes and changelog**

Move `Unreleased` back to “No changes yet,” add `[1.0.1] - 2026-08-09`, and document the four fixes: default-browser launch/readiness, truthful timed section summaries, immediate first review card, and one-time retirement of stale cached updates. In `docs/releases/v1.0.1.md`, include download, SHA-256, GitHub attestation, normal/portable launch, data preservation, and the service-worker cleanup explanation.

- [ ] **Step 6: Run version, documentation, and license gates**

```powershell
pnpm vitest run tests/ci/release-gates.test.ts tests/ci/windows-package.test.ts tests/documentation/documentation.test.ts
pnpm release:licenses
pnpm check
```

Expected: all version/documentation tests, license audit, and typechecks pass.

- [ ] **Step 7: Commit release metadata**

```powershell
git add package.json apps packages scripts/release tests/ci tests/documentation README.md docs/getting-started docs/releases/v1.0.1.md distribution/windows/README.txt CHANGELOG.md pnpm-lock.yaml
git commit -m "chore: prepare OpenRecall 1.0.1"
```

---

### Task 8: Run complete local verification and package both modes

**Files:**

- No source changes expected.
- Generated locally and ignored: `release-output/OpenRecall-v1.0.1-windows-x64.zip`
- Generated locally and ignored: `release-output/OpenRecall-v1.0.1-windows-x64.zip.sha256`

- [ ] **Step 1: Confirm toolchain and clean tracked state**

```powershell
node --version
pnpm --version
git status --short
```

Expected: Node is `v24.18.x`, pnpm is `11.17.0`, and only intentional committed work is present.

- [ ] **Step 2: Reinstall exactly and audit dependencies**

```powershell
pnpm install --frozen-lockfile
pnpm audit
```

Expected: frozen install succeeds and the audit has no unresolved production vulnerability that violates the release policy.

- [ ] **Step 3: Run the full serial verification gate**

```powershell
pnpm verify:full
```

Expected: typecheck, dependency licenses, unit/integration/property tests, production build smoke, Playwright, and accessibility tests all pass.

- [ ] **Step 4: Build the Windows archive**

```powershell
pnpm package:windows
```

Expected: the ZIP and SHA-256 files are generated with `v1.0.1` names and contain no SQLite database, logs, source maps, or test artifacts.

- [ ] **Step 5: Smoke both packaged launchers**

```powershell
pnpm smoke:package:windows --archive "$PWD\release-output\OpenRecall-v1.0.1-windows-x64.zip"
```

Expected output ends with `OPENRECALL_WINDOWS_PACKAGE_SMOKE_OK modes=2`; each mode reaches health before the browser marker, writes only to its intended data directory, and shuts down cleanly.

- [ ] **Step 6: Verify the published checksum input locally**

```powershell
$expected = (Get-Content -LiteralPath "$PWD\release-output\OpenRecall-v1.0.1-windows-x64.zip.sha256").Split(' ')[0]
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath "$PWD\release-output\OpenRecall-v1.0.1-windows-x64.zip").Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "OPENRECALL_RELEASE_CHECKSUM_MISMATCH" }
```

Expected: no exception.

---

### Task 9: Review the implementation before publication

**Files:**

- No source changes expected unless review finds a verified defect.

- [ ] **Step 1: Inspect the complete release diff**

```powershell
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git log --oneline --decorate origin/main..HEAD
```

Expected: no whitespace errors; commits correspond to the design, plan, four fixes, migration test, and release metadata.

- [ ] **Step 2: Apply the verification-before-completion skill**

Re-run any focused test affected by a review change. Do not accept “previously passed” as evidence after modifying code.

- [ ] **Step 3: Apply the requesting-code-review skill**

Review for correctness, privacy, data preservation, Windows process cleanup, accessibility regressions, test quality, and scope adherence. Resolve every blocking finding test-first and commit each correction separately.

- [ ] **Step 4: Re-run the release gate after review corrections**

```powershell
pnpm verify:full
pnpm package:windows
pnpm smoke:package:windows --archive "$PWD\release-output\OpenRecall-v1.0.1-windows-x64.zip"
```

Expected: every gate passes against the exact final commit.

---

### Task 10: Publish and independently verify stable v1.0.1

**Files:**

- No local source changes expected.

- [ ] **Step 1: Push a release branch and open a pull request**

```powershell
git push -u origin HEAD:release/v1.0.1
gh pr create --repo aim9sour/OpenRecall --base main --head release/v1.0.1 --title "OpenRecall 1.0.1 runtime correctness" --body-file docs/releases/v1.0.1.md
```

Expected: a pull request is created from the verified commit set.

- [ ] **Step 2: Wait for all GitHub checks and merge**

```powershell
$pr = gh pr view --repo aim9sour/OpenRecall --json number --jq .number
gh pr checks $pr --repo aim9sour/OpenRecall --watch
gh pr merge $pr --repo aim9sour/OpenRecall --squash --delete-branch
```

Expected: required Linux, Windows, package, and security checks pass before the PR is squash-merged.

- [ ] **Step 3: Tag the exact merged main commit**

```powershell
git fetch origin main --tags
$releaseCommit = git rev-parse origin/main
git tag -a v1.0.1 $releaseCommit -m "OpenRecall 1.0.1"
git push origin v1.0.1
```

Expected: annotated tag `v1.0.1` points to the merged `origin/main` commit; `v1.0.0` remains unchanged.

- [ ] **Step 4: Watch the stable release workflow**

```powershell
$runId = gh run list --repo aim9sour/OpenRecall --workflow release.yml --branch v1.0.1 --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $runId --repo aim9sour/OpenRecall --exit-status
```

Expected: the release workflow succeeds and creates a non-draft, non-prerelease immutable release.

- [ ] **Step 5: Inspect release metadata and assets**

```powershell
gh release view v1.0.1 --repo aim9sour/OpenRecall --json isDraft,isPrerelease,name,tagName,url,assets
```

Expected: tag/name are `v1.0.1`, draft and prerelease are false, and the ZIP plus SHA-256 are present.

- [ ] **Step 6: Download and verify the public artifacts independently**

```powershell
$verifyDirectory = Join-Path ([IO.Path]::GetTempPath()) ("openrecall-v1.0.1-verify-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $verifyDirectory | Out-Null
gh release download v1.0.1 --repo aim9sour/OpenRecall --dir $verifyDirectory
$zip = Join-Path $verifyDirectory "OpenRecall-v1.0.1-windows-x64.zip"
$checksum = Join-Path $verifyDirectory "OpenRecall-v1.0.1-windows-x64.zip.sha256"
$expected = (Get-Content -LiteralPath $checksum).Split(' ')[0]
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
if ($actual -ne $expected) { throw "OPENRECALL_PUBLIC_CHECKSUM_MISMATCH" }
gh attestation verify $zip -R aim9sour/OpenRecall
pnpm smoke:package:windows --archive $zip
```

Expected: checksum, GitHub provenance, normal launcher, portable launcher, readiness boundary, default-browser marker, and data isolation all verify from the downloaded public artifact.

- [ ] **Step 7: Confirm repository release state**

```powershell
gh release view v1.0.0 --repo aim9sour/OpenRecall --json tagName,url
gh release view v1.0.1 --repo aim9sour/OpenRecall --json tagName,url
git ls-remote --tags origin v1.0.0 v1.0.1
```

Expected: both immutable releases and both tags exist, with `v1.0.1` as the new stable patch.
