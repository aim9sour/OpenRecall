# OpenRecall agent instructions

## Verification

- Focused tests are appropriate during TDD and debugging.
- Resource-heavy repository gates (`pnpm check`, `pnpm test`, `pnpm build`,
  production smoke, and Playwright) must not run concurrently in the same
  checkout. Their CPU, memory, disk, and build-cache contention can create
  misleading timeout failures.
- Use `pnpm verify` for the serial type/license/Vitest/build sequence.
- Use `pnpm verify:full` for the complete serial release verification,
  including production smoke and Playwright. Set any E2E port offset or browser
  channel before this single command.
- Diagnose a failed assertion before rerunning a narrower test. Do not increase
  timeouts or split the full suite merely to make a contention failure pass.
