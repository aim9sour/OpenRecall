# Language and Section Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an immediately applied, SQLite-backed language preference plus accessible section rename and atomic permanent section deletion, including safe invalidation of live review tabs.

**Architecture:** Reuse the existing `application_settings` table through a focused application-preference repository and expose it through bootstrap plus a dedicated locale mutation route. Extend section contracts and the section repository with optimistic-concurrency rename/delete operations; schema version 6 makes every section-owned history path cascade safely, while a server coordinator quiesces optimizer work and publishes a typed SSE deletion event only after commit. React components subscribe to i18next changes, use the existing locale registry, and provide native, focus-managed forms.

**Tech Stack:** Node.js 24.18.x, pnpm 11.17.0, TypeScript 7.0.2, React 19.2.8, React Router 8.3.0, i18next 26.3.6, Fastify 5.10.0 with TypeBox 1.3.8, better-sqlite3 13.0.1, SQLite/WAL, Vitest 4.1.10, Playwright 1.62.0, Chrome.

## Global Constraints

- SQLite is the canonical language store; local storage is only startup fallback and cross-tab notification.
- `OPENRECALL_LOCALE` initializes a missing preference and never overrides an existing SQLite value.
- Only registered production locales appear in Settings; `en-XA` is permitted only in explicitly enabled development/test startup.
- Language changes apply without document reload and update translations, `<html lang>`, `<html dir>`, title, and formatters.
- Section deletion is permanent, immediate, checkbox-gated, and atomic for all live database data owned by the section.
- Full-database `.sqlite3` backup files are not rewritten or removed during section deletion.
- No new external runtime dependency is allowed; only workspace dependency edges may be added.
- All user-visible and accessible strings must have complete Arabic and English catalogs and pass pseudo-locale checks.
- Automated work must never launch, control, configure, inspect, or query the user's real NVDA installation.
- Preserve the current review-card rule: only the words Question, Answer, and Notes are headings; card content remains plain focusable text.

## Authoritative References

- i18next `changeLanguage()` returns a Promise and emits `languageChanged`: <https://www.i18next.com/overview/api>
- SQLite foreign-key actions and their trigger order: <https://sqlite.org/foreignkeys.html>
- SQLite's safe generalized table-rebuild procedure: <https://www.sqlite.org/lang_altertable.html#making_other_kinds_of_table_schema_changes>
- Fastify TypeBox type-provider behavior: <https://fastify.dev/docs/v5.10.x/Reference/Type-Providers/>
- Cross-tab `storage` fires in other same-origin tabs, not the writing tab: <https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event>
- React Router navigation state is read through `useLocation().state`: <https://reactrouter.com/api/hooks/useNavigate>

---

### Task 1: Locale contracts and SQLite preference repository

**Files:**
- Modify: `packages/contracts/package.json`
- Modify: `packages/database/package.json`
- Create: `packages/contracts/src/application-preferences.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Create: `packages/database/src/application-preference-repository.ts`
- Create: `packages/database/src/application-preference-repository.test.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `SUPPORTED_LOCALES`, `LocaleTag`, and `ProductionLocaleTag` from `@openrecall/i18n`; existing strict `application_settings(key, json_value, updated_at_ms)`.
- Produces: `ApplicationLocalePreference`, `ApplicationLocalePreferenceMutation`, `ApplicationPreferenceRepository`, and `ApplicationPreferenceConflictError` for Tasks 2 and 3.

- [ ] **Step 1: Add failing runtime-contract tests**

Add workspace dependencies on `@openrecall/i18n` to contracts and database, regenerate the lockfile with `pnpm install --lockfile-only`, then add checks proving only production tags are accepted by the public mutation:

```ts
expect(Value.Check(ApplicationLocalePreferenceSchema, {
  locale: "ar",
  updatedAtMs: 100,
})).toBe(true);
expect(Value.Check(ApplicationLocalePreferenceMutationSchema, {
  locale: "en",
  expectedUpdatedAtMs: 100,
})).toBe(true);
expect(Value.Check(ApplicationLocalePreferenceMutationSchema, {
  locale: "en-XA",
  expectedUpdatedAtMs: 100,
})).toBe(false);
```

- [ ] **Step 2: Run the contract test and verify the missing exports fail**

Run: `pnpm exec vitest run packages/contracts/src/contracts.test.ts`

Expected: FAIL because `ApplicationLocalePreferenceSchema` and `ApplicationLocalePreferenceMutationSchema` are not exported.

- [ ] **Step 3: Add the shared preference schemas**

Create `application-preferences.ts` with registry-derived production literals and the versioned response/mutation shapes:

```ts
import {
  SUPPORTED_LOCALES,
  type ProductionLocaleTag,
} from "@openrecall/i18n";
import { Type, type Static } from "typebox";
import { EpochMillisecondsSchema } from "./sections.js";

export const ProductionLocaleSchema = Type.Union(
  SUPPORTED_LOCALES.map((tag) => Type.Literal(tag)),
);

export const ApplicationLocalePreferenceSchema = Type.Object(
  {
    locale: ProductionLocaleSchema,
    updatedAtMs: EpochMillisecondsSchema,
  },
  { additionalProperties: false },
);

export const ApplicationLocalePreferenceMutationSchema = Type.Object(
  {
    locale: ProductionLocaleSchema,
    expectedUpdatedAtMs: EpochMillisecondsSchema,
  },
  { additionalProperties: false },
);

export type ApplicationLocalePreference = Omit<
  Static<typeof ApplicationLocalePreferenceSchema>,
  "locale"
> & { readonly locale: ProductionLocaleTag };
export type ApplicationLocalePreferenceMutation = Omit<
  Static<typeof ApplicationLocalePreferenceMutationSchema>,
  "locale"
> & { readonly locale: ProductionLocaleTag };
```

Export these names from `packages/contracts/src/index.ts`.

- [ ] **Step 4: Run the contracts test and verify it passes**

Run: `pnpm exec vitest run packages/contracts/src/contracts.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing repository tests for initialization, persistence, development policy, malformed data, and conflicts**

The tests must create a real temporary SQLite database and assert:

```ts
const repository = new ApplicationPreferenceRepository(db, {
  allowedLocales: ["ar", "en"],
  initialLocale: "ar",
  nowMs: () => 1_000,
});
expect(repository.initializeLocale()).toEqual({
  locale: "ar",
  updatedAtMs: 1_000,
});
expect(JSON.parse(db.prepare(
  "SELECT json_value FROM application_settings WHERE key = 'ui.locale'",
).pluck().get() as string)).toEqual({ version: 1, locale: "ar" });

expect(repository.saveLocale({
  locale: "en",
  expectedUpdatedAtMs: 1_000,
  nowMs: 1_000,
})).toEqual({ locale: "en", updatedAtMs: 1_001 });
```

Also verify that reopening with initial `ar` preserves saved `en`, an allowed `en-XA` initial value can be stored for the pseudo-locale server, a stored `en-XA` is rejected when it is not in `allowedLocales`, malformed JSON raises `APPLICATION_LOCALE_PERSISTED_INVALID`, unsupported saves raise `APPLICATION_LOCALE_NOT_ALLOWED`, and a stale revision throws `ApplicationPreferenceConflictError` whose `current` contains the latest value.

- [ ] **Step 6: Run the repository test and verify it fails**

Run: `pnpm exec vitest run packages/database/src/application-preference-repository.test.ts`

Expected: FAIL because the repository module does not exist.

- [ ] **Step 7: Implement the focused repository**

Use the exact storage key and JSON version below. Validate the allowed-locale set before every return, initialize with `INSERT ... ON CONFLICT DO NOTHING`, and serialize compare-and-swap through `db.transaction(...).immediate()`:

```ts
const LOCALE_KEY = "ui.locale";
const LOCALE_VALUE_VERSION = 1;

interface StoredLocaleValue {
  readonly version: 1;
  readonly locale: LocaleTag;
}

export class ApplicationPreferenceConflictError extends Error {
  constructor(
    readonly current: StoredApplicationLocalePreference,
  ) {
    super("APPLICATION_SETTING_CONFLICT");
  }
}

export interface ApplicationPreferenceRepositoryOptions {
  readonly allowedLocales: readonly LocaleTag[];
  readonly initialLocale: LocaleTag;
  readonly nowMs: () => number;
}

export interface StoredApplicationLocalePreference {
  readonly locale: LocaleTag;
  readonly updatedAtMs: number;
}

export class ApplicationPreferenceRepository {
  initializeLocale(): StoredApplicationLocalePreference;
  getLocale(): StoredApplicationLocalePreference;
  saveLocale(input: {
    readonly locale: ProductionLocaleTag;
    readonly expectedUpdatedAtMs: number;
    readonly nowMs: number;
  }): ApplicationLocalePreference;
}
```

For successful saves compute `updatedAtMs = Math.max(input.nowMs, current.updatedAtMs + 1)`. Return production save values as `ApplicationLocalePreference`; initialization/get may return `StoredApplicationLocalePreference` so an explicitly allowed development locale remains type-safe. The conflict error uses the stored type because a development server can conflict while its current value is `en-XA`.

- [ ] **Step 8: Run database and contract checks**

Run: `pnpm exec vitest run packages/database/src/application-preference-repository.test.ts packages/contracts/src/contracts.test.ts && pnpm --filter @openrecall/database check && pnpm --filter @openrecall/contracts check`

Expected: all tests and both TypeScript checks PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add packages/contracts packages/database pnpm-lock.yaml
git commit -m "feat(settings): persist application locale preference"
```

---

### Task 2: Locale bootstrap and server mutation API

**Files:**
- Create: `apps/server/src/routes/application-preferences.ts`
- Create: `apps/server/src/routes/application-preferences.test.ts`
- Modify: `apps/server/src/routes/bootstrap.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/app.test.ts`
- Modify: `apps/server/src/routes/restore.test.ts`
- Modify: `apps/server/src/startup/single-instance.test.ts`
- Modify: `tests/security/no-outbound-network.test.ts`

**Interfaces:**
- Consumes: `ApplicationPreferenceRepository` and contracts from Task 1; `config.locale`; restore-time `rebuildServices()`.
- Produces: bootstrap `{ locale, localeUpdatedAtMs }`, `PUT /api/v1/application-settings/locale`, and a dynamically rebuilt preference service used by Task 3.

- [ ] **Step 1: Write failing route tests**

Cover initial database persistence, successful change, monotonic same-millisecond revision, unsupported `en-XA`, stale update, and restart persistence. The key assertions are:

```ts
expect(bootstrap.json()).toMatchObject({
  locale: "en",
  localeUpdatedAtMs: 1_500,
});

const saved = await server.inject({
  method: "PUT",
  url: "/api/v1/application-settings/locale",
  headers,
  payload: { locale: "ar", expectedUpdatedAtMs: 1_500 },
});
expect(saved.statusCode).toBe(200);
expect(saved.json()).toEqual({ locale: "ar", updatedAtMs: 1_501 });

expect(stale.statusCode).toBe(409);
expect(stale.json()).toEqual({
  code: "APPLICATION_SETTING_CONFLICT",
  messageKey: "settings.language.conflict",
  current: { locale: "ar", updatedAtMs: 1_501 },
});
```

The pseudo-locale test must construct a development-configured server with `en-XA`, confirm bootstrap returns it, and confirm the public PUT schema rejects `en-XA`.

- [ ] **Step 2: Run the new server test and verify it fails**

Run: `pnpm exec vitest run apps/server/src/routes/application-preferences.test.ts apps/server/src/app.test.ts`

Expected: FAIL because bootstrap lacks `localeUpdatedAtMs` and the PUT route is absent.

- [ ] **Step 3: Add the dedicated route**

Define the conflict response locally so Fastify strips no required field. Its current-locale union includes development tags because the route can run on the explicit pseudo-locale test server, while its request and successful response remain production-only:

```ts
const ApplicationLocaleConflictSchema = Type.Object(
  {
    code: Type.Literal("APPLICATION_SETTING_CONFLICT"),
    messageKey: Type.Literal("settings.language.conflict"),
    current: Type.Object(
      {
        locale: Type.Union(
          [...SUPPORTED_LOCALES, ...DEVELOPMENT_LOCALES].map(
            (tag) => Type.Literal(tag),
          ),
        ),
        updatedAtMs: EpochMillisecondsSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export function registerApplicationPreferenceRoutes(
  server: FastifyInstance,
  options: {
    readonly preferences: ApplicationPreferenceRepository;
    readonly nowMs: () => number;
  },
): void;
```

Register `PUT /api/v1/application-settings/locale` with the shared mutation schema, return 200 on success, and map only `ApplicationPreferenceConflictError` to the typed 409. Let schema validation produce the existing content-free 400 response for unsupported tags.

- [ ] **Step 4: Make bootstrap read the dynamic database preference**

Change the bootstrap option from a fixed locale to a getter:

```ts
readonly localePreference: () => {
  readonly locale: LocaleTag;
  readonly updatedAtMs: number;
};
```

Return `localeUpdatedAtMs` in `BootstrapResponseSchema`. In `buildServer`, initialize the closure to `{ locale: config.locale, updatedAtMs: 0 }` for database-free boundary tests, then point it at the current `ApplicationPreferenceRepository` after `rebuildServices()` initializes `ui.locale`.

Construct `allowedLocales` as all production locales plus `config.locale` only when it is a development locale. Recreate the repository inside every restore-time `rebuildServices()` call so a restored database's saved preference becomes canonical. Register the mutation route only when a database service exists.

Extend `restore.test.ts` with a restored database whose `ui.locale` differs from the live database; after a successful restore, a fresh bootstrap must return the restored locale/revision. This proves restore rebuilding does not retain a stale in-memory preference.

- [ ] **Step 5: Update injected optimizer fakes only where the expanded app wiring requires it**

Keep existing behavior unchanged in `single-instance.test.ts` and `no-outbound-network.test.ts`; add only the required preference/bootstrap expectations. Do not introduce filesystem or network behavior.

- [ ] **Step 6: Run server tests and checks**

Run: `pnpm exec vitest run apps/server/src/routes/application-preferences.test.ts apps/server/src/routes/restore.test.ts apps/server/src/app.test.ts apps/server/src/startup/single-instance.test.ts tests/security/no-outbound-network.test.ts && pnpm --filter @openrecall/server check`

Expected: PASS, including restart and pseudo-locale cases.

- [ ] **Step 7: Commit Task 2**

```bash
git add apps/server tests/security
git commit -m "feat(server): expose SQLite locale preference"
```

---

### Task 3: Reactive i18n provider and accessible language settings

**Files:**
- Create: `apps/web/src/i18n/locale-storage.ts`
- Create: `apps/web/src/i18n/locale-storage.test.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/app/I18nProvider.tsx`
- Create: `apps/web/src/app/I18nProvider.test.tsx`
- Create: `apps/web/src/settings/LanguageSettingsPanel.tsx`
- Create: `apps/web/src/settings/LanguageSettingsPanel.test.tsx`
- Modify: `apps/web/src/pages/SettingsPage.tsx`
- Create: `apps/web/src/pages/SettingsPage.test.tsx`
- Modify: `apps/web/src/router.tsx`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/client.test.ts`
- Modify: `packages/i18n/src/create-i18n.ts`
- Create: `packages/i18n/src/create-i18n.test.ts`
- Modify: `packages/i18n/src/catalog-keys.ts`
- Modify: `packages/i18n/src/locales/ar.ts`
- Modify: `packages/i18n/src/locales/en.ts`

**Interfaces:**
- Consumes: Task 2 bootstrap fields and PUT route; `registeredLocaleTags()`, `getLocaleDefinition()`, `isProductionLocale()`, and i18next `languageChanged`.
- Produces: reactive `useI18n()`, shared locale-storage helpers, and `LanguageSettingsPanel`.

- [ ] **Step 1: Write failing locale-storage and provider tests**

Test blocked storage, production validation, and a synthetic other-tab event:

```ts
rememberLocale("en");
expect(readRememberedLocale()).toBe("en");

window.dispatchEvent(new StorageEvent("storage", {
  key: LOCALE_STORAGE_KEY,
  newValue: "ar",
  storageArea: localStorage,
}));
expect(onLocale).toHaveBeenCalledWith("ar");
```

First add a package-level test that creates English i18next, calls `await i18n.changeLanguage("ar")`, and expects `i18n.t("nav.home")` to be `الرئيسية`; this proves the alternate catalog is loaded. For the provider, render a consumer of `t("nav.home")` plus `formatNumber(i18n.language as LocaleTag, 1234)`, call the same language change, and assert the translated text, localized number, `document.documentElement.lang`, `dir`, and title all change without remounting.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm exec vitest run packages/i18n/src/create-i18n.test.ts apps/web/src/i18n/locale-storage.test.ts apps/web/src/app/I18nProvider.test.tsx`

Expected: FAIL because alternate registered catalogs are not loaded, the storage module is absent, and the provider does not notify consumers after `languageChanged`.

- [ ] **Step 3: Extract safe locale storage and subscribe globally**

Move `openrecall.locale` handling out of `main.tsx` and export:

```ts
export const LOCALE_STORAGE_KEY = "openrecall.locale";
export function readRememberedLocale(): LocaleTag;
export function rememberLocale(locale: LocaleTag): void;
export function subscribeToRememberedLocale(
  listener: (locale: ProductionLocaleTag) => void,
): () => void;
```

All storage reads/writes stay inside `try/catch`. The subscription accepts only `event.storageArea === localStorage`, the exact key, and registered production values. `main.tsx` continues to register `en-XA` before creating i18next in development.

- [ ] **Step 4: Load every registered catalog and make the provider reactive**

Change `createI18n()` to initialize resources for every currently registered locale, including a pseudo-locale only when startup registered it:

```ts
const resources = Object.fromEntries(
  registeredLocaleTags().map((tag) => [
    tag,
    { translation: getLocaleDefinition(tag).resources },
  ]),
);
```

Pass that `resources` object to `instance.init` instead of loading only the starting definition. Keep `lng`, `fallbackLng: false`, flat keys, and escaping settings unchanged.

Store the active language in context so the context value identity changes:

```ts
interface I18nContextValue {
  readonly i18n: I18nInstance;
  readonly language: string;
}

const [language, setLanguage] = useState(i18n.language);
useEffect(() => {
  const changed = (next: string) => setLanguage(next);
  i18n.on("languageChanged", changed);
  return () => i18n.off("languageChanged", changed);
}, [i18n]);
```

The document metadata effect depends on `[i18n, language]`. A second effect subscribes to remembered-locale changes and calls `void i18n.changeLanguage(locale)` for other tabs. `useI18n()` still returns the i18next instance so existing callers do not change.

- [ ] **Step 5: Run storage/provider tests and verify they pass**

Run: `pnpm exec vitest run packages/i18n/src/create-i18n.test.ts apps/web/src/i18n/locale-storage.test.ts apps/web/src/app/I18nProvider.test.tsx`

Expected: PASS.

- [ ] **Step 6: Write the failing accessible panel test**

The test must render registered language names, change English to Arabic, verify one PUT call, wait for immediate RTL content, and verify focus:

```ts
expect(screen.getByRole("option", { name: "العربية" })).not.toBeNull();
expect(screen.getByRole("option", { name: "English" })).not.toBeNull();
await user.selectOptions(screen.getByLabelText("Language"), "ar");
await user.click(screen.getByRole("button", { name: "Save language" }));
expect(put).toHaveBeenCalledWith(
  "/api/v1/application-settings/locale",
  { locale: "ar", expectedUpdatedAtMs: 1_500 },
);
const status = await screen.findByRole("status");
expect(status).toHaveFocus();
expect(document.documentElement.dir).toBe("rtl");
```

Add error and stale-conflict tests proving the selected draft stays usable and the error summary receives focus.

- [ ] **Step 7: Implement `LanguageSettingsPanel` and Settings loader data**

Use a native labeled `<select>`, registered production locale metadata, a submit button, `role="status"` with `tabIndex={-1}`, and `ErrorSummary`. The save order is exact:

```ts
const saved = await api.put<ApplicationLocalePreference>(
  "/api/v1/application-settings/locale",
  { locale: selected, expectedUpdatedAtMs: preference.updatedAtMs },
);
setPreference(saved);
await i18n.changeLanguage(saved.locale);
rememberLocale(saved.locale);
setNotice(i18n.t("settings.language.saved"));
```

Add `localePreference` to `SettingsPageData`; the settings loader obtains bootstrap once and maps `{ locale: bootstrap.locale, updatedAtMs: bootstrap.localeUpdatedAtMs }`. Render the language panel before the section scope form so it is visibly global.

A `useEffect` keyed by the non-empty notice focuses `statusRef`, matching the repository's existing focus-management style without a timer. The panel prop accepts `LocaleTag` because a pseudo-locale bootstrap is valid. Its select draft uses the current tag only when `isProductionLocale(initial.locale)`; otherwise it selects English without exposing an `en-XA` option.

When `ApiClientError.envelope.code === "APPLICATION_SETTING_CONFLICT"`, validate the response's `current.locale` and `current.updatedAtMs`, update the stored revision/current preference, keep the user's selected draft unchanged, and focus the translated conflict summary. Other failures use `settings.language.saveError` and do not change i18next or local storage.

- [ ] **Step 8: Add complete language-panel catalogs**

Add and statically register these exact keys in Arabic and English:

```text
settings.language.heading
settings.language.description
settings.language.label
settings.language.save
settings.language.saving
settings.language.saved
settings.language.saveError
settings.language.conflict
```

- [ ] **Step 9: Update bootstrap client typing and tests**

Make `localeUpdatedAtMs` required in `BootstrapResponse`, update every bootstrap fixture, and assert cached bootstrap still carries the database revision and locale revision. No endpoint performs an extra bootstrap request during normal save.

- [ ] **Step 10: Run web, i18n, and type checks**

Run: `pnpm exec vitest run packages/i18n/src/create-i18n.test.ts apps/web/src/i18n/locale-storage.test.ts apps/web/src/app/I18nProvider.test.tsx apps/web/src/settings/LanguageSettingsPanel.test.tsx apps/web/src/pages/SettingsPage.test.tsx apps/web/src/api/client.test.ts packages/i18n/src/catalog-parity.test.ts packages/i18n/src/catalog-static-analysis.test.ts && pnpm --filter @openrecall/web check && pnpm --filter @openrecall/i18n check`

Expected: PASS.

- [ ] **Step 11: Commit Task 3**

```bash
git add apps/web packages/i18n
git commit -m "feat(settings): switch interface language immediately"
```

---

### Task 4: Section rename contracts, repository, API, and PATCH client

**Files:**
- Modify: `packages/contracts/src/sections.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.test.ts`
- Modify: `packages/database/src/section-repository.ts`
- Modify: `packages/database/src/section-repository.test.ts`
- Modify: `apps/server/src/routes/sections.ts`
- Modify: `apps/server/src/routes/sections.test.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/client.test.ts`
- Modify: the eleven web test files that construct a complete `ApiClient` fake, as listed by `rg -l "ApiClient\\s*=\\s*\\{|satisfies ApiClient|function api\\(" apps/web/src --glob "*.test.ts" --glob "*.test.tsx"`

**Interfaces:**
- Consumes: current `sections.updated_at_ms`, `SectionNameError`, and API client mutation retry behavior.
- Produces: `SectionRename`, `SectionDelete`, `SectionConflictResponse`, `SectionNotFoundError`, `SectionConflictError`, `SectionRepository.renameSection()`, and `api.patch()` for Tasks 6 and 7.

- [ ] **Step 1: Add failing contract tests**

Add `updatedAtMs` to `SectionSummarySchema`, then define and test:

```ts
export const SectionRenameSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200, pattern: "\\S" }),
    expectedUpdatedAtMs: EpochMillisecondsSchema,
  },
  { additionalProperties: false },
);

export const SectionDeleteSchema = Type.Object(
  {
    confirmed: Type.Optional(Type.Boolean()),
    expectedUpdatedAtMs: EpochMillisecondsSchema,
  },
  { additionalProperties: false },
);

export const SectionConflictResponseSchema = Type.Object(
  {
    code: Type.Literal("SECTION_CONFLICT"),
    messageKey: Type.Union([
      Type.Literal("section.rename.conflict"),
      Type.Literal("section.delete.conflict"),
    ]),
    current: SectionSummarySchema,
  },
  { additionalProperties: false },
);

export type SectionConflictResponse = Static<
  typeof SectionConflictResponseSchema
>;
```

Run: `pnpm exec vitest run packages/contracts/src/contracts.test.ts`

Expected: FAIL until all existing section-summary fixtures include `updatedAtMs`.

- [ ] **Step 2: Update summary fixtures and export the new contracts**

Every `SectionSummary` fixture receives the real section revision. Export `SectionRename`, `SectionDelete`, and schemas from `packages/contracts/src/index.ts`.

Run: `pnpm exec vitest run packages/contracts/src/contracts.test.ts`

Expected: PASS.

- [ ] **Step 3: Write failing repository rename tests**

Cover trimming, 200-code-point validation, monotonic revision, no-op same-name revision advancement, missing section, and stale conflict:

```ts
const renamed = repository.renameSection({
  sectionId: section.id,
  name: "  Human Biology  ",
  expectedUpdatedAtMs: 1_000,
  nowMs: 1_000,
});
expect(renamed).toMatchObject({
  id: section.id,
  name: "Human Biology",
  updatedAtMs: 1_001,
});
expect(() => repository.renameSection({
  sectionId: section.id,
  name: "Stale",
  expectedUpdatedAtMs: 1_000,
  nowMs: 2_000,
})).toThrow(SectionConflictError);
```

- [ ] **Step 4: Implement summary revisions and atomic rename**

Select `sections.updated_at_ms` in `SectionSummaryRow` and `summarySelect`, and map it to `updatedAtMs`. Add:

```ts
export class SectionConflictError extends Error {
  constructor(readonly current: SectionSummary) {
    super("SECTION_CONFLICT");
  }
}

export class SectionNotFoundError extends Error {
  constructor() {
    super("SECTION_NOT_FOUND");
  }
}

renameSection(input: {
  readonly sectionId: string;
  readonly name: string;
  readonly expectedUpdatedAtMs: number;
  readonly nowMs: number;
}): SectionSummary;
```

Inside an immediate transaction, validate time/name, read current, distinguish missing from stale, update with `updated_at_ms = max(@nowMs, updated_at_ms + 1)` and a matching expected revision, then return `getSection(sectionId, nowMs)`.

- [ ] **Step 5: Run repository tests**

Run: `pnpm exec vitest run packages/database/src/section-repository.test.ts`

Expected: PASS.

- [ ] **Step 6: Write and implement PATCH route tests**

Add tests for 200 rename, 400 whitespace, 404 missing, and 409 stale. Register:

```ts
server.patch<{ Params: SectionParams; Body: SectionRename }>(
  "/api/v1/sections/:sectionId",
  {
    schema: {
      params: SectionParamsSchema,
      body: SectionRenameSchema,
      response: {
        200: SectionSummarySchema,
        400: ApiErrorSchema,
        404: ApiErrorSchema,
        409: SectionConflictResponseSchema,
      },
    },
  },
  async (request, reply) => {
    try {
      const section = options.repository.renameSection({
        sectionId: request.params.sectionId,
        name: request.body.name,
        expectedUpdatedAtMs: request.body.expectedUpdatedAtMs,
        nowMs: options.nowMs(),
      });
      return reply.code(200).send(section);
    } catch (error) {
      if (error instanceof SectionNameError) {
        return reply.code(400).send({
          code: "VALIDATION_ERROR",
          messageKey: "error.validation",
          fieldErrors: [
            { path: "/name", messageKey: "error.field.invalid" },
          ],
        });
      }
      if (error instanceof SectionNotFoundError) {
        return reply.code(404).send({
          code: "SECTION_NOT_FOUND",
          messageKey: "error.sectionNotFound",
        });
      }
      if (error instanceof SectionConflictError) {
        return reply.code(409).send({
          code: "SECTION_CONFLICT",
          messageKey: "section.rename.conflict",
          current: error.current,
        });
      }
      throw error;
    }
  },
);
```

Map invalid names to the current validation envelope, missing sections to `SECTION_NOT_FOUND`, and stale edits to `SECTION_CONFLICT`/`section.rename.conflict`.

- [ ] **Step 7: Add PATCH to the CSRF client**

Extend the method union and `ApiClient` interface with `patch`. Add it to every complete test fake as `patch: async <T,>() => ({}) as T`. Assert the real client sends `PATCH`, JSON, CSRF, and performs the same one-time 403 bootstrap refresh as PUT/DELETE.

- [ ] **Step 8: Run route/client tests and checks**

Run: `pnpm exec vitest run apps/server/src/routes/sections.test.ts apps/web/src/api/client.test.ts packages/database/src/section-repository.test.ts && pnpm check`

Expected: PASS with no incomplete `ApiClient` fakes.

- [ ] **Step 9: Commit Task 4**

```bash
git add packages/contracts packages/database apps/server/src/routes apps/web/src
git commit -m "feat(sections): add optimistic rename API"
```

---

### Task 5: Schema version 6 and atomic section-owned data deletion

**Files:**
- Create: `packages/database/src/migrations/006-section-deletion.ts`
- Create: `packages/database/src/migrations/006-section-deletion.test.ts`
- Modify: `packages/database/src/migrate.ts`
- Modify: `packages/database/src/constants.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/database/src/open-database.test.ts`
- Modify: `packages/database/src/pre-migration-backup.test.ts`
- Modify: `packages/database/src/section-repository.ts`
- Modify: `packages/database/src/section-repository.test.ts`

**Interfaces:**
- Consumes: schema version 5 tables and immutable profile-application audit triggers.
- Produces: schema version 6 cascades and `SectionRepository.deleteSection()` used by Task 6.

- [ ] **Step 1: Write the failing migration test against a populated version-5 database**

Create representative rows in every ownership path: section, active/trashed items, primary/variant presentations, exposures, scheduler state, open and completed sessions, queue entries, review logs, rating requests, section parameter profiles, scheduler override, optimizer run, and profile application. Also create a second section plus global/official rows.

After migration, assert these exact foreign-key actions through `PRAGMA foreign_key_list`:

```text
review_sessions.section_id -> sections.id ON DELETE CASCADE
review_logs.section_id -> sections.id ON DELETE CASCADE
rating_requests.session_id -> review_sessions.id ON DELETE CASCADE
rating_requests.learning_item_id -> learning_items.id ON DELETE CASCADE
profile_applications.section_id -> sections.id ON DELETE CASCADE
```

Then delete the first section and assert zero matching rows in every section-owned table while the second section, global settings/profiles, official profile, and complete backup files remain unchanged.

Also assert direct `DELETE FROM profile_applications` still raises `PROFILE_APPLICATION_AUDIT_IMMUTABLE`.

- [ ] **Step 2: Run the migration test and verify it fails**

Run: `pnpm exec vitest run packages/database/src/migrations/006-section-deletion.test.ts`

Expected: FAIL because migration 006 and the required cascades do not exist.

- [ ] **Step 3: Make the migration runner follow SQLite's safe rebuild procedure**

When migrations are pending, record whether foreign keys are enabled, set `PRAGMA foreign_keys = OFF` before opening the migration transaction, apply all pending migrations, run `quick_check` and `foreign_key_check`, commit, and restore the recorded ON/OFF value in `finally`. Add a failure-injection test proving rollback and pragma restoration; connections opened through `openDatabase` start and finish with foreign keys ON.

Do not use `PRAGMA writable_schema`. Keep the existing pre-migration backup policy intact.

- [ ] **Step 4: Implement migration 006 with new-table/copy/drop/rename**

For each affected table, use SQLite's safe order: create `new_<name>` with every version-5 column/check, copy by an explicit column list, drop the old table, rename the new table, and recreate its indexes. Rebuild these four tables:

```text
review_sessions: add ON DELETE CASCADE to section_id
review_logs: add ON DELETE CASCADE to section_id; recreate its three indexes
rating_requests: add ON DELETE CASCADE to session_id and learning_item_id
profile_applications: add ON DELETE CASCADE to section_id; recreate its scope/time index
```

Recreate `ux_one_open_review_session` after rebuilding `review_sessions`. Recreate both audit triggers. The delete trigger must be exactly guarded so a direct delete fails while a parent cascade succeeds after SQLite has removed the parent row:

```sql
CREATE TRIGGER profile_applications_immutable_delete
BEFORE DELETE ON profile_applications
WHEN
  OLD.section_id IS NULL
  OR EXISTS (
    SELECT 1 FROM sections WHERE id = OLD.section_id
  )
BEGIN
  SELECT RAISE(ABORT, 'PROFILE_APPLICATION_AUDIT_IMMUTABLE');
END;
```

Keep the update trigger unconditionally immutable. The SQLite trigger-order proof is covered by the migration test, not assumed.

- [ ] **Step 5: Register schema version 6 and update upgrade tests**

Set `SCHEMA_VERSION = 6`, export/import migration 006, and add it after migration 005. Update pre-migration backup assertions so opening a version-5 application database creates and validates one automatic `.sqlite3` snapshot before migration.

- [ ] **Step 6: Run migration/open/backup tests**

Run: `pnpm exec vitest run packages/database/src/migrations/006-section-deletion.test.ts packages/database/src/open-database.test.ts packages/database/src/pre-migration-backup.test.ts`

Expected: PASS with `quick_check = ok`, empty `foreign_key_check`, and `foreign_keys = 1` after both success and injected failure.

- [ ] **Step 7: Write failing repository deletion tests**

Test unconfirmed handling at the route later; repository tests cover missing, stale, success, and rollback. The successful case calls:

```ts
repository.deleteSection({
  sectionId: section.id,
  expectedUpdatedAtMs: section.updatedAtMs,
});
expect(repository.getSection(section.id, 2_000)).toBeUndefined();
```

Inject a temporary `BEFORE DELETE` trigger that raises an error, call `deleteSection`, and prove all seeded rows still exist.

- [ ] **Step 8: Implement `deleteSection()` as one immediate transaction**

```ts
deleteSection(input: {
  readonly sectionId: string;
  readonly expectedUpdatedAtMs: number;
}): void;
```

Read the current section summary first, throw `SECTION_NOT_FOUND` for absence, throw `SectionConflictError(current)` for a stale revision, and execute one `DELETE FROM sections WHERE id = ? AND updated_at_ms = ?`. Treat a changed-row count other than one as a conflict. Do not issue child-table deletes in application code; migration 006 owns that invariant.

- [ ] **Step 9: Run the complete database package tests and check**

Run: `pnpm exec vitest run packages/database/src && pnpm --filter @openrecall/database check`

Expected: PASS.

- [ ] **Step 10: Commit Task 5**

```bash
git add packages/database
git commit -m "feat(database): cascade permanent section deletion"
```

---

### Task 6: Optimizer quiescence, deletion route, due wake, and SSE event

**Files:**
- Modify: `apps/server/src/optimizer/optimizer-run-service.ts`
- Modify: `apps/server/src/optimizer/optimizer-run-service.test.ts`
- Modify: `apps/server/src/review/review-events.ts`
- Modify: `apps/server/src/review/review-events.test.ts`
- Modify: `apps/server/src/routes/events.test.ts`
- Modify: `apps/server/src/routes/sections.ts`
- Modify: `apps/server/src/routes/sections.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/startup/single-instance.test.ts`
- Modify: `tests/security/no-outbound-network.test.ts`

**Interfaces:**
- Consumes: `deleteSection()` and `SectionDelete` from Tasks 4-5; `DueWakeService.rearm()`; singleton optimizer run.
- Produces: `OptimizerRunServiceApi.quiesceForSectionDeletion()`, `SectionDeletedEvent`, and `DELETE /api/v1/sections/:sectionId` for Task 7.

- [ ] **Step 1: Write failing optimizer gate tests**

Hold a fake trainer Promise open, start a section run, then request quiescence. Assert the AbortSignal is aborted, quiescence waits for the run Promise to settle, and the returned release function reopens starts:

```ts
const releasePromise = service.quiesceForSectionDeletion("section-1");
expect(signal.aborted).toBe(true);
let quiesced = false;
void releasePromise.then(() => { quiesced = true; });
await Promise.resolve();
expect(quiesced).toBe(false);
settleTrainer();
const release = await releasePromise;
expect(() => service.startRun(sectionScope("section-1"))).toThrow(
  "OPTIMIZER_SECTION_DELETION_IN_PROGRESS",
);
release();
```

Repeat with an active global run because its training input includes all sections. Prove unrelated section-scoped training is not cancelled, but a global start is blocked while any section deletion gate is held.

- [ ] **Step 2: Implement the optimizer deletion gate**

Extend active state with its `OptimizerScope`, track `#sectionDeletionGateCounts = new Map<string, number>()`, and add:

```ts
quiesceForSectionDeletion(sectionId: string): Promise<() => void>;
```

The method validates a non-empty ID, increments that section's gate count, aborts the active run only when its scope is global or matches the section, awaits that run's tracked Promise, and returns an idempotent release closure that decrements/removes only its own count. `startRun()` rejects a matching section or any global run while a deletion gate exists. Add a two-concurrent-delete test proving one release cannot reopen training while the second gate remains. `dispose()` still aborts everything and `whenIdle()` semantics remain unchanged.

- [ ] **Step 3: Run optimizer tests**

Run: `pnpm exec vitest run apps/server/src/optimizer/optimizer-run-service.test.ts`

Expected: PASS.

- [ ] **Step 4: Write failing review-event tests**

Extend the event union with:

```ts
export interface SectionDeletedEvent {
  readonly event: "section-deleted";
  readonly data: { readonly sectionId: string };
}
export type ReviewEvent = ReviewInvalidationEvent | SectionDeletedEvent;
```

Test canonical copying, invalid empty IDs, subscriber delivery, SSE event name/data, and failed-subscriber cleanup for both event variants.

- [ ] **Step 5: Implement the typed event union**

Change subscriber `send` and `publish` to accept `ReviewEvent`. Canonicalize each discriminated variant and reject unknown event names without echoing arbitrary payload data.

- [ ] **Step 6: Write failing deletion-route ordering tests**

Seed an open or paused session and use spies to record this exact successful order:

```text
optimizer gate acquired and active matching run settled
SQLite section deletion committed
due wake rearmed
section-deleted published
optimizer gate released
```

Also test:

- unchecked/false/missing `confirmed` receives 400 before any service call;
- missing receives 404;
- stale revision receives 409 and publishes nothing;
- an injected database failure publishes nothing, does not rearm, releases the gate, and leaves the section/session intact;
- success returns 204 and removes an active, waiting, or paused session.
- an injected due-rearm failure still attempts the post-commit deletion event, so a committed delete can never leave another review tab displaying a usable card merely because timer repair failed.

- [ ] **Step 7: Implement the permanent DELETE route**

Expand `registerSectionRoutes` options:

```ts
readonly events: Pick<ReviewEvents, "publish">;
readonly optimizer: Pick<OptimizerRunServiceApi, "quiesceForSectionDeletion">;
readonly wake: Pick<DueWakeService, "rearm">;
```

Register `DELETE /api/v1/sections/:sectionId` with `SectionDeleteSchema`. The handler acquires the gate, calls `repository.deleteSection`, then rearms/publishes only after the synchronous transaction returns. Release in `finally`. Map errors to stable keys:

After commit, wrap rearming so the deletion event is attempted in `finally`; if rearming throws, rethrow only after event publication has been attempted. This keeps the failure visible to the server boundary without suppressing cross-tab invalidation for data that is already committed.

```text
SECTION_DELETE_CONFIRMATION_REQUIRED -> section.delete.confirmationRequired
SECTION_NOT_FOUND -> error.sectionNotFound
SECTION_CONFLICT -> section.delete.conflict
```

The request schema intentionally permits an absent/false Boolean so the handler can return the stable confirmation-required envelope. The handler checks `request.body.confirmed !== true` before acquiring the optimizer gate.

- [ ] **Step 8: Wire the real services and update strict fakes**

Pass `optimizer`, `dueWake`, and `reviewEvents` from `buildServer`. Add `quiesceForSectionDeletion: async () => () => undefined` to injected optimizer fakes in startup/security/route tests. Do not stop the process-wide optimizer or database for a single-section deletion.

- [ ] **Step 9: Run server coordination tests and check**

Run: `pnpm exec vitest run apps/server/src/optimizer/optimizer-run-service.test.ts apps/server/src/review/review-events.test.ts apps/server/src/routes/events.test.ts apps/server/src/routes/sections.test.ts apps/server/src/startup/single-instance.test.ts tests/security/no-outbound-network.test.ts && pnpm --filter @openrecall/server check`

Expected: PASS with event publication proven post-commit.

- [ ] **Step 10: Commit Task 6**

```bash
git add apps/server tests/security
git commit -m "feat(sections): coordinate permanent deletion"
```

---

### Task 7: Accessible section management and deleted-review state

**Files:**
- Create: `apps/web/src/sections/SectionManagementPanel.tsx`
- Create: `apps/web/src/sections/SectionManagementPanel.test.tsx`
- Modify: `apps/web/src/pages/SectionPage.tsx`
- Modify: `apps/web/src/pages/SectionPage.test.tsx`
- Modify: `apps/web/src/pages/HomePage.tsx`
- Modify: `apps/web/src/pages/HomePage.test.tsx`
- Modify: `apps/web/src/review/use-review-events.ts`
- Create: `apps/web/src/review/use-review-events.test.tsx`
- Modify: `apps/web/src/pages/ReviewPage.tsx`
- Modify: `apps/web/src/pages/ReviewPage.test.tsx`
- Modify: `packages/i18n/src/catalog-keys.ts`
- Modify: `packages/i18n/src/locales/ar.ts`
- Modify: `packages/i18n/src/locales/en.ts`
- Modify: `apps/web/src/styles/layout.css`

**Interfaces:**
- Consumes: PATCH/DELETE APIs, section revisions, and `section-deleted` SSE from Tasks 4 and 6.
- Produces: accessible management region, home deletion announcement, and a safe terminal review view.

- [ ] **Step 1: Write failing management-panel tests**

Test rename success/focus, invalid name/error focus, stale conflict while preserving draft, delete checkbox gating, one DELETE request, duplicate-click prevention, error recovery, and success navigation. The deletion assertions are:

```ts
const checkbox = screen.getByRole("checkbox", {
  name: "I understand that this section will be permanently deleted",
});
const button = screen.getByRole("button", {
  name: "Permanently delete section",
});
expect(button).toBeDisabled();
await user.click(checkbox);
expect(button).toBeEnabled();
await user.click(button);
expect(remove).toHaveBeenCalledWith(
  `/api/v1/sections/${section.id}`,
  { confirmed: true, expectedUpdatedAtMs: section.updatedAtMs },
);
```

Assert there is no dialog role and no typed-name confirmation field.

- [ ] **Step 2: Run the panel test and verify it fails**

Run: `pnpm exec vitest run apps/web/src/sections/SectionManagementPanel.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the management panel**

Props are exact:

```ts
interface SectionManagementPanelProps {
  readonly api: ApiClient;
  readonly section: SectionSummary;
  readonly onRenamed: (section: SectionSummary) => void;
  readonly onDeleted: () => void;
}
```

Use two separate `<section className="panel">` regions with their own `<h2>`. Rename uses a labeled required text input, `maxLength={200}`, PATCH, and a focusable success status. Delete uses a warning paragraph, native checkbox, disabled/busy button, and no modal. Both use `ErrorSummary`; never move focus into a removed subtree.

For a typed `SECTION_CONFLICT` response, validate `envelope.current` as a section summary, call `onRenamed(current)` to adopt its new revision, and keep the rename draft text. A delete conflict also unchecks the confirmation box so the user must reconfirm against the newly loaded revision.

- [ ] **Step 4: Integrate section and home pages**

Keep section data in local state synchronized from loader data, render `SectionManagementPanel` after card management, and update the `<h1>` immediately on rename. On delete:

```ts
navigate("/", {
  replace: true,
  state: { announcementKey: "section.delete.success" },
});
```

`HomePage` reads only that known key from `useLocation().state`, renders it in an atomic status region, and relies on existing `RouteFocus` to focus the home `<h1>` after pathname change.

- [ ] **Step 5: Write failing hook/review deletion tests**

Dispatch a synthetic `section-deleted` MessageEvent and assert the matching callback runs only for the current section. In `ReviewPage.test.tsx`, enter waiting/question/answer states, trigger deletion, and assert:

- client due timers are cleared;
- no further `/next`, shown, reveal, or rate calls occur;
- card content and rating buttons disappear;
- a focusable level-one deleted heading receives focus;
- a Home link remains;
- the EventSource closes and focus/online recovery does not revalidate the missing session.

- [ ] **Step 6: Extend the hook and ReviewPage client-only state**

Change the hook signature to:

```ts
useReviewEvents({
  disabled,
  onSectionDeleted,
  sectionId,
  sessionId,
}: {
  readonly disabled: boolean;
  readonly onSectionDeleted: () => void;
  readonly sectionId: string;
  readonly sessionId: string;
}): void;
```

Keep review invalidation behavior unchanged. On a matching deletion, set an internal deleted guard before invoking the callback, suppress later revalidation, and close the EventSource during effect cleanup.

In `ReviewPage`, use:

```ts
type ReviewDisplayState = ReviewPageState | {
  readonly kind: "section-deleted";
  readonly sectionId: string;
};
```

The callback increments `claimGeneration`, sets `interactionBlocked`, clears `dueDeadline`, closes any end dialog, and changes page state. Extend every effect guard to exclude `section-deleted`. Render a focus-managed `<h1 data-route-heading tabIndex={-1}>` and Home link.

Capture `claimGeneration.current` before every shown, reveal, rate, pause, resume, and finish request, not only `/next`. Apply each Promise result or error announcement only when that captured generation still matches. Add deferred-Promise tests for reveal and rate proving responses that began before deletion cannot replace the terminal deleted state.

- [ ] **Step 7: Add complete management/deletion catalogs and minimal danger styling**

Add these exact keys in Arabic and English and to static analysis:

```text
section.management.heading
section.rename.heading
section.rename.label
section.rename.save
section.rename.saving
section.rename.saved
section.rename.error
section.rename.conflict
section.delete.heading
section.delete.warning
section.delete.confirm
section.delete.submit
section.delete.deleting
section.delete.success
section.delete.error
section.delete.conflict
section.delete.confirmationRequired
review.sectionDeleted.title
review.sectionDeleted.description
review.sectionDeleted.home
```

Use existing token variables for a visually distinct danger region; do not encode danger by color alone because the heading, warning text, checkbox, and button label already provide non-color cues.

- [ ] **Step 8: Run focused accessibility and catalog tests**

Run: `pnpm exec vitest run apps/web/src/sections/SectionManagementPanel.test.tsx apps/web/src/pages/SectionPage.test.tsx apps/web/src/pages/HomePage.test.tsx apps/web/src/review/use-review-events.test.tsx apps/web/src/pages/ReviewPage.test.tsx packages/i18n/src/catalog-parity.test.ts packages/i18n/src/catalog-static-analysis.test.ts && pnpm --filter @openrecall/web check`

Expected: PASS; existing review content remains paragraphs, not headings.

- [ ] **Step 9: Commit Task 7**

```bash
git add apps/web packages/i18n
git commit -m "feat(web): manage sections accessibly"
```

---

### Task 8: Chrome end-to-end coverage, documentation checks, and full verification

**Files:**
- Create: `tests/e2e/language-section-management.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: all Tasks 1-7.
- Produces: user-level Chrome evidence and final release-gate evidence.

- [ ] **Step 1: Write the language-switching E2E scenario**

In the Arabic project, navigate to Settings, select English by its native option name, save, and assert without reloading:

```ts
await expect(page.locator("html")).toHaveAttribute("lang", "en");
await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
await expect(page.getByRole("status")).toBeFocused();
```

Reload and assert English persists from SQLite. Switch back to Arabic and assert `lang="ar"`, `dir="rtl"`, translated navigation, and Arabic persistence after reload. Use `afterEach` to restore Arabic through the same public API if the test fails midway so other Arabic-project tests remain isolated.

- [ ] **Step 2: Write the rename/permanent-delete E2E scenario**

Create a uniquely named section through the UI, rename it, return Home to verify the new name, open it again, verify the permanent-delete button is disabled until its checkbox is checked, delete it, and assert Home heading focus, success announcement, and absence from the section list.

Create another section with imported cards, start a session, pause it, open the same review URL in a second page, delete the section from the first page, and assert the second page reaches the accessible deleted-section state and makes no subsequent `/next` request.

- [ ] **Step 3: Run the new E2E file in bundled Chromium**

Run: `pnpm exec playwright test tests/e2e/language-section-management.spec.ts --project=chromium-ar`

Expected: PASS.

- [ ] **Step 4: Run the same file against installed Chrome when available**

Run: `$env:OPENRECALL_BROWSER_CHANNEL='chrome'; pnpm exec playwright test tests/e2e/language-section-management.spec.ts --project=chromium-ar`

Expected: PASS. This controls only Playwright's Chrome process and does not interact with NVDA.

- [ ] **Step 5: Update user-facing repository documentation only where current claims are now incomplete**

Document that language is selected in Settings and persisted in SQLite, sections can be renamed/permanently deleted, deletion does not rewrite older full-database backups, and real screen-reader verification is manual. Keep backup documentation SQLite-only; do not add JSON export/backup instructions.

- [ ] **Step 6: Run the full release gates**

Run: `pnpm verify:full`

Expected: TypeScript checks, dependency-license check, all Vitest tests, all builds, production smoke test, and every Playwright project PASS.

- [ ] **Step 7: Inspect the final diff and repository state**

Run: `git diff --check && git status --short && git log --oneline -12`

Expected: no whitespace errors; only intentional Task 8 files are uncommitted before the final commit.

- [ ] **Step 8: Commit Task 8**

```bash
git add tests/e2e/language-section-management.spec.ts README.md
git commit -m "test(e2e): cover language and section management"
```

- [ ] **Step 9: Re-run final verification from the committed tree**

Run: `pnpm verify:full && git status --short`

Expected: every gate PASS and the working tree is clean.
