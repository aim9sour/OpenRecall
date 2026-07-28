# OpenRecall Complete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the complete local, multilingual, Chrome/NVDA-first OpenRecall spaced-repetition web application as one continuous delivery.

**Architecture:** Five linked stage plans create independently runnable increments while preserving one set of application-owned contracts around FSRS, time, SQLite, and accessibility. Work proceeds in order; every task uses a red-green-refactor test cycle and ends in a reviewable commit.

**Tech Stack:** Node.js 24.18.0 LTS, pnpm 11.17.0, TypeScript 7.0.2, React 19.2.8, React Router 8.3.0, Vite 8.1.5, Fastify 5.10.0, TypeBox 1.3.8, better-sqlite3 13.0.1, ts-fsrs 5.4.1/FSRS-6, optimizer binding 0.5.0, i18next 26.3.6, Temporal polyfill 0.5.1, Vitest 4.1.10, Playwright 1.62.0, axe-playwright 4.12.1, and fast-check 4.9.0.

## Global Constraints

- Execute all five stage plans in numeric order; later interfaces depend on earlier names.
- Deliver the full product in one continuous implementation run, with each stage remaining runnable.
- Use an isolated worktree at execution time; never overwrite unrelated user changes.
- Pin exact direct dependencies and commit `pnpm-lock.yaml`.
- Store durable data in one SQLite database and use JSON only for card import.
- Bind only to `127.0.0.1:3210` and allow no outbound runtime network traffic.
- Keep scheduler/optimizer dependencies behind their application-owned adapters.
- Treat FSRS-6 as supported; do not claim FSRS-7 before a stable upstream implementation.
- Use exact due timestamps and database rechecks; never hard-code follow-up queue steps.
- Treat Arabic/English, keyboard access, and Chrome/NVDA behavior as release requirements.
- Do not publish a public release until the repository owner explicitly selects a license.

---

## Stage Sequence

### Stage 1: Foundation and Content

Plan:
[`2026-07-28-openrecall-01-foundation-content.md`](2026-07-28-openrecall-01-foundation-content.md)

Eight tasks establish the monorepo, contracts, locales, SQLite core, loopback
security, section UI, JSON validation, and accessible import. Exit artifact: a
runnable local app that creates sections and stores a primary card plus variants
as one learning item.

### Stage 2: Review Core

Plan:
[`2026-07-28-openrecall-02-review-core.md`](2026-07-28-openrecall-02-review-core.md)

Ten tasks add time projection, the FSRS-6 adapter, review schema, smart rotation,
dynamic queue, atomic rating, due wake/SSE, API, focus/shortcuts, and complete
session states. Exit artifact: a keyboard/NVDA-operable continuous review
session driven only by exact stored due times.

### Stage 3: Management and Statistics

Plan:
[`2026-07-28-openrecall-03-management-statistics.md`](2026-07-28-openrecall-03-management-statistics.md)

Seven tasks add editing, trash/restore/permanent deletion, pure metric
definitions, indexed aggregates, APIs, and screen-reader-equivalent charts and
tables. Exit artifact: complete card management and trustworthy scoped
statistics.

### Stage 4: Optimizer and Durability

Plan:
[`2026-07-28-openrecall-04-optimizer-durability.md`](2026-07-28-openrecall-04-optimizer-durability.md)

Eleven tasks add settings/parameter precedence, optimizer prefix construction,
worker training/cancellation, candidate preview/replay/application/rollback,
online backup, and staged restore. Exit artifact: safe personalized scheduling
and recoverable SQLite data.

### Stage 5: Release Hardening

Plan:
[`2026-07-28-openrecall-05-release-hardening.md`](2026-07-28-openrecall-05-release-hardening.md)

Eight tasks complete locales, visual themes, PWA, production security, Windows
startup, documentation, CI, and the final automated/manual audit. Exit artifact:
a release candidate; public publication remains separately blocked by the
license decision.

## Cross-Stage Interface Registry

| Owner | Stable interface consumed later |
|---|---|
| `packages/contracts` | TypeBox API request/response schemas and stable error codes |
| `packages/i18n` | Locale registry, complete catalogs, explicit formatters |
| `packages/domain/time` | `StudyDayConfig`, scheduler projection, study-day keys |
| `packages/scheduler` | `SchedulerStateV1`, settings manifest, preview/apply/retrievability |
| `packages/optimizer` | Training-set prefix builder and cancellable worker client |
| `packages/database` | One verified connection, migrations, typed synchronous repositories |
| `apps/server` | Same-origin `/api/v1` plus content-free SSE invalidations |
| `apps/web` | React Router loaders/actions/revalidation and semantic focus contract |

Names in this table may change only by updating every consuming plan before
implementation. Raw upstream scheduler/optimizer types never cross these
boundaries.

## Execution Order and Checkpoints

- [ ] Execute Stage 1 tasks 1–8 and pass its exit gate.
- [ ] Execute Stage 2 tasks 1–10 and pass its exit gate.
- [ ] Execute Stage 3 tasks 1–7 and pass its exit gate.
- [ ] Execute Stage 4 tasks 1–11 and pass its exit gate.
- [ ] Execute Stage 5 tasks 1–8 and pass its exit gate.
- [ ] Run the final clean-worktree verification and manual Chrome/NVDA audit.
- [ ] Compare evidence against all ten product acceptance criteria.
- [ ] Stop before public tagging/publishing unless the user has selected a license.

## Commands Required at Every Stage Gate

```bash
pnpm check
pnpm test
pnpm build
pnpm test:e2e
git status --short
```

The implementer must read the full approved design and technical research before
Task 1:

- `docs/superpowers/specs/2026-07-28-openrecall-design.md`
- `docs/superpowers/research/2026-07-28-openrecall-technical-research.md`

If a library's installed API differs from the recorded research, stop that task,
capture exact package/source evidence, update the adapter research and plan, and
obtain approval for behavior-changing differences before proceeding.

## Spec Coverage Matrix

| Approved design section | Implementing tasks |
|---|---|
| 1–3 Purpose, scope, architecture | Stage 1 Tasks 1–4; Stage 5 Tasks 4–7 |
| 4 Durable data model | Stage 1 Task 3; Stage 2 Task 3; Stage 4 Task 1 |
| 5 Dynamic session queue | Stage 2 Tasks 5–8 |
| 6 Smart presentation rotation | Stage 2 Task 4 |
| 7 Home/section/review/completion/nothing-due pages | Stage 1 Task 6; Stage 2 Tasks 8–10 |
| 7 Global statistics/settings pages | Stage 3 Tasks 5–6; Stage 4 Tasks 3 and 6 |
| 8 Screen-reader and keyboard contract | Stage 1 Tasks 6 and 8; Stage 2 Tasks 9–10; Stage 5 Tasks 2 and 8 |
| 9 JSON import | Stage 1 Tasks 7–8 |
| 10 Deletion and SQLite backup | Stage 3 Tasks 1–2; Stage 4 Tasks 7 and 9–10 |
| 11 Settings and parameter precedence | Stage 4 Tasks 1–3 |
| 12 Optimizer training/application | Stage 4 Tasks 4–8 |
| 13 Statistics | Stage 3 Tasks 3–7 |
| 14 Internationalization/visual system | Stage 1 Task 2; Stage 5 Tasks 1–2 |
| 15 Security/privacy | Stage 1 Task 4; Stage 5 Tasks 3–5 |
| 16 Reliability/error handling | Stage 2 Tasks 6–8; Stage 4 Tasks 7–10; Stage 5 Task 5 |
| 17 Verification strategy | Every task's TDD cycle; all stage exit gates; Stage 5 Tasks 7–8 |
| 18 Repository/maintenance | Stage 5 Tasks 5–7 |
| 19 Delivery stages | The five ordered plan documents |
| 20 Acceptance criteria | Stage 5 Task 8 evidence mapping |

Self-review found no uncovered design section. Any future spec amendment must add
or update its implementing task in this matrix.
