# OpenRecall 1.0 release audit

Audit updated: 2026-08-09

Status: **stable public release published and verified**

Release source commit: `493a6b0e023dfa169d223b44e21c45998afa5c24`

Annotated tag object: `2c165c2ebc57b2960b8ae1f775a5442c17a0f402`

This document records fresh evidence for the public `v1.0.0` release and the
post-release dependency-security audit.

## Exact toolchain

| Boundary | Verified value |
| --- | --- |
| Windows | Windows 10 Pro x64, build 19045 |
| Linux | Ubuntu 26.04 on WSL2 kernel 6.18.33.2, ext4 working directory |
| Node.js | `24.18.0` on Windows and Linux |
| pnpm | `11.17.0` on Windows and Linux |
| Playwright | `1.62.0`, Chromium and stable Chrome |
| SQLite | `3.53.3` through `better-sqlite3@13.0.1` |
| Scheduler | FSRS-6 `6.0`, adapter `1`, `ts-fsrs@5.4.1` |
| Optimizer | `@open-spaced-repetition/binding@0.5.0` |
| Project license | Apache-2.0 |

The Windows checks used the official Node runtime bundled by the packaging
pipeline, not the machine's older default Node. The Linux checks used the same
official Node release in a fresh ext4 extraction of the exact source commit.

## Source verification

### Windows

- The full exact-Node verification passed all type checks, license policy,
  production builds, production smoke (`OPENRECALL_SMOKE_OK`), and 506/506 unit
  and integration tests at the release source.
- All 13 browser end-to-end scenarios passed in stable Chrome, including the
  normal and portable launch paths.
- The post-release security hardening expanded the suite to 509 tests and also
  passed the optimizer durability group twice against one reused database.

### Linux

- Frozen installation, type and license policy, production builds, and the
  production smoke check passed.
- 504 tests passed and the two Windows-only package-launch tests were skipped
  as designed.
- All 13 browser scenarios passed, including every 320-pixel reflow assertion
  with zero horizontal overflow.
- The system browser libraries and fonts were installed explicitly through
  `apt-get --no-install-recommends`; the repository and user data were not
  exposed to a third-party service.

The browser suites cover Arabic, English, pseudo-locale expansion, light and
dark themes, reduced motion, PWA behavior, optimizer durability, backup and
restore, continuous review, and narrow viewport reflow.

## Hosted verification

| Workflow | Run | Result |
| --- | --- | --- |
| CI at release source | `30711991680` | Passed |
| Windows package and stable Chrome | `30711991675` | Passed |
| Stable release | `30712208070` | Passed |

The release workflow built from the annotated tag, verified the tag/commit
relationship, ran the release gates, created the ZIP and checksum, smoke-tested
both launchers, uploaded the assets, and produced a valid GitHub artifact
attestation. CodeQL, dependency review, secret scanning, push protection,
Dependabot security updates, and private vulnerability reporting are enabled.

## Public Windows artifact

| Property | Evidence |
| --- | --- |
| File | `OpenRecall-v1.0.0-windows-x64.zip` |
| Size | 56,447,960 bytes |
| SHA-256 | `3a1d42a918cdd4b72250805498536bfeb0e4a034adb1cc36a5c96d1a6361f830` |
| Runtime | Official Node.js `v24.18.0` |
| User databases | 0 files in the archive |

The downloaded public ZIP and checksum were compared with the published
assets. `scripts/smoke-windows-package.mjs` then extracted that ZIP and passed
both launchers. Normal mode created SQLite only under an isolated
`%LOCALAPPDATA%\OpenRecall-nodejs\Data`; portable mode created it only in
`Data` beside the launcher. Both databases passed SQLite `quick_check`, both
servers shut down cleanly, and the checksum matched `Get-FileHash`.

## Accessibility acceptance

- Automated axe, keyboard, focus, accessible-name, RTL/LTR, forced-color,
  reduced-motion, reflow, and zoom-equivalent checks passed on Windows and
  Linux.
- The owner completed the stable Chrome/NVDA critical-flow review in Arabic
  and English and accepted the question, answer, notes, rating, navigation, and
  announcement behavior before release.
- OpenRecall and the automated audit did not query, configure, launch, or
  control the owner's NVDA. The NVDA version is intentionally not claimed.

## Durability, privacy, and security

- New/current/old-schema databases, every migration, corrupt and foreign
  inputs, interrupted migration, concurrent backup, restore swaps, hard
  termination at each rename phase, WAL/SHM conflict states, and graceful
  shutdown fixtures passed.
- Production passed the loopback-only DNS/socket fence; Host, Origin, CSRF,
  CSP, no-CORS, no-store, and content-free logging boundaries passed.
- PWA caches contain the shell only, never API responses or card text.
- `pnpm audit --audit-level high` reports no known vulnerabilities after exact
  root overrides patched the transitive `fast-uri`, `brace-expansion`, and
  `nanoid` advisories. Release gates reject regressions to the vulnerable
  version ranges.
- Repository images use synthetic cards and a temporary SQLite database; visual
  inspection found no real data, username, machine path, or browser chrome.

## Release decision

- [x] All product acceptance criteria have automated evidence.
- [x] Owner-reported Chrome/NVDA Arabic and English acceptance is complete.
- [x] Exact Node/pnpm clean Windows and Linux verification passed.
- [x] Apache-2.0, NOTICE, third-party notices, and dependency inventory pass.
- [x] Normal and portable Windows launchers pass against the public ZIP.
- [x] Source author is `Abdullah Mansour <abdullahmansour.marketing@gmail.com>`.
- [x] Required hosted GitHub checks passed at the release commit.
- [x] The annotated `v1.0.0` tag and stable release workflow passed.
- [x] The downloaded public ZIP, checksum, workflow attestation, and launchers
  passed.

Code signing is an explicit v1 non-goal. Distribution integrity is provided by
the SHA-256 file and GitHub artifact attestation. Immutable releases were
enabled after `v1.0.0` was published, so GitHub correctly has no retroactive
release-level attestation for this tag; the workflow artifact attestation and
the downloaded-asset verification above remain valid.
