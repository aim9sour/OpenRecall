# OpenRecall Open-Source Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `aim9sour/OpenRecall` as a professional Apache-2.0 public repository and ship a verified stable `v1.0.0` Windows ZIP with normal and portable one-click launchers.

**Architecture:** Keep the source application local-first and unchanged at runtime, fix the Linux-only 320-pixel Grid overflow, and add a tested Windows distribution layer around the existing production server. A deterministic packaging orchestrator uses `pnpm deploy --prod --legacy`, verifies the official Node.js archive, assembles legal notices and launchers, inspects the artifact, and produces a ZIP that GitHub Actions smoke-tests and attests before release.

**Tech Stack:** Node.js 24.18.0, pnpm 11.17.0, TypeScript 7, React 19, Fastify 5, SQLite via better-sqlite3, Vitest 4, Playwright 1.62, PowerShell 5.1+, GitHub Actions, GitHub CLI, Apache-2.0.

## Global Constraints

- Repository: public `aim9sour/OpenRecall`, default branch `main`.
- Git identity: `Abdullah Mansour <abdullahmansour.marketing@gmail.com>`.
- Release: stable `v1.0.0`; no beta or prerelease.
- Windows artifact: `OpenRecall-v1.0.0-windows-x64.zip` plus `OpenRecall-v1.0.0-windows-x64.zip.sha256`.
- Runtime baseline: bundled official Node.js `24.18.0` Windows x64; development pnpm `11.17.0`.
- License: Apache License 2.0 with `NOTICE` and complete redistributed dependency notices.
- Modes: normal data in `%LOCALAPPDATA%\OpenRecall-nodejs\Data`; portable data in `Data` beside the launcher; no automatic migration between them.
- Network: production remains fixed to `127.0.0.1:3210`; no telemetry, CDN, cloud, or outbound runtime dependency.
- Accessibility: keyboard, Arabic/English, RTL/LTR, Chrome/NVDA behavior, 320-pixel reflow, forced colors, and reduced motion remain release gates.
- Data safety: never package real databases, backups, card text, logs, traces, credentials, browser profiles, or machine paths.
- Execution: resource-heavy gates run sequentially within one checkout.
- Publication: do not publish `v1.0.0` until Linux, Windows, packaged-artifact, and GitHub-hosted gates pass.

---

## File map

- `apps/web/src/styles/layout.css`: shrink-safe statistics filter Grid.
- `apps/server/package.json`: production loader dependency and deploy file boundary.
- `package.json` and workspace manifests: `1.0.0`, Apache metadata, packaging commands.
- `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`: project and redistribution terms.
- `distribution/windows/`: two CMD entry points, shared PowerShell launcher, and release README.
- `scripts/release/windows-package-core.mjs`: pure release naming, path safety, staging inspection, checksum, and notice helpers.
- `scripts/package-windows.mjs`: Windows build/deploy/download/verify/archive orchestration.
- `scripts/smoke-windows-package.mjs`: extracted normal/portable artifact smoke test.
- `tests/ci/windows-package.test.ts`: packaging and launcher contract tests.
- `tests/ci/release-gates.test.ts`: workflow/release policy assertions.
- `tests/documentation/documentation.test.ts`: public-license and bilingual documentation contract.
- `.github/ISSUE_TEMPLATE/`: structured bug, accessibility, and feature forms.
- `.github/workflows/dependency-review.yml`: pull-request dependency policy.
- `.github/workflows/codeql.yml`: JavaScript/TypeScript CodeQL analysis.
- `.github/workflows/release.yml`: Windows release build, smoke, checksum, attestation, and release publication.
- `docs/assets/`: synthetic screenshot and 1280-by-640 social preview.
- `README.md`, `README.ar.md`, `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`: public project surface.

---

### Task 1: Correct Linux 320-pixel statistics reflow

**Files:**
- Modify: `apps/web/src/styles/layout.css:373`
- Verify: `tests/e2e/management-statistics.spec.ts:321`
- Verify: `tests/e2e/visual-accessibility.spec.ts:90`

**Interfaces:**
- Consumes: existing `.filter-form` markup in `StatisticsPage.tsx` and Playwright overflow assertions.
- Produces: a single shrinkable Grid column without changing DOM order or native form semantics.

- [x] **Step 1: Reproduce both Linux failures against the current commit**

Use the existing WSL Node 24.18.0/pnpm 11.17.0 isolated archive workflow and run:

```bash
pnpm exec playwright test \
  --project=chromium-en \
  tests/e2e/management-statistics.spec.ts \
  tests/e2e/visual-accessibility.spec.ts
```

Expected: both tests fail because `/statistics` reaches approximately 330 pixels at a 320-pixel viewport.

- [x] **Step 2: Add the minimum shrink-safe Grid rule**

Add this rule beside `.filter-form h2`:

```css
.filter-form {
  grid-template-columns: minmax(0, 1fr);
  inline-size: 100%;
}

.filter-form > * {
  min-inline-size: 0;
}
```

- [x] **Step 3: Run the two focused Linux tests**

Run the command from Step 1.

Expected: 2 passed, zero horizontal overflow at 320 pixels.

- [x] **Step 4: Run the complete web component and English Playwright coverage**

```bash
pnpm exec vitest run apps/web/src/pages/StatisticsPage.test.tsx
pnpm exec playwright test --project=chromium-en
```

Expected: all selected tests pass; labels, focus, filter URL state, and reflow remain intact.

- [x] **Step 5: Commit the reflow correction**

```bash
git add apps/web/src/styles/layout.css
git commit -m "fix(a11y): constrain statistics filters at narrow widths"
```

---

### Task 2: Select Apache-2.0 and establish release identity

**Files:**
- Create: `LICENSE`
- Create: `NOTICE`
- Create: `THIRD_PARTY_NOTICES.md`
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
- Modify: `docs/decisions/licensing.md`
- Modify: `docs/releases/dependency-license-review.md`
- Test: `tests/documentation/documentation.test.ts`

**Interfaces:**
- Consumes: existing dependency license allowlist and verified author identity.
- Produces: SPDX `Apache-2.0`, version `1.0.0`, complete project license files, and an explicit redistribution boundary.

- [x] **Step 1: Replace the no-license documentation test with the public-license contract**

Change the licensing test to assert:

```ts
expect(await text("docs/decisions/licensing.md")).toMatch(/Apache License 2\.0/iu);
await expect(access(new URL("LICENSE", root), constants.F_OK)).resolves.toBeUndefined();
expect(await text("NOTICE")).toContain("Copyright 2026 Abdullah Mansour");
expect(await text("THIRD_PARTY_NOTICES.md")).toContain("Node.js");
```

Also assert every workspace manifest has `version: "1.0.0"` and `license: "Apache-2.0"`.

- [x] **Step 2: Run the documentation test to verify it fails**

```bash
pnpm exec vitest run tests/documentation/documentation.test.ts
```

Expected: failure because `LICENSE`, `NOTICE`, and public metadata do not yet exist.

- [x] **Step 3: Add the exact Apache 2.0 text and project notice**

Download the unmodified official text from
`https://www.apache.org/licenses/LICENSE-2.0.txt` into `LICENSE`.

Create `NOTICE` with:

```text
OpenRecall
Copyright 2026 Abdullah Mansour

This product includes software developed by the Node.js contributors and
other third parties listed in THIRD_PARTY_NOTICES.md and the licenses bundled
with the Windows distribution.
```

- [x] **Step 4: Record the audited third-party boundary**

Create `THIRD_PARTY_NOTICES.md` with sections for the bundled Node.js runtime,
production npm dependencies, OpenRecall icon assets, and the rule that each
dependency's distributed license file remains inside the packaged deployment.
Link Node's full license and the generated package license directory.

- [x] **Step 5: Update every workspace manifest**

Set exact fields:

```json
{
  "version": "1.0.0",
  "license": "Apache-2.0"
}
```

Keep `private: true`. Move `tsx: "4.23.1"` from `devDependencies` to
`dependencies` in `apps/server/package.json`, because the packaged server runs
TypeScript through Node's `--import tsx` loader. Add:

```json
"files": ["src", "package.json"]
```

- [x] **Step 6: Rewrite the licensing decision and review**

Record Apache-2.0 as selected, the explicit patent grant rationale, the
redistribution duties, the Node license boundary, and the packaging fail-closed
policy. Remove every “no license” release blocker.

- [x] **Step 7: Refresh the lockfile and run legal gates**

```bash
pnpm install --lockfile-only
pnpm exec vitest run tests/documentation/documentation.test.ts tests/ci/release-gates.test.ts
pnpm release:licenses
```

Expected: documentation and license gates pass, with no unreviewed production license.

- [x] **Step 8: Commit license and version identity**

```bash
git add LICENSE NOTICE THIRD_PARTY_NOTICES.md package.json pnpm-lock.yaml \
  apps/*/package.json packages/*/package.json docs/decisions/licensing.md \
  docs/releases/dependency-license-review.md tests/documentation/documentation.test.ts
git commit -m "docs: license OpenRecall under Apache 2.0"
```

---

### Task 3: Add public community and support surfaces

**Files:**
- Create: `CODE_OF_CONDUCT.md`
- Create: `SUPPORT.md`
- Create: `.github/ISSUE_TEMPLATE/bug.yml`
- Create: `.github/ISSUE_TEMPLATE/accessibility.yml`
- Create: `.github/ISSUE_TEMPLATE/feature.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Modify: `.github/pull_request_template.md`
- Modify: `CONTRIBUTING.md`
- Modify: `SECURITY.md`
- Modify: `CHANGELOG.md`
- Test: `tests/documentation/documentation.test.ts`

**Interfaces:**
- Consumes: Apache contribution model and GitHub private vulnerability reporting.
- Produces: structured public support, contribution, conduct, issue, and security routes.

- [x] **Step 1: Add failing community-health assertions**

Assert the required files exist and contain:

```ts
expect(await text("CODE_OF_CONDUCT.md")).toContain("Contributor Covenant 3.0");
expect(await text("SUPPORT.md")).toContain("GitHub Discussions");
expect(await text(".github/ISSUE_TEMPLATE/config.yml")).toContain("blank_issues_enabled: false");
expect(await text("SECURITY.md")).toContain("v1.x");
```

Assert each issue form warns against real SQLite databases and private card content.

- [x] **Step 2: Run the documentation test to verify it fails**

```bash
pnpm exec vitest run tests/documentation/documentation.test.ts
```

Expected: missing community files.

- [x] **Step 3: Add Contributor Covenant 3.0**

Use the official Markdown text from
`https://www.contributor-covenant.org/version/3/0/code_of_conduct/`, retain its
CC BY-SA 4.0 attribution, and set conduct reports to
`abdullahmansour.marketing@gmail.com`.

- [x] **Step 4: Add support and public contribution routes**

`SUPPORT.md` sends usage questions to GitHub Discussions, reproducible defects
to issue forms, security reports to private vulnerability reporting, and
conduct reports to the designated email. Update `CONTRIBUTING.md` to welcome
Apache-2.0 contributions without a CLA and keep all current durability,
algorithm, translation, and NVDA gates.

- [x] **Step 5: Add three issue forms and chooser configuration**

Each YAML form must require OpenRecall version, operating system, Chrome
version, synthetic reproduction, expected/actual result, and verification that
no private data is attached. The accessibility form additionally requires
keyboard/screen-reader combination, speech mode, locale, theme, focus target,
and exact concise announcement. Use:

```yaml
blank_issues_enabled: false
contact_links:
  - name: Security vulnerability
    url: https://github.com/aim9sour/OpenRecall/security/advisories/new
    about: Report vulnerabilities privately. Do not open a public issue.
  - name: Usage question
    url: https://github.com/aim9sour/OpenRecall/discussions
    about: Ask for help without uploading private study data.
```

- [x] **Step 6: Update PR, security, and changelog policies**

Add packaging normal/portable checks, artifact-content checks, and release-note
impact to the PR template. Change security support from “unreleased” to the
current `v1.x` line. Add the completed release notes under `Unreleased`; Task 8
promotes them to `1.0.0` only after all local release gates pass.

- [x] **Step 7: Run documentation and YAML-oriented gates**

```bash
pnpm exec vitest run tests/documentation/documentation.test.ts tests/ci/release-gates.test.ts
git diff --check
```

- [x] **Step 8: Commit community files**

```bash
git add .github CODE_OF_CONDUCT.md SUPPORT.md CONTRIBUTING.md SECURITY.md CHANGELOG.md tests/documentation/documentation.test.ts
git commit -m "docs: prepare OpenRecall community health files"
```

---

### Task 4: Build a safe Windows packaging core

**Files:**
- Create: `scripts/release/windows-package-core.mjs`
- Create: `scripts/package-windows.mjs`
- Create: `tests/ci/windows-package.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces `releaseArtifactNames(version)` returning ZIP and checksum names.
- Produces `assertSafeReleaseDirectory(path, repositoryRoot)`.
- Produces `verifySha256(path, expectedHex)`.
- Produces `inspectStagingDirectory(root)` returning a sorted file manifest or throwing a stable `OPENRECALL_PACKAGE_*` code.
- Produces CLI `node scripts/package-windows.mjs --version 1.0.0 --output "$PWD\release-output"`.

- [x] **Step 1: Write failing pure packaging tests**

Cover exact names, semantic version validation, refusal of relative/root/repo
output paths, SHA mismatch, forbidden `.sqlite3`/logs/traces/source maps, missing
license files, and deterministic sorted manifests:

```ts
expect(releaseArtifactNames("1.0.0")).toEqual({
  archive: "OpenRecall-v1.0.0-windows-x64.zip",
  checksum: "OpenRecall-v1.0.0-windows-x64.zip.sha256",
});
expect(() => assertSafeReleaseDirectory(repositoryRoot, repositoryRoot))
  .toThrow("OPENRECALL_PACKAGE_OUTPUT_UNSAFE");
```

- [x] **Step 2: Run the focused test to verify it fails**

```bash
pnpm exec vitest run tests/ci/windows-package.test.ts
```

Expected: missing module/functions.

- [x] **Step 3: Implement release naming, path safety, and SHA verification**

Use `path.resolve`, `path.parse(path).root`, `crypto.createHash("sha256")`, and
stable error codes. Never recursively remove before verifying that the resolved
target is an explicit child of the requested output directory and is not the
repository root.

- [x] **Step 4: Implement staged-tree inspection**

Allow only the documented release layout. Reject paths matching:

```js
const forbidden = /(?:\.sqlite3(?:-|$)|\.log$|\.trace$|trace\.zip$|\.map$|test-results|playwright-report|\.env(?:\.|$))/iu;
```

Require `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, Node's `LICENSE`, both
CMD launchers, shared PowerShell launcher, `runtime/node.exe`,
`app/server/src/index.ts`, `app/server/node_modules`, and `app/web/dist/index.html`.

- [x] **Step 5: Implement the Windows orchestration CLI**

The CLI must:

```text
validate args -> pnpm build -> pnpm --filter @openrecall/server --prod deploy --legacy
-> copy apps/web/dist -> download Node zip + SHASUMS256.txt
-> verify SHA -> Expand-Archive -> copy legal/launcher files
-> copy dependency license files -> inspect -> Compress-Archive -> SHA file
```

Use direct child-process arguments, `windowsHide: true`, bounded buffers, and
stable diagnostics. Network URLs are limited to
`https://nodejs.org/dist/v24.18.0/` and are packaging-time only.

- [x] **Step 6: Generate dependency license copies from deployed packages**

Walk deployed package roots, preserve each `LICENSE*`, `COPYING*`, or `NOTICE*`
under `licenses/npm/${encodeURIComponent(packageName)}/${packageVersion}/`, and
fail if a deployed package has neither a recognized license file nor an explicit
audited exception. Copy the official Node distribution `LICENSE` to
`licenses/node/LICENSE`.

- [x] **Step 7: Add package scripts and output ignores**

```json
"package:windows": "node scripts/package-windows.mjs --version 1.0.0",
"test:package": "vitest run tests/ci/windows-package.test.ts"
```

Ignore `/release-output/` and `/release-staging/`.

- [x] **Step 8: Run core tests and type-aware repository checks**

```bash
pnpm exec vitest run tests/ci/windows-package.test.ts tests/ci/release-gates.test.ts
pnpm exec tsc -p tsconfig.tools.json
git diff --check
```

- [x] **Step 9: Commit the packaging core**

```bash
git add scripts/release scripts/package-windows.mjs tests/ci/windows-package.test.ts package.json .gitignore apps/server/package.json pnpm-lock.yaml
git commit -m "build: create verified Windows distribution"
```

---

### Task 5: Add normal and portable launchers with artifact smoke tests

**Files:**
- Create: `distribution/windows/OpenRecall.cmd`
- Create: `distribution/windows/OpenRecall-Portable.cmd`
- Create: `distribution/windows/Start-OpenRecall.ps1`
- Create: `distribution/windows/README.txt`
- Create: `scripts/smoke-windows-package.mjs`
- Modify: `tests/ci/windows-package.test.ts`
- Modify: `scripts/package-windows.mjs`
- Modify: `package.json`

**Interfaces:**
- Normal CMD invokes `Start-OpenRecall.ps1 -Mode Normal`.
- Portable CMD invokes `Start-OpenRecall.ps1 -Mode Portable`.
- PowerShell launches bundled `runtime\node.exe` through `LauncherHost.mjs`,
  which starts the TypeScript server and relays graceful shutdown over IPC.
- Internal smoke-only environment: `OPENRECALL_LAUNCHER_NO_BROWSER=1`.

- [x] **Step 1: Add failing launcher contract tests**

Assert both CMD files quote `%~dp0`, invoke the same PowerShell file, and pass
distinct modes. Assert PowerShell normal mode removes any inherited
`OPENRECALL_DATA_DIRECTORY`, portable mode resolves
`Join-Path $PSScriptRoot "Data"`, and both use bundled `runtime\node.exe` rather
than PATH.

- [x] **Step 2: Run launcher tests to verify they fail**

```bash
pnpm exec vitest run tests/ci/windows-package.test.ts
```

- [x] **Step 3: Implement the two thin CMD files**

Create `OpenRecall.cmd` with `-Mode Normal` and
`OpenRecall-Portable.cmd` with `-Mode Portable`, using this exact structure:

```bat
@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-OpenRecall.ps1" -Mode Normal
exit /b %ERRORLEVEL%
```

- [x] **Step 4: Implement shared PowerShell startup**

Validate required files, test portable-directory writability using a random
temporary file, start bundled Node with `NODE_ENV=production`, poll the fixed
health endpoint for at most 30 seconds, open stable Chrome paths or the default
browser, then wait for the server process. Preserve server diagnostic codes and
return its exit code. Never hide the server window.

- [x] **Step 5: Implement extracted artifact smoke tests**

`scripts/smoke-windows-package.mjs` extracts the ZIP to a fresh temp directory,
sets `OPENRECALL_LAUNCHER_NO_BROWSER=1`, and runs each launcher sequentially.
For normal mode, override `LOCALAPPDATA` to a temp root and assert the database
appears only there. For portable mode, assert it appears only in extracted
`Data`. Request `/api/v1/health`, then send a graceful termination and verify a
clean exit.

- [x] **Step 6: Add smoke script**

```json
"smoke:package:windows": "node scripts/smoke-windows-package.mjs"
```

- [x] **Step 7: Build and smoke the real artifact on Windows**

```powershell
pnpm package:windows -- --output "$PWD\release-output"
pnpm smoke:package:windows -- --archive "$PWD\release-output\OpenRecall-v1.0.0-windows-x64.zip"
```

Expected: both data modes pass and no database appears in the source checkout.

- [x] **Step 8: Commit launchers and smoke coverage**

```bash
git add distribution/windows scripts/package-windows.mjs scripts/smoke-windows-package.mjs tests/ci/windows-package.test.ts package.json
git commit -m "feat(release): add normal and portable Windows launchers"
```

---

### Task 6: Polish bilingual documentation and repository imagery

**Files:**
- Create: `docs/assets/openrecall-home.png`
- Create: `docs/assets/openrecall-review.png`
- Create: `docs/assets/openrecall-social-preview.png`
- Create: `scripts/capture-repository-assets.mjs`
- Modify: `README.md`
- Modify: `README.ar.md`
- Modify: `docs/getting-started/windows-en.md`
- Modify: `docs/getting-started/windows-ar.md`
- Modify: `tests/documentation/documentation.test.ts`

**Interfaces:**
- Asset generator uses only synthetic fixture cards and a temporary SQLite database.
- README download target: `https://github.com/aim9sour/OpenRecall/releases/latest`.
- Social preview dimensions: exactly 1280 by 640 pixels.

- [x] **Step 1: Add failing public README and image assertions**

Assert both READMEs contain the release URL, `OpenRecall.cmd`,
`OpenRecall-Portable.cmd`, Apache-2.0, the screenshot paths, normal/portable
data boundaries, and developer commands. Use `sharp().metadata()` to assert
image dimensions and PNG format.

- [x] **Step 2: Run documentation tests to verify failure**

```bash
pnpm exec vitest run tests/documentation/documentation.test.ts
```

- [x] **Step 3: Implement deterministic synthetic asset capture**

The script creates a temp data directory, starts the app on its fixed local
ports with synthetic English and Arabic content, captures light/dark desktop
views without browser chrome, and composes the social preview from the existing
OpenRecall icon, product name, concise description, and a clipped synthetic UI
panel. Strip metadata before writing PNGs.

- [x] **Step 4: Rewrite both README entry points**

Lead with download and two-click Windows use, then privacy/features,
screenshots, accessibility contract, backup safety, developer setup, project
links, and honest v1 limitations. Use a restrained badge row:

```markdown
[![CI](https://github.com/aim9sour/OpenRecall/actions/workflows/ci.yml/badge.svg)](https://github.com/aim9sour/OpenRecall/actions/workflows/ci.yml)
[![Windows](https://github.com/aim9sour/OpenRecall/actions/workflows/windows-smoke.yml/badge.svg)](https://github.com/aim9sour/OpenRecall/actions/workflows/windows-smoke.yml)
[![Release](https://img.shields.io/github/v/release/aim9sour/OpenRecall)](https://github.com/aim9sour/OpenRecall/releases/latest)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
```

- [x] **Step 5: Update both Windows guides**

Make release ZIP installation the default path. Keep source development in a
separate section. Document the writable-folder rule, data locations, movement
semantics, browser fallback, stop behavior, backup, and mode isolation.

- [x] **Step 6: Generate and inspect repository assets**

```bash
node scripts/capture-repository-assets.mjs
pnpm exec vitest run tests/documentation/documentation.test.ts
```

Open all three images and confirm no real data, usernames, paths, or browser UI.

- [x] **Step 7: Commit documentation and assets**

```bash
git add README.md README.ar.md docs/assets docs/getting-started scripts/capture-repository-assets.mjs tests/documentation/documentation.test.ts
git commit -m "docs: present the OpenRecall 1.0 experience"
```

---

### Task 7: Complete GitHub security and release automation

**Files:**
- Create: `.github/workflows/dependency-review.yml`
- Create: `.github/workflows/codeql.yml`
- Create: `.github/workflows/release.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/windows-smoke.yml`
- Modify: `.github/dependabot.yml`
- Modify: `tests/ci/release-gates.test.ts`

**Interfaces:**
- Release trigger: tags matching `v*.*.*` and manual dispatch for dry runs.
- Release builder: Windows latest, Node 24.18.0, pnpm 11.17.0.
- Attestation: `actions/attest@v4` with `id-token`, `attestations`, and `artifact-metadata` write permissions.

- [ ] **Step 1: Add failing workflow contract tests**

Assert dependency review uses `actions/dependency-review-action@v4`, CodeQL
uses `github/codeql-action/*@v4`, release uses `actions/attest@v4`, permissions
are minimal, the tag version equals package version, the exact ZIP is smoked,
and a draft release is populated before publication.

- [ ] **Step 2: Run release-gate tests to verify failure**

```bash
pnpm exec vitest run tests/ci/release-gates.test.ts
```

- [ ] **Step 3: Add dependency review and CodeQL workflows**

Dependency review runs only on pull requests with `contents: read` and fails on
moderate-or-higher vulnerabilities. The existing audited local license gate
remains authoritative for production-license policy. CodeQL runs
JavaScript/TypeScript on pushes, pull requests, and a weekly schedule with
`security-events: write` and no package publishing permission.

- [ ] **Step 4: Add the Windows release workflow**

The workflow checks out full history, installs exact tools and dependencies,
runs release policy checks, builds the artifact, runs packaged normal/portable
smoke, computes the checksum, uploads a temporary Actions artifact, generates
provenance with `actions/attest@v4`, creates a draft release with `gh release
create --draft`, uploads ZIP/checksum, then publishes only after every step
passes.

- [ ] **Step 5: Harden existing workflows**

Keep Linux and Windows jobs sequential, add package tests to Windows, preserve
stable Chrome, set explicit `shell`, and use 30-minute Linux, 35-minute Windows,
and 45-minute release job timeouts. Keep Dependabot weekly npm and GitHub Actions
updates and risky dependency groups.

- [ ] **Step 6: Run workflow policy and documentation tests**

```bash
pnpm exec vitest run tests/ci/release-gates.test.ts tests/documentation/documentation.test.ts tests/ci/windows-package.test.ts
git diff --check
```

- [ ] **Step 7: Commit automation**

```bash
git add .github tests/ci/release-gates.test.ts
git commit -m "ci: secure and automate OpenRecall releases"
```

---

### Task 8: Run complete local and cross-platform release verification

**Files:**
- Modify only if a verified gate exposes a defect.
- Update: `docs/releases/first-release-checklist.md`
- Update: `CHANGELOG.md`

**Interfaces:**
- Consumes: complete source and Windows artifact.
- Produces: fresh evidence that permits public push and tag creation.

- [ ] **Step 1: Run focused repository gates**

```bash
pnpm exec vitest run tests/ci tests/documentation
pnpm release:licenses
git diff --check
```

- [ ] **Step 2: Run complete Windows source verification with exact Node 24.18.0**

```powershell
pnpm verify
node scripts/smoke-production.mjs --skip-build
$env:OPENRECALL_E2E_PORT_OFFSET = "1000"
pnpm test:e2e
```

- [ ] **Step 3: Rebuild and smoke the final Windows ZIP**

```powershell
pnpm package:windows -- --output "$PWD\release-output"
pnpm smoke:package:windows -- --archive "$PWD\release-output\OpenRecall-v1.0.0-windows-x64.zip"
```

Extract it once more to a clean temp directory and inspect the manifest and
licenses. Verify the SHA-256 file with `Get-FileHash`.

- [ ] **Step 4: Run complete Linux verification in WSL**

Archive the current commit into an ext4 temp directory, use exact Node
24.18.0/pnpm 11.17.0, then run:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm exec playwright install --with-deps chromium
node scripts/smoke-production.mjs --skip-build
pnpm test:e2e
```

Expected: every discovered test file, production build, smoke, and all 13
Playwright tests pass with zero 320-pixel overflow.

- [ ] **Step 5: Update release evidence truthfully**

Record exact commands, runtime versions, pass counts, package SHA-256, and the
owner's completed Chrome/NVDA Arabic/English acceptance. Promote the completed
changelog section to `[1.0.0] - 2026-08-01`. Remove obsolete license and Linux
blockers; retain code-signing as an explicit non-goal.

- [ ] **Step 6: Run final clean-tree verification**

```bash
git status --short
git diff --check
git log -1 --format="%an <%ae>"
```

Expected: only evidence files changed; author identity matches Abdullah Mansour.

- [ ] **Step 7: Commit release evidence**

```bash
git add docs/releases/first-release-checklist.md CHANGELOG.md
git commit -m "docs: record OpenRecall 1.0 release evidence"
```

---

### Task 9: Create and configure the public GitHub repository

**Files:**
- No source files unless GitHub reports a configuration defect.

**Interfaces:**
- Produces: public `https://github.com/aim9sour/OpenRecall`, `origin`, default `main`, metadata, labels, security features, and passing hosted Actions.

- [ ] **Step 1: Verify identity, clean history, and remote availability**

```bash
git config --local user.name
git config --local user.email
git status --short
git log --format="%an <%ae>" | sort -u
gh auth status
gh repo view aim9sour/OpenRecall
```

Expected: correct verified identity, clean tree, one author identity, authenticated
`aim9sour`, and repository still absent.

- [ ] **Step 2: Rename the local branch and create the public repository**

```bash
git branch -m main
gh repo create aim9sour/OpenRecall \
  --public \
  --source . \
  --remote origin \
  --description "Local-first, screen-reader-accessible spaced repetition with FSRS-6, smart card variants, SQLite, Arabic and English." \
  --push
```

- [ ] **Step 3: Apply repository features and topics**

```bash
gh repo edit aim9sour/OpenRecall \
  --enable-issues \
  --enable-discussions \
  --enable-projects=false \
  --enable-wiki=false \
  --delete-branch-on-merge \
  --enable-squash-merge \
  --enable-merge-commit=false \
  --enable-rebase-merge=false \
  --add-topic spaced-repetition,flashcards,fsrs,accessibility,screen-reader,nvda,sqlite,local-first,arabic,react,typescript,pwa
```

Run `gh repo edit --help` first and use the equivalent current flags if the
installed GitHub CLI spells a Boolean option differently.

- [ ] **Step 4: Create professional labels**

Create or update: `bug`, `accessibility`, `screen-reader`, `feature`,
`documentation`, `security`, `dependencies`, `scheduler`, `database`,
`good first issue`, `help wanted`, and `triage`, each with a concise description
and deliberate color.

- [ ] **Step 5: Enable security features through supported APIs**

Enable private vulnerability reporting, automated security fixes, Dependabot
alerts, and available secret scanning/push protection. Treat an unsupported
account-level feature as a reported setting limitation, not as permission to
weaken workflows.

- [ ] **Step 6: Upload the social preview**

Use the authenticated GitHub repository Settings UI because GitHub does not
provide a supported REST endpoint for social-preview upload. Upload
`docs/assets/openrecall-social-preview.png` and verify its rendered crop.

- [ ] **Step 7: Watch every initial GitHub Action**

```bash
gh run list --repo aim9sour/OpenRecall --limit 20
```

For each required workflow, obtain and watch its concrete latest run ID:

```powershell
$runId = gh run list --repo aim9sour/OpenRecall --workflow ci.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $runId --repo aim9sour/OpenRecall --exit-status
```

Investigate and fix source defects; do not rerun blindly. Push focused fixes and
wait until Linux CI, Windows Chrome, CodeQL, and applicable security workflows pass.

- [ ] **Step 8: Add a main-branch ruleset after check names exist**

Require pull requests, non-force-push history, conversation resolution, and the
actual successful CI check contexts. Allow repository administrators an
emergency bypass. Verify the ruleset through `gh api repos/aim9sour/OpenRecall/rulesets`.

- [ ] **Step 9: Verify the public community profile**

```bash
gh api repos/aim9sour/OpenRecall/community/profile
gh repo view aim9sour/OpenRecall --json nameWithOwner,visibility,defaultBranchRef,description,repositoryTopics,url
```

Expected: public, default `main`, correct metadata, recognized license,
contributing guide, code of conduct, issue templates, and security policy.

---

### Task 10: Publish and verify stable v1.0.0

**Files:**
- Modify only if final hosted validation exposes a defect.

**Interfaces:**
- Produces: immutable stable GitHub release `v1.0.0` with ZIP, checksum, notes, and provenance.

- [ ] **Step 1: Confirm all required hosted checks are green at the exact commit**

```bash
gh run list --repo aim9sour/OpenRecall --commit "$(git rev-parse HEAD)" --limit 20
git status --short
```

Do not proceed if a required job is pending, skipped unexpectedly, or failed.

- [ ] **Step 2: Create and push the annotated stable tag**

```bash
git tag -a v1.0.0 -m "OpenRecall 1.0.0"
git push origin v1.0.0
```

- [ ] **Step 3: Watch the release workflow to completion**

```bash
gh run list --repo aim9sour/OpenRecall --workflow release.yml --limit 5
```

```powershell
$releaseRunId = gh run list --repo aim9sour/OpenRecall --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $releaseRunId --repo aim9sour/OpenRecall --exit-status
```

- [ ] **Step 4: Verify release metadata and assets**

```bash
gh release view v1.0.0 --repo aim9sour/OpenRecall --json isDraft,isPrerelease,name,tagName,url,assets
```

```powershell
$releaseVerifyDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "openrecall-v1-release-verify"
New-Item -ItemType Directory -Force -Path $releaseVerifyDirectory
gh release download v1.0.0 --repo aim9sour/OpenRecall --dir $releaseVerifyDirectory
```

Expected: stable, not draft, not prerelease, exact ZIP and checksum present.

- [ ] **Step 5: Verify checksum and provenance**

```powershell
gh attestation verify (Join-Path $releaseVerifyDirectory "OpenRecall-v1.0.0-windows-x64.zip") `
  --repo aim9sour/OpenRecall
```

Compare the downloaded ZIP digest to the published `.sha256` file.

- [ ] **Step 6: Smoke the downloaded release artifact**

Run `scripts/smoke-windows-package.mjs` against the downloaded ZIP and confirm
normal and portable data isolation one final time.

- [ ] **Step 7: Enable release immutability and verify the release page**

Enable immutable releases in repository settings if the account exposes the
feature, then verify the release remains downloadable and displays its
attestation. Confirm README badges, screenshots, topics, issue forms,
Discussions, Security, and the latest-release link from a signed-out view.

- [ ] **Step 8: Record the final publication outcome**

Report the repository URL, release URL, commit SHA, tag SHA, artifact SHA-256,
GitHub Actions results, attestation verification, WSL/Windows test counts, and
the exact WSL packages installed for future Linux verification.

---

## Plan references

- Design: `docs/superpowers/specs/2026-08-01-open-source-release-design.md`
- pnpm deploy: <https://pnpm.io/cli/deploy>
- Apache 2.0 application: <https://www.apache.org/legal/apply-license>
- Node.js redistribution license: <https://github.com/nodejs/node/blob/main/LICENSE>
- GitHub issue forms: <https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/configuring-issue-templates-for-your-repository>
- GitHub dependency review: <https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/configure-dependency-review-action>
- GitHub CodeQL: <https://github.com/github/codeql-action>
- GitHub artifact attestation: <https://github.com/actions/attest>
- GitHub immutable releases: <https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases>
