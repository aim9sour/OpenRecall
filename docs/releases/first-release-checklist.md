# First release audit checklist

Audit date: 2026-07-30  
Status: **not a release candidate**  
Implementation baseline reviewed: `27dfded5cb6cd46d23b153903f51ba608f242822`

The automated Windows evidence is green. The stable Chrome headless audit is
green. The human stable Chrome/NVDA speech audit, a fresh Linux execution, and
the owner's repository-license decision remain open, so no tag or public
release is authorized.

## Environment

| Boundary | Audit value |
| --- | --- |
| Operating system | Microsoft Windows 10 Pro, `10.0.19045`, build `19045`, 64-bit |
| Node.js | `24.18.0` |
| pnpm | `11.17.0` |
| Stable Chrome | `150.0.7871.184`, isolated headless Playwright channel |
| NVDA | Not queried or controlled; manual audit not executed |
| Playwright | `1.62.0` |
| SQLite | `3.53.3` through `better-sqlite3@13.0.1` |
| Schema | `5` |
| Scheduler | FSRS-6 `6.0`, adapter `1`, `ts-fsrs@5.4.1` |
| Optimizer | `@open-spaced-repetition/binding@0.5.0` |
| Lockfile | pnpm format `9.0`; hash in `dependency-baseline.md` |

## Clean installation and build

- [x] A detached clean worktree at `9dfa9b0` completed frozen install,
  type checks, 358 tests, build, 11 Playwright tests, and production smoke.
- [x] After the restore-recovery change, the implementation worktree completed
  all type checks and 382 tests.
- [x] The current implementation completed production build and
  `OPENRECALL_SMOKE_OK`.
- [x] A detached clean worktree at
  `27dfded5cb6cd46d23b153903f51ba608f242822` completed frozen install, type
  checks, 382 tests, production build, 11 stable-Chrome Playwright tests,
  production smoke, adapter-boundary validation, and lockfile validation.
- [ ] Execute the same required gate on Linux rather than relying only on the
  configured Linux CI workflow.

## SQLite recovery matrix

The matrix is green on Windows: 68 distinct schema, migration, online-backup,
restore, route, shutdown, strict-open, sidecar-conflict, and hard-kill tests
passed.

| Fixture or interruption | Result and evidence |
| --- | --- |
| New empty database | Pass — no pre-migration snapshot; schema created |
| Current schema | Pass — connection policy and integrity verified |
| Every old schema through v4 | Pass — ordered migrations and retained data |
| Corrupt SQLite input | Pass — rejected before live database stops |
| Foreign application ID | Pass — rejected unchanged |
| Future schema | Pass — rejected unchanged |
| Foreign-key-invalid input | Pass — rejected unchanged |
| Interrupted migration | Pass — transaction rolls back every change |
| Backup while rating commits | Pass — snapshot contains the complete rating transaction or none of it |
| First live-to-rollback rename | Pass — original remains current |
| Candidate-to-live rename failure | Pass — rollback reopens original |
| Replacement reopen failure | Pass — rollback reopens original |
| Atomic commit rename failure | Pass — opened replacement is closed, then original reopens |
| Hard termination after original rename | Pass — startup restores original before SQLite open |
| Hard termination after replacement install | Pass — startup quarantines replacement and restores original |
| Hard termination after commit point | Pass — startup keeps replacement and cleans committed-old only after validation |
| Missing replacement after commit marker | Pass — startup conservatively restores old database |
| Empty/invalid replacement after commit marker | Pass — strict open cannot initialize it; startup quarantines it and restores old |
| Operational open/backup failure after commit marker | Pass — no fallback; replacement and committed-old remain intact for retry |
| Conflicting recovery markers | Pass — stable fail-closed result; no guessed database |
| Marker mixed with impossible WAL/SHM quarantine tuple | Pass — full exact-path state is checked before any rename |
| Rollback plus orphan live WAL/SHM without a live/quarantined database | Pass — rejected before any rename or cleanup |
| Interrupted candidate without live/marker | Pass — fails closed; never creates an empty live database |
| Hard termination during each committed-old fallback rename phase | Pass — exact state resumes to the original and cleans quarantine only after strict open |
| Graceful shutdown | Pass — requests drain, WAL checkpoint is passive, SQLite closes |

Primary evidence:

- `apps/server/src/durability/restore-swap-recovery.test.ts`
- `apps/server/src/durability/restore-service.test.ts`
- `packages/database/src/open-database.test.ts`
- `packages/database/src/pre-migration-backup.test.ts`
- `packages/database/src/backup-service.test.ts`
- `apps/server/src/startup/single-instance.test.ts`

## Stable Chrome and accessibility automation

- [x] Stable Chrome `150.0.7871.184`, launched headlessly by Playwright with an
  isolated test profile: 11/11 E2E tests passed.
- [x] Arabic and English critical flows passed.
- [x] Arabic RTL, English LTR, and development-only `en-XA` passed route-wide
  visual accessibility coverage.
- [x] Light/dark/system themes, reduced motion, narrow reflow, and 400%-zoom
  equivalent dimensions passed.
- [x] PWA offline shell and prompt-only update behavior passed.
- [x] Automated focus tests cover direct question, direct answer, and
  rating-to-next-question focus.
- [ ] Real NVDA speech output is not audited. Complete and sign
  `nvda-results-template.md`; automation cannot satisfy this gate.

The repeated Vite development warning about an absent React Router
`HydrateFallback` did not fail a flow and no hydration error was observed. It
is not being misreported as NVDA evidence.

## Privacy and security review

- [x] Production server and full built client passed the loopback-only DNS and
  socket fence.
- [x] Built HTML, CSS, and JavaScript contained no remote application
  dependency.
- [x] CSP restricts scripts and connections to self, with no inline scripts;
  CORS is absent; Host, Origin, and CSRF boundaries are tested.
- [x] API and HTML are `no-store`; hashed static assets alone are immutable.
- [x] Service-worker tests prove API and SSE remain network-only and study data
  is not served from cache.
- [x] Content-free log tests reject card bodies, tokens, paths, and stacks.
- [x] Tracked-file scans found no local machine path, private-key/token pattern,
  SQLite database, logs, backups, reports, or generated runtime data.
- [x] Backup download uses a validated SQLite file and synthetic audit data.
  A real downloaded backup intentionally contains the user's study data and
  must be stored as sensitive personal data.

Automated security evidence: 13/13 targeted production/security tests,
`OPENRECALL_ADAPTER_BOUNDARIES_OK`,
`OPENRECALL_LOCKFILE_VERSIONS_OK`, and
`OPENRECALL_SECURITY_PRODUCTION_AUDIT_OK`.

## Product acceptance criteria

| # | Status | Evidence |
| --- | --- | --- |
| 1 | Pending manual completion | Foundation/import and review E2E pass; review keyboard shortcuts and focus tests pass. A single human keyboard/NVDA run from section creation through summary is still required. |
| 2 | Pass | Rotation unit/property tests and review E2E prove alternate presentations share one learning item and FSRS state. |
| 3 | Pass | Queue repository, due-wake service, continuous-session integration, and review E2E cover exact/fractional due arrival without speculative fixed steps. |
| 4 | Pending NVDA | DOM focus and accessible-name automation pass; exact real speech on reveal/rating has not been heard and signed. |
| 5 | Pass | Contract, import validation/property, edit, and E2E fixtures cover required front/back with optional notes and any number of variants. |
| 6 | Pass | Statistics unit/property, API, accessible table, card disclosure, management, session-summary, and global E2E evidence pass. |
| 7 | Pass | Effective-config and settings tests prove section → global user → official default precedence. |
| 8 | Pass | Optimizer replay/apply/rollback tests, migration rollback, online backup, 68-test recovery matrix, and real hard-process termination fixtures pass. |
| 9 | Pass | Catalog static analysis, formatter/plural tests, Arabic/English parity, pseudo-locale, RTL/LTR, and route-wide browser checks pass. |
| 10 | Pending | The Windows automated suite passes, but Linux execution and signed stable Chrome/NVDA manual audit remain absent. |

## Release decision

- [ ] All ten product acceptance criteria pass.
- [ ] Stable Chrome/NVDA manual results are signed with no critical-flow defect.
- [ ] Final clean Windows and Linux runs pass at one commit.
- [ ] The owner has selected a repository license and required notices.
- [ ] A release-candidate commit is recorded.
- [ ] A public tag or release is authorized.

Current decision: **do not tag, publish, or describe this build as a release
candidate**.
