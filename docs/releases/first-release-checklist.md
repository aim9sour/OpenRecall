# OpenRecall 1.0 release audit

Audit date: 2026-08-01

Status: **local release candidate verified; hosted checks pending**

Verified source baseline: `928aadc45b7a9e02562fbd28e2589e89439daf75`

This document records fresh evidence for the public `v1.0.0` release. It does
not substitute automated GitHub checks or the final downloaded-artifact check.

## Exact toolchain

| Boundary | Verified value |
| --- | --- |
| Windows | Windows 10 Pro x64, build 19045 |
| Linux | Ubuntu 26.04 on WSL2 kernel 6.18.33.2, ext4 working directory |
| Node.js | `24.18.0` on Windows and Linux |
| pnpm | `11.17.0` on Windows and Linux |
| Playwright | `1.62.0`, Chromium project |
| SQLite | `3.53.3` through `better-sqlite3@13.0.1` |
| Scheduler | FSRS-6 `6.0`, adapter `1`, `ts-fsrs@5.4.1` |
| Optimizer | `@open-spaced-repetition/binding@0.5.0` |
| Project license | Apache-2.0 |

The Windows checks used the official Node runtime bundled by the packaging
pipeline, not the machine's older default Node. The Linux checks used
`/home/abdo/.local/node-v24.18.0-linux-x64` in a fresh ext4 extraction of the
exact Git commit.

## Source verification

### Windows

- `pnpm exec vitest run tests/ci tests/documentation`: 4 files, 57 tests passed.
- `pnpm release:licenses`: 95 production entries and 524 total entries passed.
- `pnpm verify`: all type checks and license policy passed; 98 files and
  506/506 tests passed; all production workspaces built.
- `node scripts/smoke-production.mjs --skip-build`: `OPENRECALL_SMOKE_OK`.
- `OPENRECALL_E2E_PORT_OFFSET=1000 pnpm test:e2e`: 13/13 passed in 3.0 minutes.

### Linux

The exact commit was archived to
`/home/abdo/.cache/openrecall-release-928aadc` before execution.

- `pnpm install --frozen-lockfile`: lockfile policy passed for 689 entries.
- `pnpm verify`: type and license policy passed; 98 files, 504 tests passed and
  2 Windows-only package-launch tests skipped; all workspaces built.
- `pnpm exec playwright install --with-deps chromium`: browser and OS
  dependencies verified.
- `node scripts/smoke-production.mjs --skip-build`: `OPENRECALL_SMOKE_OK`.
- `OPENRECALL_E2E_PORT_OFFSET=2000 pnpm test:e2e`: 13/13 passed in 2.8 minutes.

The browser suites covered Arabic, English, pseudo-locale expansion, light and
dark themes, reduced motion, PWA behavior, optimizer durability, backup and
restore, continuous review, and every 320-pixel reflow assertion with zero
horizontal overflow.

## Windows artifact

| Property | Evidence |
| --- | --- |
| File | `OpenRecall-v1.0.0-windows-x64.zip` |
| Size | 66,569,685 bytes |
| SHA-256 | `0b157ee680d268acf465f13dc007b15a0a699fbed999c21093c3053ed085a57d` |
| Runtime | Official Node.js `v24.18.0` |
| Legal inventory | Root Apache-2.0 files plus 110 dependency license/notice files |
| User databases | 0 files in the archive |

`scripts/smoke-windows-package.mjs` extracted this exact ZIP and passed both
launchers. Normal mode created its SQLite database only under an isolated
`%LOCALAPPDATA%\OpenRecall-nodejs\Data`; portable mode created it only in
`Data` beside the launcher. Both databases passed SQLite `quick_check`, both
servers shut down cleanly, and the checksum file matched `Get-FileHash`.

## Accessibility acceptance

- Automated axe, keyboard, focus, accessible-name, RTL/LTR, forced-color,
  reduced-motion, reflow, and zoom-equivalent checks passed on Windows and
  Linux.
- The owner completed the stable Chrome/NVDA critical-flow review in Arabic
  and English and accepted the question, answer, notes, rating, navigation, and
  announcement behavior before this audit.
- OpenRecall did not query, configure, launch, or control the owner's NVDA.
  The NVDA version is intentionally not claimed here.

The repeated React Router development warning about an absent
`HydrateFallback` did not fail a flow, did not appear as a production error,
and is not presented as screen-reader evidence.

## Durability, privacy, and security

- New/current/old-schema databases, every migration, corrupt and foreign
  inputs, interrupted migration, concurrent backup, restore swaps, hard
  termination at each rename phase, WAL/SHM conflict states, and graceful
  shutdown fixtures passed.
- Production passed the loopback-only DNS/socket fence; Host, Origin, CSRF,
  CSP, no-CORS, no-store, and content-free logging boundaries passed.
- PWA caches contain the shell only, never API responses or card text.
- Adapter and lockfile fences passed. The production-license allowlist remains
  stricter than the reviewed development-tool inventory.
- Repository images were generated from synthetic cards and a temporary SQLite
  database; visual inspection found no real data, username, machine path, or
  browser chrome.

## Release decision

- [x] All ten product acceptance criteria have automated evidence.
- [x] Owner-reported Chrome/NVDA Arabic and English acceptance is complete.
- [x] Exact Node/pnpm clean Windows and Linux verification passed at one commit.
- [x] Apache-2.0, NOTICE, third-party notices, and dependency inventory pass.
- [x] Normal and portable Windows launchers pass against the final ZIP.
- [x] Source author is `Abdullah Mansour <abdullahmansour.marketing@gmail.com>`.
- [ ] Initial hosted GitHub checks pass at the public commit.
- [ ] The annotated `v1.0.0` tag and hosted release workflow pass.
- [ ] The downloaded public ZIP, checksum, provenance, and launchers pass.

Code signing is an explicit v1 non-goal. Distribution integrity is provided by
the SHA-256 file and GitHub artifact provenance. The source is authorized for a
public push; the stable tag is authorized only after the initial hosted checks
are green.
