# OpenRecall Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the completed local application into a polished, installable, multilingual, security-hardened, documented, and continuously verified public-repository release candidate.

**Architecture:** Locale packages and semantic design tokens remain shared platform boundaries. The service worker caches only static shell assets and uses a user-controlled update lifecycle. Fastify serves the production build under a restrictive local-only security policy. Cross-platform scripts and CI reproduce build/test/recovery checks, while stable Chrome/NVDA speech remains a required manual release gate.

**Tech Stack:** The Stage 1–4 stack plus `vite-plugin-pwa@1.3.0`, `@fastify/static@10.1.2`, `@fastify/helmet@13.1.0`, and build-only `sharp@0.35.3`.

## Global Constraints

- Arabic and English catalogs are complete; a new locale requires only a locale package.
- No hard-coded user-facing or accessible copy may remain in page components.
- The application is usable at 400% zoom, in RTL/LTR, forced colors, dark/light,
  and reduced motion.
- PWA updates are prompt-based and never auto-reload an active review or dirty form.
- `/api/**` and SSE are network-only and never enter service-worker caches.
- Installed UI without the local server explains how to start OpenRecall; it never shows stale study data as current.
- Production binds only to `127.0.0.1`, validates Host/Origin/CSRF, disables CORS,
  redacts content, and makes no outbound request.
- The supported runtime is Node.js 24.18.0 LTS with pnpm 11.17.0.
- Automated accessibility checks supplement but never replace stable Chrome/NVDA manual acceptance.
- A public-use license is not invented; repository publication remains blocked until the owner chooses one explicitly.

---

### Task 1: Complete Locale Architecture and Pseudo-Locale

**Files:**
- Create: `packages/i18n/src/locales/en-XA.ts`
- Create: `packages/i18n/src/formatters.ts`
- Create: `packages/i18n/src/formatters.test.ts`
- Create: `packages/i18n/src/catalog-static-analysis.test.ts`
- Modify: `packages/i18n/src/catalog-keys.ts`
- Modify: `packages/i18n/src/locales/en.ts`
- Modify: `packages/i18n/src/locales/ar.ts`
- Create: `docs/translations/adding-a-language.md`

**Interfaces:**
- Produces locale registry:
  `registerLocale(definition: LocaleDefinition): void`.
- Produces locale-aware `formatNumber`, `formatDateTime`, `formatRelativeTime`,
  `formatDuration`, and rating/count plural helpers.
- `en-XA` is development/test only and never appears in production locale picker.

- [ ] **Step 1: Write failing catalog completeness tests**

Scan every `t("literal.key")` call in apps/packages, compare against
`CATALOG_KEYS`, and fail for missing or unused required keys. Assert Arabic and
English contain nonempty distinct values and locale metadata uses `ar`/RTL and
`en`/LTR.

- [ ] **Step 2: Write failing formatter/plural tests**

Cover all six Arabic plural categories, English singular/plural, localized
digits according to user locale, absolute/relative due time, and durations over
24 hours. Assert no formatter uses process locale implicitly.

- [ ] **Step 3: Run and verify RED**

Run: `pnpm vitest run packages/i18n`

Expected: FAIL for incomplete final catalogs/formatters.

- [ ] **Step 4: Complete catalogs and formatters**

Add every page, error, status, shortcut, setting, optimizer, backup, statistics,
PWA, and recovery key. Format using `Intl` with the explicit locale; use
`Intl.PluralRules` through i18next count interpolation.

- [ ] **Step 5: Implement pseudo-localization**

Wrap visible strings with `［…］`, expand Latin letters deterministically, and
preserve interpolation placeholders/HTML-free text. Add an E2E environment flag
that registers `en-XA` only in test/development builds.

- [ ] **Step 6: Document adding a language**

Specify one locale file, metadata, catalog parity, plural testing, direction,
screenshots/manual keyboard audit, and no component changes.

- [ ] **Step 7: Run and commit**

Run: `pnpm vitest run packages/i18n && pnpm check`

```bash
git add packages/i18n docs/translations
git commit -m "feat: complete extensible localization"
```

### Task 2: Semantic Visual System and Responsive Accessibility

**Files:**
- Create: `apps/web/src/styles/tokens.css`
- Create: `apps/web/src/styles/themes.css`
- Create: `apps/web/src/styles/layout.css`
- Create: `apps/web/src/app/ThemeProvider.tsx`
- Create: `apps/web/src/app/ThemeProvider.test.tsx`
- Create: `apps/web/src/components/StatusBadge.tsx`
- Create: `apps/web/src/components/ErrorSummary.tsx`
- Create: `apps/web/src/components/ConfirmDialog.tsx`
- Modify: `apps/web/src/styles/base.css`
- Modify: `apps/web/src/app/AppShell.tsx`
- Create: `tests/e2e/visual-accessibility.spec.ts`

**Interfaces:**
- Theme preference: `"system" | "light" | "dark"` persisted through settings API.
- Tokens cover color, typography, spacing, radius, elevation, focus, and motion.

- [ ] **Step 1: Write failing theme/component tests**

Assert theme follows system until explicitly overridden, survives reload,
updates `color-scheme`, error summary focuses only after failed submission, and
dialogs trap/restore focus with Escape cancel.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/web/src/app/ThemeProvider.test.tsx apps/web/src/components`

Expected: FAIL because system components are absent.

- [ ] **Step 3: Define semantic tokens**

Use names such as `--color-surface`, `--color-text`, `--color-accent`,
`--color-danger`, and `--focus-ring`; do not name tokens by literal color.
Ensure normal text 4.5:1 and large/UI text 3:1 contrast in both themes.

- [ ] **Step 4: Implement reusable semantic components**

All icons are decorative next to text. Status badges include text.
`ErrorSummary` uses `tabIndex={-1}` plus heading/list anchor links.
`ConfirmDialog` uses the native `<dialog>` API with tested fallback behavior.

- [ ] **Step 5: Add responsive/forced-color/reduced-motion CSS**

Use logical properties (`margin-inline`, `padding-block`), fluid type/spacing,
table scroll regions with labels, `@media (forced-colors: active)`, and
`@media (prefers-reduced-motion: reduce)`. No information depends on animation.

- [ ] **Step 6: Add visual accessibility E2E**

Exercise every route at 1280px, 320 CSS px equivalent, 400% zoom dimensions,
light/dark/system, forced-color emulation where supported, reduced motion,
English, Arabic, and pseudo-locale. Assert no page-level two-dimensional scroll.

- [ ] **Step 7: Run and commit**

Run: `pnpm vitest run apps/web/src/app apps/web/src/components && pnpm test:e2e --grep "visual accessibility"`

```bash
git add apps/web/src/styles apps/web/src/app apps/web/src/components tests/e2e/visual-accessibility.spec.ts
git commit -m "feat: add polished accessible visual system"
```

### Task 3: Prompt-Based PWA and Server-Unavailable State

**Files:**
- Modify: `apps/web/vite.config.ts`
- Create: `apps/web/assets/icon-source.svg`
- Create: `apps/web/public/icon-192.png`
- Create: `apps/web/public/icon-512.png`
- Create: `apps/web/public/icon-maskable-512.png`
- Create: `scripts/generate-pwa-icons.mjs`
- Create: `apps/web/src/pwa/register-service-worker.ts`
- Create: `apps/web/src/pwa/UpdatePrompt.tsx`
- Create: `apps/web/src/pwa/UpdatePrompt.test.tsx`
- Create: `apps/web/src/app/ServerUnavailable.tsx`
- Create: `apps/web/src/app/ServerUnavailable.test.tsx`
- Create: `tests/e2e/pwa.spec.ts`

**Interfaces:**
- Manifest name/short name: `OpenRecall`.
- Display: `standalone`; start URL `/`; theme/background tokens have fixed
  manifest equivalents.
- Produces `requestUpdate()` and `deferUpdate()`; activation requires no active
  session/dirty form or explicit end/save first.

- [ ] **Step 1: Write failing service-worker build assertions**

After build, inspect generated Workbox manifest and assert:

- Hashed static assets and shell are precached.
- No `/api/` URL is precached.
- Runtime rules use NetworkOnly for `/api/**` and the SSE endpoint.
- Registration mode is prompt, not auto update.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm build && pnpm vitest run apps/web/src/pwa`

Expected: FAIL because PWA configuration/components are absent.

- [ ] **Step 3: Configure PWA**

Use `registerType: "prompt"`, `injectRegister: false`, and a navigation fallback
that excludes `/api/`. Add local icons with meaningful manifest purpose values;
no network-hosted assets.

- [ ] **Step 4: Generate deterministic local icons**

Create a source SVG with a plain-text-safe OpenRecall “O”/card mark, no external
font or linked asset. `generate-pwa-icons.mjs` uses `sharp@0.35.3` to render
192×192 and 512×512 PNGs and a 512×512 maskable version with a 20% safe-zone
margin. Run it during `prebuild` and assert PNG dimensions in the PWA build test.

- [ ] **Step 5: Write failing update prompt tests**

Assert update is announced politely, “update now” is blocked during active
review/dirty editor until state is saved, “later” dismisses without activation,
and accepted safe update invokes the worker update once.

- [ ] **Step 6: Implement update and unavailable states**

Manual registration reports `needRefresh`. If API bootstrap fails, render the
cached shell with a heading explaining the local server is stopped, the fixed
URL, retry button, and startup documentation link; never render cached card data.

- [ ] **Step 7: Add browser PWA tests**

Verify install manifest, offline shell, network-only API failure, no cached API
responses, prompt lifecycle, and no automatic reload during review.

- [ ] **Step 8: Run and commit**

Run: `pnpm build && pnpm vitest run apps/web/src/pwa apps/web/src/app/ServerUnavailable.test.tsx && pnpm test:e2e --grep "PWA"`

```bash
git add apps/web/vite.config.ts apps/web/assets apps/web/public apps/web/src/pwa apps/web/src/app/ServerUnavailable* scripts/generate-pwa-icons.mjs tests/e2e/pwa.spec.ts
git commit -m "feat: add a safe installable PWA shell"
```

### Task 4: Production Static Serving and Security Hardening

**Files:**
- Create: `apps/server/src/production/static-client.ts`
- Create: `apps/server/src/production/security-headers.ts`
- Create: `apps/server/src/logging.ts`
- Create: `apps/server/src/health.ts`
- Create: `apps/server/src/production/security.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/index.ts`
- Create: `tests/security/no-outbound-network.test.ts`

**Interfaces:**
- Production serves built web assets and SPA fallback, never API fallback HTML.
- `GET /api/v1/health` returns only app/API/schema status and no path/card data.
- CSP: local self resources only, with `connect-src 'self'` and no inline script.

- [ ] **Step 1: Write failing header/static tests**

Assert CSP, `X-Content-Type-Options`, frame denial, referrer policy, no CORS
header, immutable caching for hashed assets, no-store for API/HTML, correct SPA
fallback, and JSON 404 under `/api`.

- [ ] **Step 2: Write failing logging/redaction tests**

Inject card text, file paths, CSRF token, and stack-producing errors; capture
logs and assert none appear. Require request ID, route template, status, and
duration only.

- [ ] **Step 3: Run and verify RED**

Run: `pnpm vitest run apps/server/src/production tests/security`

Expected: FAIL because production plugins/tests are absent.

- [ ] **Step 4: Implement static/security plugins**

Register `@fastify/helmet` with explicit CSP, then `@fastify/static` rooted at
the resolved web dist path. Validate Host before routing, retain exact Origin
and CSRF rules, and reject content-bearing query parameters.

- [ ] **Step 5: Implement content-free logging and health**

Disable request-body serialization. Map unexpected errors to an opaque
diagnostic ID stored locally without card content. Health checks DB open state,
schema support, and maintenance state only.

- [ ] **Step 6: Add outbound-network guard**

During the full server integration suite, replace DNS/socket connection hooks
and fail any destination other than the configured loopback authority. Scan
built HTML/CSS/JS for `http://` or `https://` application dependencies.

- [ ] **Step 7: Run and commit**

Run: `pnpm vitest run apps/server/src/production tests/security && pnpm build`

```bash
git add apps/server/src/production apps/server/src/logging.ts apps/server/src/health.ts apps/server/src/app.ts apps/server/src/index.ts tests/security
git commit -m "feat: harden local production serving"
```

### Task 5: Single-Instance Startup and Windows-Friendly Launch

**Files:**
- Create: `apps/server/src/startup/single-instance.ts`
- Create: `apps/server/src/startup/single-instance.test.ts`
- Create: `scripts/start-openrecall.ps1`
- Create: `scripts/start-openrecall.cmd`
- Create: `scripts/smoke-production.mjs`
- Modify: `package.json`
- Create: `docs/getting-started/windows-ar.md`
- Create: `docs/getting-started/windows-en.md`

**Interfaces:**
- Root `pnpm start` launches production at `http://127.0.0.1:3210`.
- A second launch probes the health endpoint; if it is OpenRecall, print the
  existing URL and exit 0. If another application owns the port, exit with a
  localized-independent diagnostic code and do not choose a surprise port.

- [ ] **Step 1: Write failing single-instance tests**

Assert free-port start, existing OpenRecall detection, foreign-service
collision, graceful SIGINT/SIGTERM close, due-service stop, SSE close, DB close,
and no broad filesystem operation.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/server/src/startup/single-instance.test.ts`

Expected: FAIL because startup coordinator is missing.

- [ ] **Step 3: Implement startup coordinator**

Listen explicitly on host/port. On `EADDRINUSE`, fetch loopback health with a
one-second timeout and verify `app: "OpenRecall"`/API version. On shutdown, stop
accepting mutations, close services, run a passive WAL checkpoint through the
normal connection, and close it.

- [ ] **Step 4: Add launch scripts**

PowerShell script resolves its own repository path, verifies Node major 24 and
pnpm 11, then runs `pnpm start`; the CMD file delegates to that exact script.
Neither script downloads software, elevates permissions, or writes outside the
application data directory.

- [ ] **Step 5: Add production smoke**

Build, launch a child server with a temporary data directory, wait for health,
create a section through authenticated API flow, fetch the web shell, send
SIGTERM, and verify clean exit/database reopen.

- [ ] **Step 6: Write bilingual Windows instructions**

Document Node/pnpm prerequisites, install/build/start, Chrome URL, PWA install,
data/backup locations, stopping/restarting, and server-unavailable recovery.

- [ ] **Step 7: Run and commit**

Run: `pnpm vitest run apps/server/src/startup && node scripts/smoke-production.mjs`

```bash
git add apps/server/src/startup scripts package.json docs/getting-started
git commit -m "feat: add reliable local startup"
```

### Task 6: Repository Documentation and Safe Examples

**Files:**
- Create: `README.md`
- Create: `README.ar.md`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `CHANGELOG.md`
- Create: `docs/architecture/overview.md`
- Create: `docs/architecture/database-schema.md`
- Create: `docs/import/format.md`
- Create: `examples/cards.valid.json`
- Create: `examples/cards.invalid.json`
- Create: `docs/decisions/licensing.md`
- Create: `tests/documentation/documentation.test.ts`

**Interfaces:**
- English README links Arabic README and vice versa.
- Documentation never claims FSRS-7 support.
- No `LICENSE` file is created until the repository owner selects a license.

- [ ] **Step 1: Write documentation assertions**

Add a Vitest that parses both READMEs and requires install/start, Chrome/NVDA,
privacy, backup, JSON import, algorithm version, contribution, security, and
license-status sections. Parse the valid JSON example and assert import preview
accepts it; assert invalid example reports the documented paths.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run tests/documentation`

Expected: FAIL because documents/examples are absent.

- [ ] **Step 3: Write bilingual project documentation**

Explain local-only architecture, exact supported stack, accessibility contract,
variants sharing state, continuous due queue, SQLite backup, development/tests,
and known v1 exclusions. State accurately that FSRS-6 is current and FSRS-7 is
adapter-ready but unsupported until stable upstream availability.

- [ ] **Step 4: Write contributor/security architecture docs**

Document package boundaries, adapter upgrade gates, migrations, no-content logs,
GitHub private vulnerability reporting as the responsible-disclosure channel
(no fabricated email), translation workflow, and review requirements.

- [ ] **Step 5: Record licensing decision boundary**

Explain that absent a license, copyright defaults prevent others from legally
reusing the code. Mark public release as blocked until the owner explicitly
selects a license; do not generate license text or imply permission.

- [ ] **Step 6: Run and commit**

Run: `pnpm vitest run tests/documentation && pnpm check`

```bash
git add README.md README.ar.md CONTRIBUTING.md SECURITY.md CHANGELOG.md docs examples tests/documentation
git commit -m "docs: prepare OpenRecall for contributors"
```

### Task 7: GitHub CI and Dependency Upgrade Gates

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/windows-smoke.yml`
- Create: `.github/dependabot.yml`
- Create: `.github/pull_request_template.md`
- Create: `scripts/check-adapter-boundaries.mjs`
- Create: `scripts/check-lockfile-versions.mjs`

**Interfaces:**
- Required CI on Node 24: format/check, unit/property/integration, build,
  Playwright/axe, migration fixtures, backup/restore, production smoke.
- Informational Node 26 Current compatibility job remains non-required until LTS.

- [ ] **Step 1: Write failing local CI-script tests**

Assert boundary checker rejects forbidden FSRS imports and external URLs;
lockfile checker requires exact direct versions and approved
`better-sqlite3` build only.

- [ ] **Step 2: Run and verify RED**

Run: `node scripts/check-adapter-boundaries.mjs && node scripts/check-lockfile-versions.mjs`

Expected: FAIL because scripts/config are absent.

- [ ] **Step 3: Implement CI workflows**

Ubuntu job uses Node 24.18.0/pnpm 11.17.0 and Playwright Chromium. Windows job
uses Node 24.18.0, production smoke, migrations, backup/restore, and Playwright
with installed stable Chrome channel. Upload only non-sensitive traces from
synthetic fixtures.

- [ ] **Step 4: Add dependency policy**

Dependabot groups development-only updates but opens scheduler, optimizer,
SQLite, Fastify, React, and PWA updates separately. PR template requires
upstream changelog, adapter fixtures, migration/backup tests, RTL/LTR, and NVDA
impact.

- [ ] **Step 5: Run workflow-equivalent commands locally**

Run:

```bash
pnpm check
pnpm test
pnpm build
node scripts/check-adapter-boundaries.mjs
node scripts/check-lockfile-versions.mjs
node scripts/smoke-production.mjs
pnpm test:e2e
```

Expected: every command exits 0.

- [ ] **Step 6: Commit**

```bash
git add .github scripts
git commit -m "ci: enforce OpenRecall release gates"
```

### Task 8: Final Automated and Manual Release Audit

**Files:**
- Create: `docs/releases/first-release-checklist.md`
- Create: `docs/releases/nvda-results-template.md`
- Create: `docs/releases/dependency-baseline.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Release checklist records exact OS, Node, Chrome, NVDA, SQLite, scheduler,
  optimizer, and package-lock versions.

- [ ] **Step 1: Run clean-install verification**

From a new isolated worktree created with the required worktree skill:

```bash
corepack enable
corepack prepare pnpm@11.17.0 --activate
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
pnpm test:e2e
node scripts/smoke-production.mjs
```

Expected: clean checkout completes without undeclared global tools or network
access during normal application runtime.

- [ ] **Step 2: Run database recovery matrix**

Test empty/current/old/corrupt/foreign/future databases, interrupted migration,
backup during ratings, interrupted restore at each swap point, and reopen after
hard process termination. Record every fixture/result.

- [ ] **Step 3: Run stable Chrome/NVDA audit**

In Arabic and English, complete:

- Landmarks/headings/skip link.
- Section creation/import/error navigation.
- Exact question speech.
- Immediate answer speech without “Answer.”
- Notes heading without “Notes.”
- Rating-to-next-question speech.
- Queue/session live announcements without duplicate card content.
- Waiting, pause/resume, completion.
- Card edit/trash/delete/statistics.
- Settings/training/backup/restore.
- 400% zoom, forced colors, dark/light, reduced motion, RTL/LTR.

Record exact stable Chrome/NVDA versions current on audit day; unresolved
critical-flow defects block release.

- [ ] **Step 4: Review privacy and security**

Inspect browser network panel during all critical flows: only loopback traffic
is allowed. Review CSP reports, logs, downloaded backup, service-worker caches,
and repository artifacts for card content, secrets, machine paths, or telemetry.

- [ ] **Step 5: Review every product acceptance criterion**

Create a checkbox mapping from all ten criteria in the approved design to a
passing automated test and/or signed manual result. If evidence is absent, the
criterion remains failed.

- [ ] **Step 6: Record the release candidate**

Update changelog/dependency baseline with exact verified versions and commit
only if Steps 1–5 pass:

```bash
git add CHANGELOG.md docs/releases
git commit -m "chore: record first release candidate audit"
```

Do not publish or tag a public release until the owner has explicitly selected
a repository license.

## Stage 5 Exit Gate

- [ ] Clean installation, build, complete tests, and production smoke pass on
  Windows and Linux.
- [ ] Stable Chrome/NVDA audit has no unresolved critical-flow defect.
- [ ] Network inspection shows loopback-only application traffic.
- [ ] Arabic, English, pseudo-locale, RTL/LTR, themes, zoom, forced colors, and
  reduced motion pass.
- [ ] SQLite recovery matrix passes without silent data replacement.
- [ ] Every acceptance criterion has fresh evidence.
- [ ] Public publication remains blocked until the user makes the separate
  license decision.
