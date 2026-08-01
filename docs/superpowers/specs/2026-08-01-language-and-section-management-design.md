# Language Preference and Section Management Design

**Date:** 2026-08-01

**Status:** User-approved design, pending written-spec review

## Purpose

Add three related capabilities to the existing local OpenRecall web application:

1. Let the user choose the interface language from Settings, persist that choice
   in SQLite, and apply it immediately.
2. Let the user rename a section.
3. Let the user permanently delete a section and all live data owned by it.

The work must preserve the application's Chrome and screen-reader accessibility,
Arabic/English parity, future locale extensibility, live-review behavior, and
SQLite-only data model.

## Decisions already made

- The preferred language is application-wide, not section-specific.
- SQLite is the canonical store for that preference.
- `OPENRECALL_LOCALE` is only the initial fallback for a database that does not
  yet contain a saved language.
- A saved language takes effect immediately without a page reload.
- Rename and delete are explicit section operations, not a generic CRUD or
  generic settings engine.
- Section deletion is permanent, immediate, and includes an active, waiting, or
  paused review session for that section.
- The destructive confirmation is a checkbox. The user does not have to type
  the section name and there is no second confirmation dialog.
- Deletion is atomic: either all live section-owned rows are removed or none are.
- Existing full-database SQLite backup files are not deleted or rewritten when a
  section is deleted. They are independent snapshots and may contain other
  sections. "Permanent" here means there is no trash, undo, or retained copy in
  the live database.
- Automated tests must never launch, control, configure, or query the user's real
  NVDA installation. NVDA verification remains manual.

## Existing architecture used by this design

- Migration 001 already provides the strict `application_settings` table with
  `key`, `json_value`, and `updated_at_ms`; no new generic settings table is
  needed.
- Sections already have `created_at_ms` and `updated_at_ms`.
- The i18n package already has a locale registry, Arabic and English locale
  definitions, metadata including direction, catalog-parity tests, and the
  development pseudo-locale `en-XA`.
- Bootstrap currently supplies a configured locale to the web client.
- The web client currently remembers a locale in local storage for the server-
  unavailable page, but a successful bootstrap overwrites it with the server
  locale.
- Many section-owned rows already cascade from `sections`, but several review
  and profile-application foreign keys deliberately do not. The deletion work
  therefore requires a migration that makes the ownership graph explicit; it
  must not rely on an unverified sequence of ad-hoc delete statements.

## Language preference

### Persistence

Use one reserved `application_settings` key, `ui.locale`. Its `json_value` is a
small versioned object:

```json
{ "version": 1, "locale": "ar" }
```

An application-preference repository owns parsing, validation, initialization,
and compare-and-swap updates for this key. The public update operation accepts
production locale tags registered by the i18n package. When the server has
explicitly enabled a registered development locale, initialization and bootstrap
may also preserve that configured locale so pseudo-locale tests continue to use
the same SQLite-backed path. A development locale is never accepted from the
production Settings API or exposed in the production language selector.

At server construction, if `ui.locale` is missing, the repository validates and
stores `OPENRECALL_LOCALE` as the initial preference. After that first write,
the SQLite value is canonical. Invalid or unsupported stored values fail safely
with a stable server error rather than being passed unchecked to i18next.

Bootstrap returns both `locale` and `localeUpdatedAtMs`. This keeps initial page
rendering deterministic and provides the revision used by the Settings form.

### Update API

`PUT /api/v1/application-settings/locale`

Request:

```json
{ "locale": "en", "expectedUpdatedAtMs": 1234 }
```

Response:

```json
{ "locale": "en", "updatedAtMs": 5678 }
```

The repository updates only when the supplied revision matches. Successful
updates use `max(nowMs, previousUpdatedAtMs + 1)` so two writes within the same
clock millisecond still receive distinct revisions. A stale tab
receives `409 APPLICATION_SETTING_CONFLICT` with the current preference. An
unsupported locale receives `400 UNSUPPORTED_LOCALE`.

### Immediate client update

After the server confirms the write, the current tab calls i18next's language-
change operation and updates its remembered fallback locale. The i18n provider
subscribes to language changes so React rerenders translated content and updates:

- `<html lang>`
- `<html dir>`
- the document title
- locale-sensitive number, date, time, and duration formatting
- the selected value and success message in Settings

The same-tab update is direct. The local-storage mirror is only a fallback and a
cross-tab notification; it is not the source of truth. Other open tabs listen
for that storage change and apply a registered locale immediately. A later
reload always rechecks SQLite through bootstrap.

Adding another production language later consists of adding a locale definition
and messages to the existing registry/parity system. The Settings selector is
derived from registered production locale metadata rather than a hard-coded
Arabic/English conditional.

## Section rename

### API and concurrency

`PATCH /api/v1/sections/:sectionId`

Request:

```json
{ "name": "New name", "expectedUpdatedAtMs": 1234 }
```

The repository applies the existing normalization rule: trim the name and
require 1 through 200 characters. A successful update advances `updated_at_ms`
monotonically using `max(nowMs, previousUpdatedAtMs + 1)`
and returns the updated section summary. Missing sections return
`404 SECTION_NOT_FOUND`; stale revisions return `409 SECTION_CONFLICT`; invalid
names return `400 INVALID_SECTION_NAME`.

Section contracts expose `updatedAtMs` so the page can submit an optimistic-
concurrency revision. A successful rename updates the section heading and any
cached home/settings section lists without reloading the document.

## Permanent section deletion

### API guard

`DELETE /api/v1/sections/:sectionId`

Request:

```json
{ "confirmed": true, "expectedUpdatedAtMs": 1234 }
```

The server requires `confirmed: true` even though the UI also gates the button.
This protects against accidental direct calls. Missing confirmation returns
`400 SECTION_DELETE_CONFIRMATION_REQUIRED`; missing sections return
`404 SECTION_NOT_FOUND`; stale revisions return `409 SECTION_CONFLICT`.

The success response is `204 No Content`. Repeating the request after successful
deletion returns the normal `404`; it does not recreate or partially restore
anything.

### SQLite ownership and atomicity

A migration updates the foreign-key ownership graph so deleting the section is
one transactionally enforced operation. Tests must enumerate the real schema,
not merely assert that the section row disappeared.

The live data removed includes:

- the section row;
- active and trashed learning items;
- primary and variant presentations and their exposure records;
- scheduler states;
- active, waiting, paused, and completed review sessions for the section;
- session queue entries, rating idempotency records, and review logs owned by
  those sessions/items;
- section parameter profiles and section scheduler-setting overrides;
- section optimizer runs;
- section profile-application audit rows.

Official/global settings, profiles, optimizer history, and other sections remain
untouched. Section-created profile rows that are no longer referenced are
removed; globally owned profiles are not.

The migration must preserve the invariant that profile-application audit rows
cannot be directly edited or deleted. Its delete trigger may permit removal only
as part of the owning section's foreign-key cascade; direct deletes, including
global audit deletes, must continue to raise the immutable-audit error.

Foreign keys remain enabled and a failure at any point rolls back the entire
delete. Migration tests cover both a fresh database and an upgrade from schema
version 5 containing representative data.

### Live server coordination

Before the database transaction begins, a section-deletion coordinator prevents
new optimizer work from starting, cancels and awaits any active optimizer run
whose input includes the section (section-scoped or global), and then holds that
gate through commit. This prevents a background completion from writing derived
rows after their owning section has disappeared. If quiescing the worker fails,
the database delete does not start. If the later database transaction fails, the
section remains intact, although an interrupted training run remains cancelled
and may be started again by the user.

After the database transaction commits, the section service:

1. stops and recomputes the due-wake timer;
2. publishes a section-deleted review event and closes the invalid session event
   stream as appropriate;
3. refreshes server-side service state without restarting the process;
4. releases the optimizer gate.

No deletion event is published before commit. If the transaction fails, the
review session and timers continue unchanged.

A review tab receiving the event stops its own due timer, clears unusable review
state, and renders an accessible "section deleted" state with a link to the home
page. It must not keep polling, rate the displayed card, or claim more due cards.

## User interface and accessibility

### Settings page

A separate Language panel appears before scheduler settings. It contains:

- a visible `<label>`;
- a native `<select>` populated from production locale metadata, with language
  names written in their own language (for example, `العربية` and `English`);
- a Save Language button;
- a concise focusable status/error summary.

After a successful save, focus moves to the translated success status. The
entire page changes language and direction immediately. The control is global
and is not affected by the scheduler section-scope selector.

### Section management

The section detail page gains a Management region containing:

- a rename form with the current name and a Save button;
- a clearly separated permanent-delete danger region;
- a warning that cards, variants, review history, statistics, settings, training
  data, and an open review session for this section will be deleted;
- a labeled checkbox confirming that the user understands the deletion is
  irreversible;
- a delete button disabled until the checkbox is checked and while the request
  is running.

There is no second dialog. After successful deletion, the initiating tab
navigates to Home, focuses the main page heading, and announces a concise
success message. Validation, conflict, and server errors appear in a focusable
error summary and never leave focus in a removed subtree.

All new visible labels, warnings, statuses, accessible names, and errors are
catalog entries with complete Arabic and English translations. The production
UI does not use card content as headings and this work does not change the
existing review-question/answer announcement behavior.

## Error handling and recovery

- Save and rename controls remain usable after validation or conflict errors.
- A conflict response replaces the form revision with the server revision and
  explains that another tab changed the value. User-entered rename text is not
  silently discarded.
- The delete button cannot be retried using a stale revision without the user
  seeing the conflict; the confirmation checkbox resets when current section
  data is reloaded.
- Network failures do not optimistically claim success. Language changes only
  after the database save succeeds, rename remains visibly unchanged until its
  response succeeds, and failed deletion leaves the section usable.
- Existing server-unavailable startup behavior continues to use the remembered
  locale solely because SQLite cannot be reached in that state.

## Verification strategy

Implementation follows test-driven development. Required coverage includes:

### Database and server

- initialize `ui.locale` from the validated configured fallback;
- read, update, reject unsupported values, and reject stale language revisions;
- preserve the preference across server restart and backup/restore;
- validate and atomically rename sections;
- reject stale or unconfirmed section deletion;
- upgrade a populated version-5 database without data loss;
- delete every enumerated section-owned row, including open/paused sessions and
  immutable audit rows, while retaining other-section and global rows;
- roll back a deliberately failed deletion;
- cancel in-memory section work, rearm due wakeups, and publish deletion only
  after commit.

### Web and i18n

- render the locale selector from the production registry;
- switch Arabic to English and English to Arabic without reload;
- update translations, `lang`, `dir`, title, and formatters after switching;
- apply cross-tab locale notification while keeping bootstrap/SQLite canonical;
- maintain full catalog parity and pseudo-locale static checks;
- expose accessible rename validation and conflict handling;
- keep delete disabled until confirmation, prevent duplicate submission, and
  restore usable controls on failure;
- move focus correctly after language save, rename, successful deletion, and
  error responses;
- render the safe deleted-section state in another open review tab.

### Browser-level scenarios

Playwright in Chrome covers language switching, reload persistence, rename,
permanent deletion, deletion of an open review session, and a second review tab
receiving invalidation. DOM semantics and live-region behavior are asserted by
tests. Real NVDA is never automated or touched.

## Acceptance criteria

1. A user can select Arabic or English in Settings, save once, and see the whole
   interface switch immediately with correct RTL/LTR behavior.
2. The chosen language survives closing and reopening the local server because
   it is stored in SQLite.
3. Adding a future production locale does not require editing the Settings page.
4. A section can be renamed with validation and stale-tab protection.
5. Permanent deletion cannot be submitted until its checkbox is checked.
6. Successful deletion removes all live data owned by that section, including
   its open/paused session and history, in one SQLite transaction.
7. Other sections and global/official scheduler data are unchanged.
8. The initiating tab returns accessibly to Home and other open review tabs stop
   using the deleted section.
9. Arabic and English tests, Chrome browser tests, migration tests, and the full
   existing suite pass without interacting with real NVDA.
