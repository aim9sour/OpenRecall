# OpenRecall 1.0.1 Windows Runtime Correctness Design

Date: 2026-08-09

Status: Approved for implementation

## Objective

Publish a stable `v1.0.1` patch that makes the Windows normal and portable
launchers open the application reliably, removes misleading browser-cache
updates, and guarantees that section and review empty-state information comes
from canonical SQLite state at the relevant time.

## Confirmed product decisions

- Keep `OpenRecall.cmd` and `OpenRecall-Portable.cmd`. A `.bat` file is not a
  modernization, a `.ps1` file is not a reliable double-click entry point, and
  an unsigned custom `.exe` adds packaging and Windows reputation costs without
  improving the local application itself.
- Open the URL with the browser registered as the Windows default. Do not locate
  or invoke `chrome.exe` directly.
- Retire offline PWA caching and its in-application update prompt permanently.
- Replace the old `/sw.js` at the same URL with a self-destroying compatibility
  worker so existing `v1.0.0` browser profiles remove the old worker and its
  caches safely.
- Publish the fixes as a new immutable stable release, `v1.0.1`; do not alter
  `v1.0.0`.
- Do not query, configure, launch, or otherwise control the owner's NVDA.

## Root-cause findings

### Section summaries are hard-coded incorrectly

`SectionRepository` currently queries only `sections` and `learning_items`.
`mapSummary` then assigns `dueNow: 0`, while `new_count` counts every active
learning item regardless of scheduler memory state. The `nowMs` argument is
validated but never participates in the summary query. Consequently the home
page can present a definite zero even when scheduler states are already due.

### The first queued card is not claimed before the create response

`startOrResumeSession` merges due learning items into
`session_queue_entries`, but the `POST /api/v1/review-sessions` route calls
`pageState` before `ReviewSessionRepository.claimNext`. `pageState` therefore
finds no active appearance and returns `kind: "waiting"` even when
`currentlyRemaining` is positive. The React effect notices that count and
immediately posts to `/next`, which causes the visible false empty-state flash.

### PWA cache versions are independent of portable files

The application registers a prompt-mode Workbox service worker for the fixed
origin `http://127.0.0.1:3210`. Its update operation installs newly built web
assets into browser Cache Storage; it does not replace the extracted normal or
portable application files. A later start can therefore serve one version from
disk while another worker/cache version is active or waiting at the same
origin. That creates repeated update prompts and can make an older on-disk build
look like an update after a cached build was activated.

This follows the documented service-worker registration lifecycle: a
registration is scoped to an origin and holds installing, waiting, and active
workers independently of the local ZIP directory. The official
`vite-plugin-pwa` removal path is a worker with `selfDestroying: true`, which
replaces the previous worker at the same name, deletes its caches, and
unregisters itself.

### Browser launch discovery is unnecessary and brittle

The launcher enumerates three conventional Chrome paths before falling back to
`Start-Process $origin`. Chrome may be registered through Windows without
residing at one of those paths. Microsoft documents that `Start-Process` uses
the application associated with a non-executable target, so the URL itself is
the stable integration point.

The launcher already polls `/api/v1/health` before opening a browser. The
reported dead-server page is consistent with the user manually opening the URL
after automatic launch failed. Removing browser discovery makes the existing
readiness barrier effective for the ordinary double-click flow.

## Design

### 1. Windows launcher boundary

The two `.cmd` files remain minimal double-click wrappers around
`Start-OpenRecall.ps1`. PowerShell remains the single owner of data-directory
selection, environment setup, process lifetime, health polling, and browser
launch.

`Open-OpenRecallBrowser` will make one shell-associated URL launch after the
health endpoint has returned HTTP 200. It will not inspect Program Files,
`LOCALAPPDATA`, the registry, PATH, or browser executables. A launch error will
produce a stable launcher error code and terminate the just-started server,
rather than printing a URL and pretending startup succeeded.

The existing `OPENRECALL_LAUNCHER_NO_BROWSER=1` automation boundary remains.
The package smoke test will additionally exercise an injected opener boundary
that records the requested URL without opening a real user browser. The record
must be created only after the health check succeeds. Production behavior with
no injection uses Windows shell association.

The 30-second readiness deadline remains a failure ceiling, not an arbitrary
startup delay. Polling stops as soon as health is successful. The browser opens
once, after which the launcher continues to own the server process until the
window closes or Ctrl+C is received.

### 2. Service-worker retirement

The web application will no longer import `virtual:pwa-register`, construct a
service-worker update controller, or render `UpdatePrompt`. Translation keys
and component/controller tests that exist only for the old update experience
will be removed.

The Vite PWA configuration will retain the existing worker filename `sw.js`
and set `selfDestroying: true`. No application code will register a new worker.
The generated compatibility worker exists so browsers with the `v1.0.0`
registration can update the same URL, activate the replacement, delete Workbox
caches, unregister, and navigate controlled clients back to network-served
assets. A browser profile that never used `v1.0.0` will not acquire a worker.

SQLite data, backups, and logs are outside browser storage and cannot be
removed by the compatibility worker. The design will not send
`Clear-Site-Data`, because that would also clear unrelated origin storage and
has incomplete browser support.

The old PWA end-to-end assertions will be replaced by a production-build test
that checks the generated worker is self-destroying, contains no precache
manifest or fetch handler, and that the built application contains no update
prompt registration path. A browser migration test will install a fixture old
worker/cache at the same origin and verify that the compatibility worker leaves
no registration or OpenRecall cache after activation.

### 3. Canonical section summaries

`SectionRepository` summary SQL will join active learning items to their
scheduler states and bind `nowMs` into the query. For each section it will
return:

- `total`: active learning items;
- `new`: active items whose scheduler state is `memory_state = 'new'`;
- `dueNow`: active items whose `due_at_ms <= nowMs`;
- `nextDueAtMs`: the minimum `due_at_ms` strictly greater than `nowMs`, or
  `null`.

The same query semantics apply to list and single-section reads so home,
section details, and post-rename responses cannot disagree. Counts include each
learning item once and ignore trashed/deleted cards through the active lifecycle
predicate.

The home page will revalidate its route at the earliest non-null
`nextDueAtMs`. It will use a monotonic deadline and the platform's maximum timer
limit so clock changes and very distant dates do not cause early or overflowing
timers. It will also revalidate on window focus and when the document becomes
visible. Revalidation replaces the full server snapshot; the client will not
increment counts speculatively.

### 4. Truthful first review state

After `startOrResumeSession` merges due entries, the create-session route will
call `claimNext(sessionId, nowMs)` before constructing its response. If a queued
entry exists, the first response is `kind: "question"`. If no entry exists, the
first response is `kind: "waiting"` with the canonical nearest future due time.

The operation remains on the server before navigation, so the UI needs no new
loading page. `StartReviewButton` continues to expose its existing busy label
while the request is pending. The `/next` route remains responsible for claims
after ratings, timer wakes, and reconnects.

If claiming fails, the create request fails rather than returning a state known
to be false. Existing API error handling displays the localized start error.
The route must rearm the due wake service and publish the resulting session
revision after the claim-visible state is established.

## Accessibility and user-visible behavior

- No new control or navigation landmark is introduced.
- The `.cmd` launcher opens one browser window only after the app is usable.
- Screen-reader focus lands directly on the first question because the initial
  route data already contains that question.
- A genuine empty session retains the existing heading and next-due
  information.
- Removing the update prompt removes an unrelated live-region interruption.
- Automated work will not interact with the owner's installed NVDA.

## Test strategy

All production changes follow red-green-refactor. Each regression test must be
observed failing for the original reason before its implementation changes.

1. Database tests seed mixed new/review, due/future, active/trashed items and
   assert both list and get summaries at exact time boundaries.
2. Route tests assert the create-session response is a question when a due
   item was just queued, and waiting only when no item can be claimed.
3. Home-page tests use a controlled clock to assert revalidation at the nearest
   due deadline and on focus/visibility recovery.
4. Production PWA tests assert the old update UI is absent and `sw.js` is a
   self-destroying, non-fetching compatibility worker. The browser migration
   scenario verifies removal of an existing registration and cache.
5. Windows package tests assert both `.cmd` wrappers are present, Chrome path
   discovery is absent, the default URL opener receives exactly one request,
   and that request occurs after health readiness.
6. Normal and portable artifact smoke tests verify database isolation and
   SQLite `quick_check` against the final ZIP.
7. The final source gate runs `pnpm verify:full` with Node `24.18.0` and stable
   Chrome. GitHub CI, Windows smoke, CodeQL, dependency review, lockfile and
   license gates must all pass at the release commit.

## Versioning and release

All public and internal workspace package manifests, package scripts,
distribution readme text, changelog, release metadata, and documentation will
identify version `1.0.1`. No database migration is required; the existing
SQLite schema and `Data` directory are preserved.

The release workflow will build `OpenRecall-v1.0.1-windows-x64.zip` and its
SHA-256 file from an annotated `v1.0.1` tag after hosted checks pass. The public
artifact will be downloaded again, its digest verified, and both launch modes
smoke-tested before the release is declared complete. The immutable `v1.0.0`
release remains unchanged.

## Non-goals

- No automatic GitHub release downloader or in-place updater.
- No new native or .NET launcher executable.
- No browser selection setting; Windows owns the default association.
- No offline application shell or installable PWA promise.
- No database schema or scheduler behavior change.
- No code-signing program in this patch.

## References

- Microsoft `Start-Process` documentation:
  <https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process>
- Microsoft PowerShell script and execution-policy documentation:
  <https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_scripts>
- Vite PWA service-worker removal guidance:
  <https://vite-pwa-org.netlify.app/guide/unregister-service-worker>
- W3C Service Workers lifecycle specification:
  <https://www.w3.org/TR/service-workers/>
