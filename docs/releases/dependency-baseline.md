# Dependency baseline

This is the dependency and runtime baseline verified on 2026-07-30. Exact
application dependencies remain pinned in package manifests and
`pnpm-lock.yaml`; this page is an audit index, not a second source of version
truth.

## Runtime and data

| Boundary | Verified version |
| --- | --- |
| Node.js | `24.18.0` |
| pnpm | `11.17.0` |
| pnpm lockfile format | `9.0` |
| `pnpm-lock.yaml` SHA-256 | `d2a14bd51a92e7ec50eae04d751fada0898296ab4d69f4b6dde8c51c28d13147` |
| `better-sqlite3` | `13.0.1` |
| SQLite reported by `better-sqlite3` | `3.53.3` |
| OpenRecall schema | `5` |
| Git used for the audit | `2.54.0.windows.1` |

The supported runtime range remains Node.js `>=24.18.0 <25`; a newer major is
not assumed compatible merely because it starts.

## Scheduling and optimization

| Boundary | Verified version |
| --- | --- |
| Scheduler algorithm | `FSRS-6` / algorithm version `6.0` |
| Scheduler adapter | version `1`, adapter schema `1` |
| Scheduler upstream | `ts-fsrs@5.4.1` |
| Optimizer adapter | `@openrecall/optimizer@0.1.0` |
| Optimizer upstream binding | `@open-spaced-repetition/binding@0.5.0` |

FSRS-7 is not silently mapped onto FSRS-6 data. It requires a new manifest,
adapter, stored-version mapping, migrations where needed, and replay,
optimizer, backup, restore, and recovery fixtures before support can be
declared.

## Application and security

| Package | Verified version |
| --- | --- |
| React / React DOM | `19.2.8` |
| React Router | `8.3.0` |
| Fastify | `5.10.0` |
| `@fastify/helmet` | `13.1.0` |
| `@fastify/static` | `10.1.2` |
| `@fastify/multipart` | `10.1.0` |
| `@fastify/sse` | `0.5.0` |
| TypeBox | `1.3.8` |
| i18next | `26.3.6` |
| Vite | `8.1.5` |
| `vite-plugin-pwa` | `1.3.0` |
| Workbox Window | `7.4.1` |

## Verification toolchain

| Package | Verified version |
| --- | --- |
| TypeScript | `7.0.2` |
| Vitest | `4.1.10` |
| Playwright | `1.62.0` |
| `@axe-core/playwright` / axe-core | `4.12.1` |
| jsdom | `30.0.0` |
| fast-check | `4.9.0` |
| tsx | `4.23.1` |
| sharp (direct build tool) | `0.35.3` |

Dependency updates are accepted only through the pinned lockfile and the
adapter, migration, clean-install, build, browser, recovery, and production
smoke gates. A version appearing in the registry is not enough evidence for an
upgrade.
