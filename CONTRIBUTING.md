# Contributing to OpenRecall

OpenRecall welcomes public contributions under the
[Apache License 2.0](LICENSE). Contributions intentionally submitted for
inclusion are licensed under Apache-2.0 as described by section 5; no separate
contributor license agreement is required. By contributing, you confirm that
you have the right to submit the work under those terms. See
[the licensing decision](docs/decisions/licensing.md) for the redistribution
boundary.

## Development setup

Use Node.js 24.18+ in the Node 24 line and pnpm 11.17.0:

```bash
pnpm install --frozen-lockfile
pnpm verify:full
```

`verify` runs type checks, the dependency-license gate, the complete Vitest
suite, and the production build sequentially. `verify:full` then runs the
production smoke test and Playwright sequentially. Do not launch these
resource-heavy gates in parallel on the same checkout; concurrent TypeScript,
Vitest, and build processes can cause misleading timeout failures on otherwise
healthy tests.

Playwright normally reserves API ports `3210`–`3214` and web ports
`5173`–`5177`. If another local checkout is already using that range, move the
whole isolated test range without stopping the other application:

```bash
OPENRECALL_E2E_PORT_OFFSET=1000 pnpm test:e2e
```

In PowerShell, set the same value with
`$env:OPENRECALL_E2E_PORT_OFFSET = "1000"` before the command. The offset must
be a whole number from `0` through `60358`; it affects test infrastructure only,
not OpenRecall's fixed production address.

Develop on a topic branch. Keep commits focused and never include real card
content, a user SQLite database, machine-specific paths, secrets, traces, or
production logs.

## Change workflow

1. Add a failing test that expresses the behavior or regression.
2. Make the smallest implementation that passes it.
3. Run the affected package tests, then the complete repository gates.
4. Update architecture, import, accessibility, migration, and changelog
   documentation when their contracts change.
5. Request a review that checks behavior, privacy, durability, and future
   compatibility—not only types.

Scheduler and optimizer changes must follow
`docs/architecture/scheduler-upgrades.md`. A dependency version is not proof of
an algorithm version. New adapters, manifests, replay fixtures, migration
coverage, backup/restore tests, and upstream changelog review are mandatory.
Never rewrite an adapter that has already persisted released data.

Database changes require an ordered migration, old/current/future schema
fixtures, a validated pre-migration backup, foreign-key and integrity checks,
and recovery-path tests. Do not edit an existing released migration.

## Accessibility review

Chrome and NVDA are the primary manual combination. Any critical-flow change
must cover keyboard-only use, focus placement, headings and landmarks, exact
question/answer announcements, live-region duplication, 400% zoom, forced
colors, reduced motion, dark/light themes, and both RTL and LTR. Automated axe
results do not replace this pass.

## Translation workflow

English and Arabic messages live under `packages/i18n/src/locales`. Add a key
to the typed locale contract, provide every production locale value, and keep
interpolation variables identical. Run locale parity tests and the development
pseudo-locale. Review the complete screen in RTL and LTR; do not concatenate
sentences or encode word order in components. Update both README files and both
Windows guides when user-facing setup behavior changes.

## Pull-request evidence

Include:

- the failing test or fixture that motivated the change;
- commands run and their fresh results;
- upstream release notes for dependency or adapter changes;
- migration/backup/restore impact;
- privacy and loopback-network impact;
- Arabic, English, RTL/LTR, and NVDA impact;
- screenshots or traces only from synthetic, content-free fixtures.

Report security problems through the private process in
[SECURITY.md](SECURITY.md), not in a public issue.
