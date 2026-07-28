# OpenRecall Foundation and Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a runnable Arabic/English local application that creates sections, stores text cards and variants in SQLite, and imports the approved JSON format through an accessible preview.

**Architecture:** A pnpm TypeScript monorepo separates the React client, Fastify server, runtime contracts, domain rules, database repositories, and translations. Fastify owns every mutation; a single `better-sqlite3` connection uses forward-only migrations and typed repositories.

**Tech Stack:** Node.js 24.18.0 LTS, pnpm 11.17.0, TypeScript 7.0.2, React 19.2.8, React Router 8.3.0, Vite 8.1.5, Fastify 5.10.0, TypeBox 1.3.8, better-sqlite3 13.0.1, i18next 26.3.6, Vitest 4.1.10, Playwright 1.62.0, fast-check 4.9.0.

## Global Constraints

- Bind the HTTP server to `127.0.0.1`; never expose a LAN bind option in v1.
- Durable user data lives in one SQLite database; JSON is card import only.
- Card `front` and `back` are required plain text; `notes` and `variants` are optional.
- Variants belong to one learning item and never create separate scheduler identities.
- Arabic and English are complete from the first page; all copy uses translation keys.
- User card text uses `dir="auto"`; the document uses the locale BCP 47 `lang` and `dir`.
- Native semantic HTML and keyboard operation are required; Chrome plus stable NVDA is the manual acceptance environment.
- All dependency versions are exact in `package.json`; pnpm's lockfile is committed.
- No application module may import scheduler or optimizer packages outside their later adapters.
- Timestamps crossing durable boundaries are epoch-millisecond integers.
- No telemetry, remote font, CDN, account, cloud API, HTML rendering, or `dangerouslySetInnerHTML`.

---

## Planned File Structure

```text
OpenRecall/
├─ apps/
│  ├─ server/src/
│  │  ├─ app.ts                  # Fastify composition
│  │  ├─ index.ts                # loopback process entry
│  │  ├─ config.ts               # port/data-dir/runtime config
│  │  ├─ security.ts             # Host/Origin/CSRF hooks
│  │  ├─ routes/bootstrap.ts
│  │  ├─ routes/sections.ts
│  │  └─ routes/import.ts
│  └─ web/src/
│     ├─ main.tsx
│     ├─ router.tsx
│     ├─ api/client.ts
│     ├─ app/AppShell.tsx
│     ├─ app/RouteFocus.tsx
│     ├─ pages/HomePage.tsx
│     ├─ pages/SectionPage.tsx
│     ├─ pages/ImportPage.tsx
│     └─ styles/base.css
├─ packages/
│  ├─ contracts/src/            # TypeBox request/response schemas
│  ├─ domain/src/               # import and content domain rules
│  ├─ database/src/             # connection, migrations, repositories
│  ├─ i18n/src/                 # locale metadata/catalogs
│  └─ test-support/src/         # temp DB and API test builders
├─ tests/e2e/
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ tsconfig.tools.json
├─ vitest.config.ts
└─ playwright.config.ts
```

### Task 1: Reproducible Monorepo and Test Harness

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.npmrc`
- Create: `.gitignore`
- Create: `.node-version`
- Create: `tsconfig.base.json`
- Create: `tsconfig.tools.json`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/app-identity.test.ts`
- Create: `packages/contracts/src/app-identity.ts`
- Create: `packages/contracts/src/index.ts`

**Interfaces:**
- Produces: `APP_NAME: "OpenRecall"`, `API_VERSION: 1`.
- Produces: root scripts `check`, `test`, `test:e2e`, `build`, and `dev`.

- [ ] **Step 1: Add exact workspace configuration**

Use a private root package with `packageManager: "pnpm@11.17.0"` and
`engines.node: ">=24.18.0 <25"`. Add exact dev dependencies:
`typescript@7.0.2`, `vitest@4.1.10`, `@playwright/test@1.62.0`,
`@axe-core/playwright@4.12.1`, `@types/node@24.13.3`,
`fast-check@4.9.0`, and `tsx@4.23.1`.
Configure these scripts:

```json
{
  "scripts": {
    "build": "pnpm -r build",
    "check": "tsc -p tsconfig.tools.json && pnpm -r check",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "dev": "pnpm --parallel --filter @openrecall/server --filter @openrecall/web dev"
  }
}
```

Declare `apps/*` and `packages/*` in `pnpm-workspace.yaml`, and explicitly allow
only the reviewed native dependency:

```yaml
packages:
  - apps/*
  - packages/*

allowBuilds:
  better-sqlite3: true
  esbuild: true
```

- [ ] **Step 2: Install and lock dependencies**

Run: `corepack enable && corepack prepare pnpm@11.17.0 --activate && pnpm install`

Expected: exit 0, `pnpm-lock.yaml` created, and no blocked-build error for the
reviewed native/binary setup packages `better-sqlite3` and `esbuild`.

- [ ] **Step 3: Write the first failing identity test**

```ts
import { describe, expect, it } from "vitest";
import { API_VERSION, APP_NAME } from "./app-identity.js";

describe("application identity", () => {
  it("is stable across packages and database versions", () => {
    expect(APP_NAME).toBe("OpenRecall");
    expect(API_VERSION).toBe(1);
  });
});
```

- [ ] **Step 4: Run the focused test and verify RED**

Run: `pnpm vitest run packages/contracts/src/app-identity.test.ts`

Expected: FAIL because `./app-identity.js` does not exist.

- [ ] **Step 5: Add the minimal identity module and exports**

```ts
export const APP_NAME = "OpenRecall" as const;
export const API_VERSION = 1 as const;
```

Export it from `packages/contracts/src/index.ts`.

- [ ] **Step 6: Run foundation verification**

Run: `pnpm vitest run packages/contracts/src/app-identity.test.ts && pnpm check`

Expected: one passing test and zero TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .gitignore .node-version tsconfig.base.json tsconfig.tools.json vitest.config.ts playwright.config.ts packages/contracts
git commit -m "build: establish OpenRecall workspace"
```

### Task 2: Shared Runtime Contracts and Locale Foundation

**Files:**
- Create: `packages/contracts/src/errors.ts`
- Create: `packages/contracts/src/sections.ts`
- Create: `packages/contracts/src/import.ts`
- Create: `packages/contracts/src/contracts.test.ts`
- Create: `packages/i18n/package.json`
- Create: `packages/i18n/src/types.ts`
- Create: `packages/i18n/src/catalog-keys.ts`
- Create: `packages/i18n/src/locales/en.ts`
- Create: `packages/i18n/src/locales/ar.ts`
- Create: `packages/i18n/src/create-i18n.ts`
- Create: `packages/i18n/src/catalog-parity.test.ts`

**Interfaces:**
- Produces: `ApiErrorSchema`, `SectionSummarySchema`, `CardImportSchema`,
  `ImportPreviewSchema`.
- Produces: `createI18n(locale: "ar" | "en")` and locale metadata.
- Consumes: `API_VERSION` from Task 1.

- [ ] **Step 1: Write failing contract tests**

Test TypeBox `Value.Check` against:

```ts
const validCard = {
  front: "Capital of Egypt?",
  back: "Cairo",
  variants: [{ front: "عاصمة مصر؟", back: "القاهرة" }],
};
const invalidCard = { front: " ", back: "Cairo" };
```

Assert the valid value passes, invalid value fails, and an API error requires a
stable `code` and `messageKey`.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/contracts/src/contracts.test.ts`

Expected: FAIL on missing schemas.

- [ ] **Step 3: Define exact public schemas**

```ts
export const CardPresentationInputSchema = Type.Object({
  front: Type.String({ minLength: 1, maxLength: 20_000, pattern: "\\S" }),
  back: Type.String({ minLength: 1, maxLength: 20_000, pattern: "\\S" }),
  notes: Type.Optional(Type.Union([
    Type.String({ maxLength: 20_000 }),
    Type.Null(),
  ])),
}, { additionalProperties: true });

export const CardImportSchema = Type.Intersect([
  CardPresentationInputSchema,
  Type.Object({
    variants: Type.Optional(Type.Array(CardPresentationInputSchema)),
  }),
]);

export const ApiErrorSchema = Type.Object({
  code: Type.String(),
  messageKey: Type.String(),
  fieldErrors: Type.Optional(Type.Array(Type.Object({
    path: Type.String(),
    messageKey: Type.String(),
  }))),
});
```

Define section schemas with UUID strings, epoch-millisecond integers, and counts
`total`, `new`, `dueNow`, plus nullable `nextDueAtMs`.

- [ ] **Step 4: Write failing locale parity tests**

Assert both catalogs contain the exact keys in `CATALOG_KEYS`, including
`app.name`, `nav.home`, `section.create`, `import.preview`, `import.commit`,
`error.summary`, and Arabic plural forms for card counts.

- [ ] **Step 5: Run and verify RED**

Run: `pnpm vitest run packages/i18n/src/catalog-parity.test.ts`

Expected: FAIL because locale modules are missing.

- [ ] **Step 6: Implement locale packages**

```ts
export interface LocaleDefinition {
  readonly tag: "ar" | "en";
  readonly displayName: string;
  readonly direction: "rtl" | "ltr";
  readonly resources: Record<string, string>;
}
```

Create complete English and Arabic values for every key defined in
`CATALOG_KEYS`; configure i18next with `fallbackLng: false`,
`returnNull: false`, and `interpolation.escapeValue: false` because React text
nodes perform the escaping. No translated value is rendered as HTML.

- [ ] **Step 7: Run contract and locale verification**

Run: `pnpm vitest run packages/contracts packages/i18n && pnpm check`

Expected: all tests pass and both catalogs have identical required keys.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts packages/i18n
git commit -m "feat: define runtime contracts and base locales"
```

### Task 3: SQLite Connection, Migration Runner, and Core Schema

**Files:**
- Create: `packages/database/package.json`
- Create: `packages/database/src/constants.ts`
- Create: `packages/database/src/open-database.ts`
- Create: `packages/database/src/migrate.ts`
- Create: `packages/database/src/migrations/001-core.ts`
- Create: `packages/database/src/open-database.test.ts`
- Create: `packages/test-support/package.json`
- Create: `packages/test-support/src/temp-database.ts`

**Interfaces:**
- Produces: `openDatabase(path: string): Database.Database`.
- Produces: `migrateDatabase(db): void`.
- Produces: `withTempDatabase(testFn): Promise<void>`.
- Database identity: `application_id = 1330795587`, schema `user_version = 1`.

- [ ] **Step 1: Write failing connection-policy test**

Open a temporary database and assert:

```ts
expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
expect(db.pragma("synchronous", { simple: true })).toBe(2);
expect(db.pragma("trusted_schema", { simple: true })).toBe(0);
expect(db.pragma("application_id", { simple: true })).toBe(1330795587);
expect(db.pragma("user_version", { simple: true })).toBe(1);
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/database/src/open-database.test.ts`

Expected: FAIL because `openDatabase` does not exist.

- [ ] **Step 3: Implement connection policy with read-back verification**

Open one `better-sqlite3` connection, set `busy_timeout = 5000`,
`foreign_keys = ON`, `journal_mode = WAL`, `synchronous = FULL`, and
`trusted_schema = OFF`. Read each critical value back and throw a
content-free startup error if it differs.

- [ ] **Step 4: Write failing migration test**

Assert migration creates the core tables and these indexes:

```text
sections
learning_items
presentations
presentation_exposures
application_settings
idx_learning_items_section_active
idx_presentations_learning_item_order
```

Also assert deleting a section cascades through its active/trash card content.

- [ ] **Step 5: Run and verify RED**

Run: `pnpm vitest run packages/database/src/open-database.test.ts`

Expected: FAIL because tables are absent.

- [ ] **Step 6: Add migration `001-core`**

Use `STRICT` tables and this durable shape:

```sql
CREATE TABLE sections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE learning_items (
  id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  lifecycle TEXT NOT NULL DEFAULT 'active'
    CHECK(lifecycle IN ('active', 'trashed')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  trashed_at_ms INTEGER
) STRICT;

CREATE TABLE presentations (
  id TEXT PRIMARY KEY,
  learning_item_id TEXT NOT NULL
    REFERENCES learning_items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('primary', 'variant')),
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  front TEXT NOT NULL CHECK(length(trim(front)) > 0),
  back TEXT NOT NULL CHECK(length(trim(back)) > 0),
  notes TEXT,
  normalized_front TEXT NOT NULL,
  normalized_back TEXT NOT NULL,
  UNIQUE(learning_item_id, ordinal)
) STRICT;

CREATE TABLE presentation_exposures (
  presentation_id TEXT PRIMARY KEY
    REFERENCES presentations(id) ON DELETE CASCADE,
  first_shown_at_ms INTEGER,
  last_shown_at_ms INTEGER,
  show_count INTEGER NOT NULL DEFAULT 0 CHECK(show_count >= 0),
  last_session_id TEXT,
  last_learning_item_id TEXT
) STRICT;

CREATE TABLE application_settings (
  key TEXT PRIMARY KEY,
  json_value TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_learning_items_section_active
  ON learning_items(section_id, lifecycle, created_at_ms);
CREATE INDEX idx_presentations_learning_item_order
  ON presentations(learning_item_id, ordinal);
```

Apply migrations inside a transaction, then set `application_id` and
`user_version`. Run `quick_check`, `foreign_key_check`, and `PRAGMA optimize`.

- [ ] **Step 7: Verify migration and rollback**

Run: `pnpm vitest run packages/database && pnpm check`

Expected: connection policy, schema, cascade, and failed-migration rollback
tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/database packages/test-support
git commit -m "feat: add durable SQLite core"
```

### Task 4: Fastify Loopback and Mutation Security

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/security.ts`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/index.ts`
- Create: `apps/server/src/routes/bootstrap.ts`
- Create: `apps/server/src/app.test.ts`
- Create: `packages/test-support/src/test-server.ts`

**Interfaces:**
- Produces: `buildServer(options): Promise<FastifyInstance>`.
- Produces: `GET /api/v1/bootstrap -> { apiVersion, csrfToken, locale }`.
- Requires exact configured loopback `Host` authority and exact configured
  mutation `Origin`. Production sets both to `http://127.0.0.1:3210`;
  development keeps server Host `127.0.0.1:3210` but explicitly sets public
  Origin `http://127.0.0.1:5173` behind Vite's same-origin proxy.
- Requires `X-OpenRecall-CSRF` for every non-GET API method.

- [ ] **Step 1: Write failing security integration tests**

Use Fastify injection to assert:

- Valid bootstrap returns a nonempty random token.
- Wrong Host returns `421`.
- Mutation with wrong Origin returns `403`.
- Mutation without the custom token returns `403`.
- Unknown response properties are removed by the response schema.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/server/src/app.test.ts`

Expected: FAIL because the server builder is missing.

- [ ] **Step 3: Implement config and security hooks**

`loadConfig` must default to port `3210`, host `127.0.0.1`, public production
origin `http://127.0.0.1:3210`, and an `env-paths("OpenRecall")` data directory.
Development may set only the explicit loopback public origin `5173`; arbitrary
origin/host environment values are rejected. Generate 32 random bytes per
process and encode them as base64url. Compare Host, Origin, and token using exact
values; GET/HEAD/OPTIONS remain nonmutating.

- [ ] **Step 4: Implement bootstrap and error envelope**

Build Fastify with TypeBox provider. Register a content-free error handler that
maps validation errors to:

```ts
{
  code: "VALIDATION_ERROR",
  messageKey: "error.validation",
  fieldErrors: [{ path: "/name", messageKey: "error.field.invalid" }]
}
```

Never include request bodies or card text in logs.

- [ ] **Step 5: Run security tests**

Run: `pnpm vitest run apps/server/src/app.test.ts && pnpm check`

Expected: all Host, Origin, token, and response-serialization cases pass.

- [ ] **Step 6: Commit**

```bash
git add apps/server packages/test-support
git commit -m "feat: secure the loopback server"
```

### Task 5: Section Repository and API

**Files:**
- Create: `packages/database/src/section-repository.ts`
- Create: `packages/database/src/section-repository.test.ts`
- Create: `apps/server/src/routes/sections.ts`
- Create: `apps/server/src/routes/sections.test.ts`

**Interfaces:**
- Produces:
  `createSection(input: { name: string; nowMs: number }): Section`.
- Produces: `listSections(nowMs: number): SectionSummary[]`.
- Routes: `GET /api/v1/sections`, `POST /api/v1/sections`,
  `GET /api/v1/sections/:sectionId`.

- [ ] **Step 1: Write failing repository tests**

Assert trimming, 1–200 character validation, UUID creation, deterministic
ordering by `updated_at_ms DESC, id`, and empty statistics:
`total=0`, `new=0`, `dueNow=0`, `nextDueAtMs=null`.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/database/src/section-repository.test.ts`

Expected: FAIL on missing repository.

- [ ] **Step 3: Implement prepared repository statements**

Keep SQL inside `section-repository.ts`; return explicit mapped objects rather
than spreading SQLite rows. Use `crypto.randomUUID()` and inject `nowMs` for
testability.

- [ ] **Step 4: Write failing route tests**

Assert a valid POST returns `201`, whitespace name returns the localized error
code, GET returns the created section, and a missing UUID returns `404` without
leaking SQL details.

- [ ] **Step 5: Run and verify RED**

Run: `pnpm vitest run apps/server/src/routes/sections.test.ts`

Expected: FAIL because section routes are not registered.

- [ ] **Step 6: Implement routes with request and response schemas**

Use `SectionCreateSchema`, `SectionSchema`, and `SectionSummarySchema` from
contracts. Register the routes under `/api/v1`; mutations use the existing
security hook.

- [ ] **Step 7: Run section verification**

Run: `pnpm vitest run packages/database/src/section-repository.test.ts apps/server/src/routes/sections.test.ts`

Expected: all repository/API tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/database apps/server/src/routes
git commit -m "feat: create and list learning sections"
```

### Task 6: Accessible React Shell, Home, and Section Pages

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/index.html`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/router.tsx`
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/app/AppShell.tsx`
- Create: `apps/web/src/app/RouteFocus.tsx`
- Create: `apps/web/src/pages/HomePage.tsx`
- Create: `apps/web/src/pages/SectionPage.tsx`
- Create: `apps/web/src/styles/base.css`
- Create: `apps/web/src/pages/HomePage.test.tsx`

**Interfaces:**
- Produces: routes `/` and `/sections/:sectionId`.
- Produces: `api.get`, `api.post` with bootstrap-token attachment.
- Consumes: section API from Task 5 and locale package from Task 2.
- Vite development proxies `/api` to `127.0.0.1:3210` with `changeOrigin: true`;
  the browser remains same-origin at the explicitly configured port 5173.

- [ ] **Step 1: Write failing Home page accessibility test**

Render with a memory router and assert:

- One `main` landmark and one level-one heading.
- A skip link targets `#main-content`.
- Every section has a native start-review button temporarily disabled with an
  explanatory accessible description until Stage 2.
- Create-section errors render in a persistent focusable summary.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/web/src/pages/HomePage.test.tsx`

Expected: FAIL because the page does not exist.

- [ ] **Step 3: Implement API bootstrap and shell**

Fetch `/api/v1/bootstrap` once, hold the token in memory only, attach it to
mutations, and retry bootstrap once after a server restart returns `403`.
`AppShell` uses native header/nav/main landmarks and text links.

- [ ] **Step 4: Implement route focus**

On navigation, focus the actual route `<h1 tabIndex={-1}>`. Do not announce
duplicate page text through a live region. Preserve user focus during
fetcher-only revalidation.

- [ ] **Step 5: Implement Home and Section pages**

Use React Router loaders for GET data and actions/fetchers for section creation.
Show total/new/due counts as text, not color alone. Use i18next for all visible
and accessible copy. Update `<html lang>` and `<html dir>` on locale changes.

- [ ] **Step 6: Run component and axe tests**

Run: `pnpm vitest run apps/web/src/pages/HomePage.test.tsx`

Expected: focus, landmarks, error summary, Arabic direction, and zero serious
axe violations all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat: add accessible section interface"
```

### Task 7: Plain-Text JSON Import Domain and Repository

**Files:**
- Create: `packages/domain/package.json`
- Create: `packages/domain/src/import/normalize.ts`
- Create: `packages/domain/src/import/detect-markup.ts`
- Create: `packages/domain/src/import/validate-import.ts`
- Create: `packages/domain/src/import/validate-import.test.ts`
- Create: `packages/domain/src/import/validate-import.property.test.ts`
- Create: `packages/database/src/card-import-repository.ts`
- Create: `packages/database/src/card-import-repository.test.ts`

**Interfaces:**
- Produces:
  `validateImportJson(value: unknown, existing: DuplicateKeySet): ImportPreview`.
- Produces:
  `commitImport(sectionId, acceptedItems, nowMs): { importedItemIds: string[] }`.
- Duplicate key: NFC-normalized, CRLF-normalized, trimmed exact
  `front + "\u0000" + back`.

- [ ] **Step 1: Write failing example validation tests**

Cover one object, an array, optional/null notes, any number of variants within
the overall file-size bound, empty front/back, non-string fields, unknown-field
warnings, exact duplicate warnings, and issue paths such as
`cards[2].variants[1].back`.

- [ ] **Step 2: Write failing markup discrimination tests**

Assert rejection of `<script>`, `</p>`, `<img src=x>`, `<!--x-->`, and
`<!doctype html>`, while accepting `a < b > c`, `2 < 3`, `<3`, and Arabic text
containing mathematical comparison symbols.

- [ ] **Step 3: Run and verify RED**

Run: `pnpm vitest run packages/domain/src/import`

Expected: FAIL because validators are missing.

- [ ] **Step 4: Implement normalization and markup detection**

Normalize line endings to `\n`, normalize Unicode to NFC, trim only outer
whitespace for duplicate keys, and retain the user's internal whitespace.
Detect comments/declarations and opening/closing tag grammar beginning
immediately after `<`; do not reject spaced mathematical comparisons.

- [ ] **Step 5: Implement bounded validation**

Limits:

- 5 MiB decoded JSON input.
- 10,000 learning items per import.
- 20,000 Unicode code points per text field.
- No separate variants-per-item cap; the file-size and text-field bounds limit
  resource use without treating variants as separate learning items.

Return `valid`, `duplicate`, and `invalid` item rows plus warnings; never throw
for a structurally reportable card issue.

- [ ] **Step 6: Add property tests**

Use fast-check to prove the validator never throws for arbitrary JSON values,
normalization is idempotent, and valid plain-text presentations round-trip.

- [ ] **Step 7: Run domain verification**

Run: `pnpm vitest run packages/domain/src/import`

Expected: all example and property tests pass.

- [ ] **Step 8: Write failing atomic repository tests**

Assert one learning item plus all presentations commit together, primary has
ordinal 0, variant ordinals are stable, exposure rows start at zero, and an
invalid second item rolls the whole batch back.

- [ ] **Step 9: Implement one immediate import transaction**

Prepare all insert statements once. Use `db.transaction(...).immediate`;
generate UUIDs inside the transaction, insert presentation exposure rows, and
return learning-item IDs only after commit.

- [ ] **Step 10: Run repository tests**

Run: `pnpm vitest run packages/database/src/card-import-repository.test.ts`

Expected: atomicity, cascade, ordering, and duplicate behavior pass.

- [ ] **Step 11: Commit**

```bash
git add packages/domain packages/database
git commit -m "feat: validate and store card imports"
```

### Task 8: Import API and Accessible Preview

**Files:**
- Create: `apps/server/src/routes/import.ts`
- Create: `apps/server/src/routes/import.test.ts`
- Create: `apps/web/src/pages/ImportPage.tsx`
- Create: `apps/web/src/pages/ImportPage.test.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/pages/SectionPage.tsx`
- Create: `tests/e2e/foundation-content.spec.ts`

**Interfaces:**
- Routes:
  `POST /api/v1/sections/:sectionId/import/preview`,
  `POST /api/v1/sections/:sectionId/import/commit`.
- Preview sends parsed JSON plus a client-generated `previewId`; commit sends
  only the selected normalized item indexes and the same content digest.

- [ ] **Step 1: Write failing API tests**

Assert server-side revalidation, 5 MiB body limit, missing section `404`,
preview digest generation, stale/tampered digest rejection, and all-or-nothing
commit of selected valid nonduplicates.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/server/src/routes/import.test.ts`

Expected: FAIL because import routes are absent.

- [ ] **Step 3: Implement preview and commit routes**

Hash canonical validated content with SHA-256. The commit request resends the
original parsed JSON, selected indexes, and digest so the stateless server can
revalidate without keeping card text in memory between requests.

- [ ] **Step 4: Write failing component tests**

Assert:

- Native file input accepts `.json,application/json`.
- Keyboard users can choose a file, inspect every issue, uncheck items, and
  commit.
- Error summary receives focus and links to indexed issues.
- Optional notes/variants never block a valid base card.
- Card preview cells use `dir="auto"` and render text literally.

- [ ] **Step 5: Run and verify RED**

Run: `pnpm vitest run apps/web/src/pages/ImportPage.test.tsx`

Expected: FAIL because the page is absent.

- [ ] **Step 6: Implement client parsing and preview**

Reject oversized files before parsing, catch JSON syntax errors, send parsed
content to server preview, and render a native table with status text. Do not
use HTML injection. Keep the confirm button disabled until at least one valid,
nonduplicate row is selected.

- [ ] **Step 7: Add end-to-end foundation flow**

The Playwright test starts a temporary server/database, creates an Arabic-named
section, imports one primary plus two variants, reloads the page, and verifies
one learning item and three presentations appear as one card.

- [ ] **Step 8: Run complete Stage 1 verification**

Run:

```bash
pnpm check
pnpm test
pnpm build
pnpm test:e2e --grep "foundation content"
```

Expected: zero type errors, all unit/integration tests pass, both apps build,
and the keyboard import flow passes.

- [ ] **Step 9: Commit**

```bash
git add apps/server apps/web tests/e2e
git commit -m "feat: deliver accessible JSON card import"
```

## Stage 1 Exit Gate

- [ ] Start the production server and verify it listens only on
  `127.0.0.1:3210`.
- [ ] Run `PRAGMA quick_check` and `foreign_key_check` against the E2E database;
  require `ok` and zero rows respectively.
- [ ] Complete create-section and JSON-import flows in Arabic and English using
  keyboard only.
- [ ] Record a manual NVDA smoke result for landmarks, headings, form errors,
  and literal card text.
- [ ] Tag the runnable increment only after all commands above pass.
