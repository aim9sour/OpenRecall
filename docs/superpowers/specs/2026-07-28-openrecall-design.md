# OpenRecall Product Design

**Date:** 2026-07-28  
**Status:** Approved product design and research amendments; implementation planning in progress
**Primary user environment:** Windows, Chrome, and NVDA  
**Product form:** A local, installable web application served from `127.0.0.1`

## 1. Purpose

OpenRecall is a private-first spaced-repetition platform for text flashcards. It
runs entirely on the user's computer, stores its durable state in one SQLite
database, and requires no account, cloud service, telemetry, or internet
connection during normal use.

The product has four equal priorities:

1. Excellent keyboard and screen-reader use, with NVDA and Chrome as the primary
   acceptance environment.
2. Correct, durable scheduling built on the current stable FSRS scheduler and
   optimizer libraries.
3. A versioned boundary around FSRS so a future stable FSRS-7 implementation can
   be introduced without losing or rewriting review history.
4. A polished multilingual experience that is straightforward to publish and
   maintain as a public GitHub repository.

## 2. Scope

### Included

- Sections (decks), cards, optional notes, and any number of alternate
  presentations for one learning item.
- JSON card import with validation and an accessible preview.
- A dynamic review session with the four FSRS ratings: Again, Hard, Good, Easy.
- Pause, resume, completion, empty-queue, and next-due experiences.
- Dashboard, section detail, per-card statistics, global statistics, settings,
  and optimizer training.
- Section-specific optimized parameters with global and official-default
  fallbacks.
- SQLite backup and restore.
- Arabic and English at launch, with a documented translation-extension model.
- An installable PWA shell whose data operations require the local server.

### Excluded from the first product release

- User accounts, cloud synchronization, remote hosting, and collaboration.
- Images, audio, video, HTML, Markdown, LaTeX, and executable card content.
- Anki package import and export.
- Mobile-native or desktop-native wrappers.
- Experimental FSRS-7 scheduling before an implementation is released through a
  production-ready upstream library.

## 3. Technical Architecture

OpenRecall is a modular TypeScript monorepo:

- A React client renders the accessible PWA interface.
- A Fastify server binds only to `127.0.0.1`, serves the production client, owns
  all data mutations, and exposes a same-origin API.
- SQLite is the sole durable store.
- Shared packages define runtime schemas, domain types, translations, and API
  contracts.
- A scheduler adapter is the only package allowed to import `ts-fsrs`. The first
  adapter pins `ts-fsrs@5.4.1`, which implements FSRS-6. Research-only FSRS-7 is
  not presented as a supported algorithm until a production-ready stable
  upstream implementation exists.
- An optimizer adapter is the only package allowed to import
  `@open-spaced-repetition/binding`; the first adapter pins version `0.5.0`.

The scheduler adapter exposes application-owned types rather than upstream
types. Its capability manifest declares:

- Algorithm identifier and version.
- Parameter schema and defaults.
- Supported settings, their input types, ranges, and whether they are
  deprecated.
- Serialization and replay support.
- Whether fractional due intervals and short-term steps are supported.

The application persists normalized OpenRecall scheduler types, never serialized
upstream objects or deprecated upstream fields. All real due times crossing the
adapter boundary are absolute UTC timestamps with millisecond precision. An
OpenRecall-owned clock service projects real instants through the effective IANA
timezone and study-day boundary before FSRS performs calendar-day arithmetic,
then maps the result back to a real instant. The application never stores a
rounded integer-day interval as the source of truth.

The initial runtime baseline is the supported Node.js 24 LTS line. Production
dependencies use stable release channels and an exact lockfile. Node 26 may be
tested in continuous integration while it remains Current, but it is not the
runtime baseline until it reaches LTS and passes the full suite.

## 4. Durable Data Model

SQLite foreign keys are enabled. Schema changes are forward-only, numbered
migrations tested against fixture databases from every released schema version.
The main records are:

### `sections`

- Stable identifier, localized-independent name, creation/update timestamps.
- Optional scheduler-setting overrides.
- Active/trash counts cached only when they can be rebuilt.

### `learning_items`

- Stable identifier and owning section.
- Lifecycle state: active or trashed.
- Creation, update, and trash timestamps.
- One shared scheduler identity regardless of presentation count.

### `presentations`

- Stable identifier and owning learning item.
- Kind: primary or variant.
- Required non-empty `front` and `back`.
- Optional `notes`.
- Stable ordering for editing; selection order is controlled separately.

### `presentation_exposures`

- Presentation identifier, first/last shown timestamps, and show count.
- The review session and learning item that caused each most-recent exposure.

### `scheduler_states`

- One current state per learning item.
- Exact `due_at`, normalized state and step, stability, difficulty, scheduling
  values that belong to the OpenRecall schema, last review time,
  lapse/repetition counters, and state revision.
- Algorithm identifier/version and parameter-profile identifier used to create
  the state.
- This is a rebuildable cache, not the historical source of truth.

### `review_logs`

- Immutable log identifier and learning item.
- Session and presentation shown.
- Question shown, answer revealed, and rating timestamps.
- Rating, elapsed time, prior state, resulting state, exact resulting due time,
  algorithm identifier/version, and parameter profile.
- Effective IANA timezone, study-day boundary, scheduler settings, and adapter
  version needed for deterministic replay.
- Review duration fields are retained for future analytics but are never sent
  outside the computer.

Review logs are the historical source of truth. Scheduler states can be rebuilt
by replaying them through a compatible adapter.

### `review_sessions` and `session_queue_entries`

- Session section, status, start/pause/resume/completion times, and counters.
- Queue entries represent review appearances and preserve completed appearances
  for session statistics. A partial unique session/item constraint applies only
  to queued or active entries, preventing simultaneous duplicates while allowing
  the same item to re-enter after its next exact due time.
- One globally active review session is allowed. Another tab can navigate to it
  but cannot create a conflicting session.

### `parameter_profiles` and `optimizer_runs`

- Scope: official default, global user, or section.
- Algorithm identifier/version, parameter array, creation time, source review
  cutoff, eligible-review count, and active/superseded status.
- Optimizer progress, outcome, validation result, and application time.

### `application_settings`

- Locale, theme, timezone, study-day boundary, accessibility preferences,
  scheduler defaults, and per-section override metadata.

## 5. Scheduling and Dynamic Session Queue

### Starting and resuming

Starting a section review adds every active new item and every item whose exact
`due_at` is less than or equal to the current time. There is no daily new-card
limit.

Resuming a paused session restores its eligible saved entries, removes entries
that are no longer reviewable, and merges items that became due during the
pause. The unique queue constraint prevents duplicate insertion.

### Rating transaction

A rating request carries an idempotency key and the expected scheduler-state
revision. In one SQLite transaction, the server:

1. Rejects a duplicated or stale rating safely.
2. Calls the scheduler adapter with the current state, exact current time,
   effective settings, and effective parameter profile.
3. Appends an immutable review log.
4. Updates the rebuildable scheduler state and exact `due_at`.
5. Marks the current queue appearance completed.
6. Adds any learning items that are now due.
7. Updates session counters.

Double-clicks, browser retries, and multiple tabs therefore cannot record the
same answer twice.

### Due-time wake-up

The queue never encodes assumptions such as “add this card after ten minutes.”
The scheduler alone computes `due_at`.

While a review session is active, the server queries the indexed minimum future
`due_at` for that section and arms one timer for that instant. When it fires, the
server queries `due_at <= now`, inserts newly due items once, and arms the next
timer. Server-Sent Events notify the review page that the queue changed.

Because Node timers cannot safely represent delays beyond 2,147,483,647
milliseconds, a far-future wake-up is divided into capped timer slices. Every
slice ends with a database requery; the database timestamp, not timer memory, is
the source of truth.

The server also rechecks after every rating, when the queue empties, when the
client reconnects, when the page becomes visible, and when a session resumes.
These checks recover from clock changes, suspended Chrome tabs, server restarts,
and missed events without constant database polling.

When a due item joins an active session, NVDA receives a short localized
announcement containing the number added. The current question is not
interrupted or reread.

### Empty active queue

If the active queue is empty, the review page displays the exact nearest due
time and offers:

- Wait with the session open.
- End now and continue later.
- Return to the home page.

If a waiting timer makes an item due, the same page transitions back to review
and focuses the newly available question.

## 6. Smart Presentation Rotation

The primary presentation and every variant share one scheduler state and one
review history. They are not independent cards.

When an item enters the visible review position, presentation selection:

1. Excludes the most recently shown presentation when another presentation is
   available.
2. Selects the presentation with the oldest `last_shown_at`.
3. Uses the lowest show count as the second ordering key.
4. Breaks a remaining tie using a cryptographically unbiased local random
   choice.
5. Records exposure only when the question is actually rendered.

Deleting a learning item affects its primary presentation and all variants as
one unit.

## 7. Pages and User Flows

### Home

- Section summaries with total, new, due now, next due, predicted recall, and
  recent activity.
- Create-section action.
- Start-review action on every section card.
- Links to global statistics and settings.

### Section detail

- Expanded state distribution and section statistics.
- Start-review action.
- JSON import action with preview.
- Searchable card list.
- Edit and delete actions.
- A collapsible statistics panel under every card.

### Review

- Session status at the top: completed, currently remaining, new, repeated,
  elapsed time, and newly joined due items.
- Question only before reveal.
- Reveal-answer action.
- Answer, optional notes, outcome previews, and four rating actions after
  reveal.
- Pause/end-now action that persists the session.

The displayed “remaining” count is explicitly a current snapshot because due
items can join later.

### Session completion

- Cards and review events completed.
- Rating distribution.
- Repeated-within-session count.
- Duration and session retention summary.
- Home action and section action.

### Nothing due

- Clear statement that no active item is due.
- Exact nearest review time when one exists.
- Home and section actions.

### Global statistics

- Date-range and section filters.
- Activity, actual and predicted retention, rating distribution, study time,
  section progress, and 30-day workload.
- Every chart has an equivalent text summary and data table.

### Settings

- Language, theme, timezone, and study-day boundary.
- Global scheduler settings and section overrides.
- Algorithm version and effective parameter source.
- Global or section optimizer training and prior profile history.
- SQLite backup and restore.
- Accessibility and shortcut help.

## 8. Screen-Reader and Keyboard Contract

WCAG 2.2 AA is the minimum conformance target. Chrome with the current stable
NVDA release is the primary manual acceptance combination.

- Pages use native landmarks, headings, links, buttons, form controls, tables,
  and disclosure elements.
- A skip link reaches main content.
- Focus order follows reading order and has a high-contrast visible indicator.
- The interface remains operable and understandable at 400% zoom.
- Color is never the only carrier of status.
- Reduced-motion preferences are respected.
- Icon-only interactive controls are not used.

On the review page:

- The actual question text is the page heading. No visible or accessible
  “Question” prefix is inserted.
- Reveal moves programmatic focus to the actual answer text, rendered as a
  focusable heading. NVDA therefore speaks the answer immediately without an
  “Answer” prefix.
- Optional notes are omitted entirely when empty. When present, their actual
  text is the next heading so heading navigation reaches it directly without a
  “Notes” prefix.
- Rating moves focus to the next actual question heading.
- A dedicated polite live region announces queue-count and session-status
  changes, never the card content already spoken through focus.

Keyboard shortcuts:

- `Space` reveals the answer.
- `1`, `2`, `3`, and `4` select Again, Hard, Good, and Easy after reveal.
- `0` focuses, but does not activate, the end-now action.
- Review shortcuts are disabled while focus is in a text-entry control and while
  a confirmation dialog is open.

Errors never rely on disappearing toast messages. A failed form has a persistent
focusable error summary linking to every invalid field, plus an inline error
associated with that control.

## 9. JSON Card Import

The importer accepts one card object or an array of card objects. The portable
card shape is:

```json
{
  "front": "Required question",
  "back": "Required answer",
  "notes": "Optional plain-text notes",
  "variants": [
    {
      "front": "Required alternate question",
      "back": "Required alternate answer",
      "notes": "Optional alternate notes"
    }
  ]
}
```

Validation rules:

- `front` and `back` must be strings containing a non-whitespace character.
- `notes` may be omitted, `null`, or a string. `null` normalizes to no notes.
- `variants` may be omitted or an array.
- Every variant independently requires non-empty `front` and `back`.
- Strings matching actual HTML tag, comment, or script markup fail validation.
  Angle brackets that do not form markup remain ordinary text.
- Non-string content fields and structurally unknown root formats fail
  validation.
- Unknown fields produce warnings and are not persisted.
- Exact normalized front/back duplicates within the target section are shown as
  duplicates before import.

The preview identifies every issue by card index, variant index, and field. The
user may cancel or explicitly import only valid, non-duplicate items. No item is
written before confirmation.

JSON is a card interchange format only. It is not a backup format.

## 10. Deletion and SQLite Backup

Delete moves a learning item and all of its presentations to an indefinite
trash. Trashed items leave active queues immediately but remain restorable. They
are never purged automatically.

Permanent deletion requires a second confirmation that names the card and
explains that its content, state, exposures, and review logs will be removed and
statistics/training may change. SQLite foreign-key cascades perform the removal
in one transaction.

Backup and restore use SQLite files only:

- A manual browser action creates a consistent SQLite snapshot through SQLite's
  online backup mechanism and downloads that one snapshot; it does not copy a
  live WAL database file naively.
- Automatic snapshots run before a schema migration, parameter-profile
  application that rebuilds schedules, and database restore.
- The application retains the ten most recent automatic snapshots. A manual
  snapshot copied outside the application directory is never automatically
  deleted.
- Restore streams one bounded multipart upload to a uniquely named staged file,
  never trusts the uploaded filename as a path, and validates integrity,
  application identity, and schema version. It then creates a pre-restore
  snapshot, enters maintenance mode, closes database work safely, migrates and
  validates a separate candidate when needed, swaps only after success, reopens
  and verifies the database, and reports the result.
- Restoring a database from a future unsupported schema is rejected without
  changing current data.

## 11. Scheduler Settings and Parameter Precedence

The settings UI exposes every user-facing control advertised by the installed
scheduler adapter. For the initial adapter this includes:

- Requested retention.
- Maximum interval.
- Long-interval fuzzing.
- Short-term scheduling enablement.
- Learning steps.
- Relearning steps.

Defaults come from the installed stable scheduler library. Runtime schemas
validate every value against that adapter's supported ranges. A future adapter
can add, rename, or remove controls through its capability manifest without
requiring page-specific conditionals. Removed controls remain readable in
historical records but are not passed to a scheduler that does not support them.

Saving scheduler-setting changes affects future rating calculations and is
explained as such in the interface; it does not silently rewrite already stored
due timestamps. Existing schedules change only through the separately previewed,
snapshotted replay/application workflow.

Effective model parameters use this precedence:

1. Active section-trained profile with at least 400 optimizer-eligible training
   examples.
2. Active globally trained user profile with at least 400 optimizer-eligible
   training examples.
3. Official defaults for the active algorithm version.

An optimizer-eligible training example is an expanding review-history prefix
accepted by the optimizer adapter whose target review has a positive whole
study-day delta. Same-day reviews may remain in its historical prefix. The
400-example threshold is a conservative OpenRecall product policy, not an
upstream hard requirement. The settings page displays raw review and eligible
example counts separately for the global scope and each section.

## 12. Optimizer Training and Parameter Application

Training is user-initiated and runs in an isolated worker so the server remains
responsive. The UI presents localized start, progress, cancellation, success,
and failure states. Progress announcements are throttled so NVDA is not flooded.

The optimizer option named `timeout` is treated only as its documented progress
polling interval, not a wall-clock deadline. Cancellation is implemented through
the upstream progress callback and the worker boundary; a worker crash or
cancellation cannot alter the active profile.

The optimizer package is treated as an unstable external boundary even when
installed from its latest npm release, because upstream describes its public API
as being in public testing. Its package version is locked, and all calls pass
through the application-owned optimizer adapter and fixture tests.

Successful output is validated for parameter count, finite values, accepted
ranges, algorithm compatibility, and deterministic serialization. Training
does not apply parameters automatically.

Before application, OpenRecall shows:

- Scope, eligible review count, old/new algorithm and package versions.
- Old and new parameter source.
- Number of due dates that would move earlier, later, or remain unchanged.
- Estimated review counts for each of the next 30 days under old and new
  profiles.

After confirmation, OpenRecall creates a SQLite snapshot and replays the
affected review histories to rebuild scheduler states and exact due times in a
single replace-on-success operation. A failure leaves the old active profile and
states untouched. Every prior valid profile remains selectable for rollback,
which uses the same preview, snapshot, and rebuild path.

## 13. Statistics

### Section and global metrics

- Active, new, learning, review, relearning, and currently due counts.
- Exact nearest due time.
- Review events and unique learning items reviewed.
- Again/Hard/Good/Easy distribution.
- Actual recall, where Again is failure and Hard/Good/Easy are successful
  recall.
- Mean predicted retrievability at review time.
- Mean current stability, difficulty, and retrievability.
- Study duration from answer reveal to rating, with clearly labeled exclusions
  when timestamps are missing.
- Daily activity and projected 30-day workload.

### Per-card disclosure

- Current state and due time.
- Last review and last rating.
- Review and lapse counts.
- Current stability, difficulty, and retrievability.
- Algorithm version and effective parameter-profile source.
- Presentation show counts and last-shown times.
- Chronological review-history table, including which presentation appeared.

Current statistics grouping and presentation use the configured timezone and
study-day boundary. Immutable review instants never change. Scheduler replay
uses the timezone and study-day boundary captured at each historical review, so
changing current settings cannot reinterpret prior scheduling days.

## 14. Internationalization and Visual System

Arabic and English ship as complete locales. All visible strings, accessible
names, validation messages, live announcements, dates, numbers, and plural forms
use translation keys.

Each locale package declares its BCP 47 tag, display name, text direction, and
message catalog. Adding a language requires only a locale package and does not
require page changes. Continuous integration fails on missing or unused required
keys. A pseudo-locale detects hard-coded text and layout assumptions.

Changing locale updates `lang`, `dir`, formatting, and content without a server
restart. RTL and LTR are tested independently. User-authored card text uses
`dir="auto"` because its direction may differ from the interface locale.

The visual system uses semantic design tokens for color, type, spacing, focus,
motion, and elevation. It provides light, dark, and system themes. Layout is
calm, spacious, responsive, and text-first. Status always has a textual label;
decoration never carries required information.

## 15. Security and Privacy

- The server binds to `127.0.0.1` and does not bind to LAN interfaces by
  default.
- The server accepts only the configured loopback `Host` authority, preventing
  a public origin from reaching it through DNS rebinding.
- Production API requests must be same-origin and carry a per-process
  anti-forgery token obtained from a same-origin bootstrap endpoint. Mutations
  require that token in a custom header. Unexpected `Origin` values,
  unexpected `Host` values, and cross-origin requests are rejected.
- CORS is disabled.
- Imported content is rendered as text only.
- A restrictive Content Security Policy blocks inline script and unexpected
  network destinations.
- No analytics, crash upload, font CDN, update beacon, or telemetry is present.
- Logs omit card content by default and never leave the device.
- Database and backup paths are resolved within the configured application data
  directory unless the user explicitly selects a destination.

## 16. Reliability and Error Handling

- Domain writes use transactions and explicit foreign keys.
- Rating, import, deletion, profile application, and restore operations are
  idempotent or protected against duplicate submission.
- Expected conflicts return actionable localized messages rather than generic
  server errors.
- A failed optimizer, timer, SSE connection, or browser tab does not lose the
  saved session.
- SSE automatically reconnects; reconnect always triggers a due-state query
  rather than trusting missed events.
- SQLite access uses direct typed repositories over `better-sqlite3`. Each
  connection verifies foreign keys, WAL mode, `synchronous=FULL`,
  `trusted_schema=OFF`, and a bounded busy timeout. Rating uses a short
  synchronous `BEGIN IMMEDIATE` transaction with no asynchronous work inside.
- On startup, SQLite application identity, integrity, foreign keys, important
  PRAGMA values, and migration state are checked before writes are accepted.
- Unexpected fatal errors preserve the database, emit a local diagnostic without
  card content, and show the recovery/backup location.

The PWA service worker caches only the application shell and immutable static
assets. API and SSE routes are network-only. Application updates are
prompt-based and never reload an active review or dirty form automatically.

## 17. Verification Strategy

### Automated

- Unit tests for domain rules, presentation rotation, due-time selection,
  parameter precedence, statistics, schemas, and translations.
- Property-based tests for queue uniqueness, immutable-log append behavior,
  rotation fairness, replay determinism, and import validation.
- API integration tests against temporary SQLite databases.
- Scheduler-adapter fixtures covering all four ratings, every card state,
  same-day reviews, fractional timestamps, rollback, and replay.
- Optimizer-adapter fixtures covering valid training, insufficient/invalid data,
  cancellation, malformed output, and package upgrades.
- Migration tests opening every released fixture schema.
- Backup/restore tests including corrupt and future-schema files.
- React component tests for focus transitions and localized accessible names.
- Playwright flows for creation, import, review, due-time wake-up, pause/resume,
  statistics, settings, training, backup/restore, RTL, and LTR.
- Axe checks with zero accepted serious or critical violations.
- Production-build smoke tests on Windows and Linux.

### Manual

Each release follows a documented Chrome/NVDA checklist:

- Landmark and heading navigation.
- Exact question/answer/notes speech and absence of unwanted prefixes.
- Reveal/rating focus behavior.
- Keyboard-only completion of every critical flow.
- Live announcements without duplicate speech.
- Import and validation-error navigation.
- Dialog focus trapping and restoration.
- Zoom, high contrast, light/dark themes, reduced motion, RTL, and LTR.

Automated tests do not substitute for this manual acceptance check.

## 18. Repository and Maintenance

The repository contains:

- Arabic and English README files.
- Architecture and contributor documentation.
- Valid and invalid JSON import examples.
- Translation contribution instructions.
- Scheduler/optimizer adapter upgrade instructions.
- Security policy and responsible disclosure instructions.
- Changelog and database migration notes.

GitHub Actions runs formatting, linting, type checks, unit/property/integration
tests, builds, accessibility checks, and supported-OS smoke tests. Dependency
automation proposes updates individually or in compatible groups; no update is
merged without adapter fixtures and migration tests passing.

The public repository license is a separate publication decision and is not
created or assumed by this product-design approval.

## 19. Delivery Stages

Each stage produces a runnable, tested increment. Work continues through the
stages in order:

1. **Foundation and content:** monorepo, local server, SQLite migrations,
   sections, card model, JSON import, and base internationalization.
2. **Review core:** scheduler adapter, dynamic due queue, smart presentation
   rotation, rating transactions, pause/resume, and NVDA focus contract.
3. **Management and statistics:** card editing/trash, section detail, completion
   summaries, per-card and global statistics, and accessible tables/charts.
4. **Optimization and durability:** settings, precedence, optimizer worker,
   training preview/application/rollback, SQLite backup, and restore.
5. **Release hardening:** complete Arabic/English catalogs, PWA installation,
   visual themes, security hardening, documentation, cross-platform CI, and full
   automated/manual accessibility audit.

## 20. Product Acceptance Criteria

OpenRecall is ready for its first public release only when:

1. A user can create a section, import the specified JSON, review every new and
   due item, pause/resume, and reach the session summary without a mouse.
2. Alternate presentations rotate intelligently while sharing one FSRS state.
3. Items are added to an active session only after their exact stored due time
   arrives, including same-day or fractional intervals.
4. NVDA speaks the answer immediately on reveal and the next question
   immediately after rating, without inserting “Question” or “Answer.”
5. Notes and variants remain optional and never block a valid base card.
6. Per-card, section, session, and global statistics are available in
   screen-reader-equivalent text/table forms.
7. Section parameters fall back to global user parameters and then official
   defaults exactly as specified.
8. Training, replay, rollback, schema migration, backup, and restore cannot
   replace current data unless the complete operation succeeds.
9. Arabic and English are complete, RTL/LTR both pass tests, and a third locale
   can be added without modifying page components.
10. The full automated suite passes and the documented Chrome/NVDA manual audit
    has no unresolved critical-flow defect.
