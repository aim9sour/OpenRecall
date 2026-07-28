# OpenRecall Technical Research

**Research date:** 2026-07-28
**Status:** Complete; product-spec amendments approved on 2026-07-28
**Scope:** Scheduler, optimizer, time semantics, SQLite durability, local-server
security, PWA behavior, internationalization, and Chrome/NVDA accessibility

## 1. Research Method

This document records facts checked before writing an implementation plan.
Evidence came from:

1. Official documentation and upstream source repositories.
2. Exact npm metadata and extracted package contents, not only README examples.
3. Small executable probes against the published packages.
4. A comparison of the current stable releases with their published beta
   successors to identify boundaries that OpenRecall must own.

The working source checkout for `ts-fsrs` was
`cdec8d2f8340f8e62ced596c1da02e20e70073f0`. Package versions were queried from
npm on the research date. Versions below are a reproducible baseline, not an
instruction to accept future dependency updates automatically.

## 2. Executive Conclusions

1. OpenRecall should ship on the current stable FSRS-6 implementation,
   `ts-fsrs@5.4.1`. FSRS-7 exists in research and benchmark code, but the
   production TypeScript scheduler does not yet expose it. Claiming FSRS-7
   support now would be false.
2. All scheduler calls must go through an OpenRecall adapter. The
   `ts-fsrs@6.0.0-beta.0` API already demonstrates breaking names and exports
   while still implementing FSRS-6.
3. A due timestamp must be accepted exactly as returned by the scheduler. The
   application must never infer fixed “one minute” or “ten minute” follow-up
   rules.
4. FSRS's day calculations and OpenRecall's configurable study-day boundary
   require a deliberate time projection. Storing only UTC timestamps is not
   sufficient for deterministic replay when timezone settings can change.
5. Optimizer training examples are review-history prefixes whose target review
   has a positive whole-study-day delta. “400 eligible reviews” must mean 400
   accepted training examples, not 400 raw button presses.
6. The optimizer's option named `timeout` is a progress-poll interval, not a
   maximum runtime. Real cancellation must return `false` from, or throw inside,
   the progress callback. Training belongs in a worker thread.
7. A single indexed SQLite query after every rating is normal and negligible
   for this personal application. It is materially safer than hard-coded
   timers. One nearest-due timer prevents polling.
8. Use `better-sqlite3` directly behind typed repositories. Rating must be a
   short synchronous `BEGIN IMMEDIATE` transaction.
9. Use WAL with `synchronous=FULL`: the workload is tiny and review durability
   matters more than the small extra commit cost.
10. A valid backup is created with SQLite's online backup mechanism. A live
    database, WAL, and SHM file must never be copied or swapped independently.
11. Bind only to `127.0.0.1`, validate `Host` as well as `Origin`, and require a
    per-process anti-forgery token on mutations. Loopback binding alone does not
    address DNS rebinding.
12. The PWA caches only the application shell and immutable assets. It must not
    cache API or SSE traffic, and updates must be user-prompted so an active
    review is never reloaded automatically.

## 3. Scheduler: Published Reality

### 3.1 Stable and beta packages

Checked npm metadata:

| Package | `latest` | `beta` | Use |
|---|---:|---:|---|
| `ts-fsrs` | `5.4.1` | `6.0.0-beta.0` | Pin stable |
| `@open-spaced-repetition/binding` | `0.5.0` | `0.6.0-beta.0` | Pin stable |

`ts-fsrs@5.4.1` declares its own algorithm string as
`v5.4.1 using FSRS-6.0` and supplies 21 default FSRS-6 weights. The official
project lists its TypeScript scheduler as an FSRS-6 implementation. The
official benchmark describes FSRS-7 as the newest research algorithm, but that
does not make it available through the stable TypeScript scheduler.

Sources:

- [Official ts-fsrs repository](https://github.com/open-spaced-repetition/ts-fsrs)
- [Official implementation catalogue](https://github.com/open-spaced-repetition/awesome-fsrs)
- [Official scheduler benchmark](https://github.com/open-spaced-repetition/srs-benchmark)

### 3.2 Verified stable API

The stable package exports the following relevant operations:

```ts
const scheduler = fsrs(parameters)
const initial = createEmptyCard(now)
const outcomes = scheduler.repeat(card, now)
const result = scheduler.next(card, now, rating)
const probability = scheduler.get_retrievability(card, now)
const prior = scheduler.rollback(card, reviewLog)
const forgotten = scheduler.forget(card, now, resetCounts)
```

The adapter will expose OpenRecall-owned equivalents. Application code must not
persist or pass the upstream `Card`, `ReviewLog`, enums, or result objects
outside that adapter.

The default parameter object verified in the package is:

- Requested retention: `0.9`.
- Maximum interval: `36500` days.
- Fuzz: disabled.
- Short-term scheduler: enabled.
- Learning steps: `1m, 10m`.
- Relearning steps: `10m`.
- FSRS-6 parameter count: 21.

An executable probe at `2026-07-28T10:00:00Z` produced these default first-review
outcomes:

| Rating | Due |
|---|---|
| Again | 1 minute |
| Hard | 6 minutes |
| Good | 10 minutes |
| Easy | 8 days |

This table is evidence about the current defaults, not a rule for OpenRecall.
The result changes with state, history, settings, and future algorithm versions.

With empty learning and relearning step arrays, the same probe returned
approximately 1, 1, 2, and 8 days. This confirms that the application cannot
assume that a same-session follow-up always exists.

### 3.3 Breaking beta boundary

Inspection of `ts-fsrs@6.0.0-beta.0` found a substantial public API refactor
while it still targets FSRS-6:

- Root helper exports change.
- The class-oriented `Scheduler` API replaces or deprecates prior constructors.
- Deprecated elapsed fields disappear.
- Handler signatures change.

Therefore:

- Persist a normalized OpenRecall scheduler state, not a serialized upstream
  object.
- Store the algorithm identifier, algorithm version, adapter version, parameter
  profile, and effective settings with every review.
- Maintain versioned decoders for historical OpenRecall records.
- Upgrade an upstream package only after golden fixture replay passes.

### 3.4 Settings validation

The current upstream parameter helper applies permissive JavaScript defaults
and the step parser uses integer parsing. OpenRecall must validate before the
library receives input.

Initial adapter policy:

- Requested retention: finite and within the adapter's documented safe UI
  range; the UI will explain the review-load trade-off.
- Maximum interval: positive integer days and within the package-supported
  bound.
- Learning/relearning steps: comma-separated positive integer `m` or `h`
  tokens, strictly increasing, each below 24 hours.
- Boolean settings: actual booleans, never truthy strings.
- Parameter arrays: exact length, all finite, adapter-version compatible.

Steps below one day agree with the upstream FSRS guidance and avoid confusing a
calendar-day model with exact sub-day delays.

## 4. Correct Time Semantics

### 4.1 The discovered mismatch

The stable scheduler calculates long elapsed intervals from UTC calendar dates,
while short learning steps add exact durations to JavaScript `Date` values.
OpenRecall promises a user-selected timezone and study-day boundary. Passing
raw instants directly would make a “day” change at UTC midnight rather than at
the user's configured boundary.

This is especially visible around:

- A non-UTC timezone.
- A study day beginning at 04:00 rather than midnight.
- Daylight-saving transitions.
- A later settings change followed by historical replay.

### 4.2 Adapter time projection

OpenRecall will own a `SchedulerClock` projection:

1. Take the real instant and effective IANA timezone.
2. Convert it to zoned wall-clock time.
3. Shift by the configured study-day boundary.
4. Reinterpret those local date/time fields as a synthetic UTC `Date` for the
   scheduler.
5. Convert the scheduler's synthetic due date back through the inverse
   projection to a real instant.

The implementation will use `@js-temporal/polyfill` behind this OpenRecall-owned
service because native Temporal is not yet a safe cross-browser baseline.

The projection requires golden tests for both DST directions, zones without
DST, midnight boundaries, non-midnight boundaries, same-day steps, and
long-interval reviews.

### 4.3 Deterministic history

Every immutable review log must preserve:

- Actual rating instant as epoch milliseconds.
- Effective IANA timezone.
- Effective study-day boundary.
- Algorithm and adapter versions.
- Effective settings and parameter-profile identifier.

Current display grouping may use the user's current locale/time settings.
Historical scheduler replay must use the settings captured with that review.
This distinction prevents a later timezone change from rewriting the past.

## 5. Optimizer: Actual Data Contract

### 5.1 Verified API shape

The published binding uses:

```ts
new FSRSBindingReview(rating: number, deltaT: number)
new FSRSBindingItem(reviews: FSRSBindingReview[])

await computeParameters(trainSet, {
  enableShortTerm,
  numRelearningSteps,
  trainingConfig,
  progress,
  timeout
})

await evaluateWithTimeSeriesSplits(trainSet, parameters, options)
```

`deltaT` is an unsigned whole number of days in the Rust boundary. The official
CSV converter:

1. Sorts reviews per learning item.
2. Converts timestamps into study days using timezone and day boundary.
3. Creates expanding history prefixes starting at the second review.
4. Keeps a target example only when its current review has `delta_t > 0`.

An eligible optimizer example is therefore one accepted target prefix. Same-day
reviews may be part of its historical prefix even though a same-day target is
not itself an example.

Source:

- [Official optimizer package documentation and source](https://github.com/open-spaced-repetition/ts-fsrs/tree/main/packages/binding)

### 5.2 The 400-example product policy

The upstream package currently has no documented hard minimum of 400. The
approved OpenRecall threshold is a conservative product policy:

- A section profile may train/apply when that section supplies at least 400
  adapter-accepted target examples.
- Otherwise the section inherits the eligible global user profile.
- The global profile may train/apply at 400 global accepted target examples.
- Otherwise official FSRS-6 defaults remain active.

The interface must say “optimizer-eligible examples,” show raw review count
separately, and explain why the counts differ.

### 5.3 Training, evaluation, cancellation

An executable tiny-data probe returned default-like parameters from training,
while time-series evaluation rejected the data as insufficient. OpenRecall must
not label a returned array as a useful personalized profile merely because the
function resolved.

Training completion requires:

- Minimum eligible-example policy satisfied.
- Exact parameter length and finite-number validation.
- Successful evaluation when evaluation can form valid time-series splits.
- Recorded metrics such as log loss and RMSE bins.
- A comparison preview before activation.

The option named `timeout` is the interval used by upstream to poll/report
progress. It is not a wall-clock deadline. Cancellation must make the progress
callback return `false` or throw. Training will run in a Node worker thread;
the parent owns cancellation, detects worker exit/crash, and never mutates the
active profile until validated output is returned.

## 6. Dynamic Queue and Resource Cost

The approved continuous-session design is technically appropriate.

The critical query is equivalent to:

```sql
SELECT learning_item_id
FROM scheduler_states
WHERE section_id = ?
  AND due_at_ms <= ?
  AND is_active = 1
ORDER BY due_at_ms, learning_item_id;
```

It will use an index beginning with section/activity/due columns. Running it:

- After each rating.
- When the active queue empties.
- On session resume.
- On SSE reconnect.
- When the tab becomes visible.
- When the nearest-due timer fires.

is a very light local indexed operation. It neither scans all cards nor causes
meaningful SSD wear. The rating transaction is already a durable write; the
extra due check is a read.

For the future wake-up:

1. Query only the minimum future due timestamp.
2. Arm one server timer.
3. When it fires, requery `due_at <= now`; never trust timer precision.
4. Insert with a unique `(session_id, learning_item_id)` constraint.
5. Re-arm from the next database result.

Node timers cannot represent arbitrary future delays: values above
2,147,483,647 milliseconds overflow into near-immediate behavior. The wake
service must cap each timer slice, wake, requery, and arm again. This is another
reason the database timestamp, not the in-memory timer, is the source of truth.

Source:

- [Node.js timers documentation](https://nodejs.org/api/timers.html#settimeoutcallback-delay-args)

## 7. Database Layer and Durability

### 7.1 Driver choice

Use `better-sqlite3` directly through OpenRecall repositories, not an ORM.

Reasons:

- Its synchronous transaction boundary matches the atomic rating workflow.
- The schema and query set are small and intentionally controlled.
- It exposes `immediate` transactions and online backup directly.
- An ORM would add a second migration/type abstraction without removing the
  need for FSRS/domain runtime validation.

`node:sqlite` was rejected for the initial baseline because the Node 24 API is
still documented below stable maturity. This can be revisited behind the
repository boundary.

Sources:

- [better-sqlite3 official API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)
- [Node.js SQLite API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)

### 7.2 Connection policy

Each opened application database will verify, rather than merely issue:

```text
foreign_keys = ON
journal_mode = WAL
synchronous = FULL
trusted_schema = OFF
busy_timeout = 5000
```

It will also use a registered non-zero `application_id`, numbered
`user_version`, startup `quick_check`, and `foreign_key_check`. Unknown PRAGMAs
are silently ignored by SQLite, so tests must read important values back.

`PRAGMA optimize` is the modern SQLite recommendation instead of manually
running `ANALYZE`; it can run after migrations and periodically at a safe
lifecycle point.

Sources:

- [SQLite PRAGMA reference](https://sqlite.org/pragma.html)
- [SQLite application file format guidance](https://sqlite.org/appfileformat.html)

### 7.3 Why WAL plus FULL

WAL allows readers to continue while the one writer commits. SQLite documents
that `synchronous=NORMAL` in WAL mode can lose a recently committed transaction
after power loss or a hard reboot. `FULL` syncs the WAL at each commit.

OpenRecall is a single-person, low-write-volume application. The extra commit
cost is preferable to losing recent ratings that the UI already confirmed as
saved.

Source:

- [SQLite write-ahead logging](https://sqlite.org/wal.html)

### 7.4 Rating transaction

The rating operation will use a short synchronous
`db.transaction(...).immediate` boundary. `BEGIN IMMEDIATE` acquires the one
writer transaction at the start, avoiding a read-then-write upgrade race.

No network I/O, worker message, timer wait, or `await` is permitted inside the
transaction. Scheduler calculation is CPU-local and fast; any data needed is
loaded before or synchronously inside the boundary. A thrown error rolls the
whole operation back.

Sources:

- [SQLite transaction modes](https://sqlite.org/lang_transaction.html)
- [better-sqlite3 transaction API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transactionfunction---function)

## 8. Backup and Restore

### 8.1 Backup

A browser backup action will:

1. Ask the live connection to create a snapshot through
   `better-sqlite3.backup()`.
2. Validate the produced snapshot.
3. Stream that one SQLite file to the browser as a download.
4. Remove only the temporary server copy after the response closes.

SQLite's backup API produces a consistent snapshot while the source remains in
use. Copying only the main live file in WAL mode can omit committed records
still present in the WAL.

Sources:

- [SQLite online backup API](https://sqlite.org/backup.html)
- [better-sqlite3 backup API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise)

### 8.2 Restore

Restore will use an accessible browser file input and one bounded multipart
upload. The server will never trust the uploaded filename as a path.

The safe staged sequence is:

1. Stream to a unique temporary file with one-file and byte limits.
2. Open the staged file read-only.
3. Validate SQLite format, `application_id`, supported `user_version`,
   `quick_check`, and `foreign_key_check`.
4. Make and validate a pre-restore online backup of the current database.
5. Enter maintenance mode and reject new mutations.
6. Pause/close active SSE and database work cleanly.
7. Migrate and validate a separate staged candidate if it is older.
8. Close the live connection so WAL state is checkpointed/cleaned.
9. Replace the complete database atomically where the platform permits, with a
   rollback rename path if reopen fails.
10. Reopen, reapply/verify connection policy, re-arm due timers, and leave
    maintenance mode.

The current database remains untouched if any validation or candidate migration
fails. A future schema version is rejected.

Source:

- [Fastify multipart official documentation](https://github.com/fastify/fastify-multipart)

## 9. Local HTTP Security

### 9.1 Network boundary

- Bind explicitly to `127.0.0.1`, never `0.0.0.0`.
- Use one documented fixed local port initially.
- Reject an unexpected `Host` header; allow only the configured loopback
  authority.
- Disable CORS.
- Do not expose an option to bind to a LAN interface in the first release.

Host validation matters because a malicious public domain can resolve to
loopback in a DNS-rebinding attack.

### 9.2 Mutations

At startup the server generates a cryptographically random token:

1. A same-origin bootstrap GET returns it to the application.
2. Every mutation requires it in a custom `X-OpenRecall-CSRF` header.
3. Mutations also require the exact expected `Origin`.
4. GET routes remain side-effect free.
5. API inputs and responses both have runtime schemas.

The same-origin policy prevents an attacking origin from reading the bootstrap
response, while the custom header prevents a simple cross-origin form from
performing a mutation.

### 9.3 SSE and content

- SSE carries only revision/invalidation events, never card content.
- Reconnect always re-fetches current state.
- SSE validates the local `Host` and expected `Origin`.
- Card text is rendered through React text nodes; no `dangerouslySetInnerHTML`.
- Production CSP allows only the local resources needed by the built app.
- Request logs omit bodies, imported data, and card-bearing URLs.

Fastify will use official TypeBox integration with both request and response
schemas. Response schemas are a disclosure boundary, not only documentation.

Sources:

- [Fastify validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [Fastify Type Providers](https://fastify.dev/docs/latest/Reference/Type-Providers/)
- [OWASP DNS rebinding prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html#dns-pinning)

## 10. Client Architecture and PWA

React Router Data Mode is sufficient for server state in this application:

- Loaders fetch page data.
- Actions/fetchers perform mutations.
- Successful actions revalidate loader data.
- SSE, reconnect, focus, and visibility events call revalidation explicitly.

This avoids adding a second client cache whose invalidation would need to agree
with the dynamic due queue.

The service worker will:

- Precache only the application shell and hashed static assets.
- Use network-only behavior for `/api/**` and SSE.
- Show a localized update prompt.
- Never activate an update automatically during an active review or dirty form.
- Explain that installed UI still requires the local OpenRecall server for data.

Sources:

- [React Router Data Mode](https://reactrouter.com/start/data/data-loading)
- [React Router data writes and revalidation](https://reactrouter.com/start/data/actions)
- [vite-plugin-pwa update behavior](https://vite-pwa-org.netlify.app/guide/prompt-for-update)

## 11. Accessibility: Chrome and NVDA Contract

Automated accessibility tests cannot verify spoken output. The release gate
therefore combines semantic automated checks with a scripted manual audit on
current stable Chrome and NVDA.

The research-date manual baseline is NVDA `2026.1.1` and the then-current
Windows Chrome 150 stable update `150.0.7871.181/.182`. These numbers belong in
the release checklist, not in application logic; every release candidate must
record and test the stable versions current at that later date.

Implementation findings:

- Programmatically focusing a static heading is valid when it is the logical
  result of the user's action. Use `tabindex="-1"` and a real heading element.
- The question text itself receives focus when a card appears.
- The answer text itself receives focus after reveal.
- Notes, when present, are another actual-content heading.
- No accessible label or hidden prefix says “Question,” “Answer,” or “Notes.”
- A persistent, already-mounted `role="status"` region handles only brief queue
  and session messages. It must not repeat focused card content.
- Native buttons, inputs, tables, and disclosure buttons are preferred.
- A visual progress summary accompanies any progress bar; changing
  `aria-valuenow` alone is not a reliable spoken announcement.
- Dialogs restore focus to their opener.
- Global shortcuts do nothing when focus is in a text field or dialog.

User card content receives `dir="auto"` because its language/direction may differ
from the interface locale. The document root still carries the locale's BCP 47
`lang` and `dir`.

Sources:

- [WCAG 2.2 Understanding Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html)
- [WAI-ARIA APG alert/status guidance](https://www.w3.org/WAI/ARIA/apg/patterns/alert/)
- [WAI-ARIA APG disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)
- [NVDA 2026.1.1 release](https://www.nvaccess.org/post/nvda-2026-1-1/)
- [Chrome 150 stable desktop update](https://chromereleases.googleblog.com/2026/07/stable-channel-update-for-desktop_0256605430.html)

## 12. Internationalization

Use `i18next` and `react-i18next`, with complete Arabic and English locale
packages.

Requirements grounded in platform behavior:

- Use `Intl.PluralRules`; Arabic has six plural categories.
- Format all dates, relative times, durations, and numbers through locale-aware
  helpers.
- Locale metadata declares BCP 47 tag, display name, and direction.
- Switching locale updates `<html lang>` and `<html dir>`.
- CSS uses logical properties.
- Card content uses `dir="auto"`.
- A pseudo-locale and catalog parity test detect hard-coded strings.
- Server errors return stable codes and interpolation data; the client localizes
  them.

Source:

- [i18next plurals](https://www.i18next.com/translation-function/plurals)
- [MDN Intl.PluralRules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules)

## 13. JSON Import

The browser may parse and preview for responsiveness, but the server must repeat
all validation before the atomic insert.

The contract will define:

- Maximum upload bytes.
- Maximum cards, variants per card, and text length per field.
- Required trimmed non-empty `front` and `back`.
- Optional `notes` and `variants`.
- Warnings for unknown fields; unknown fields are discarded.
- Duplicate normalization and explicit user selection.
- Exact issue paths such as `cards[2].variants[1].back`.

Because plain text such as `a < b > c` is valid, HTML rejection cannot be a
naive “contains angle brackets” rule. Tests will distinguish actual tags,
comments, declarations, and script markup from ordinary mathematical text.
Regardless of import validation, output rendering remains text-only.

## 14. Verified Dependency Baseline

These were current stable npm releases on the research date:

| Area | Package | Version |
|---|---|---:|
| Runtime | Node.js LTS | `24.18.0` |
| Package manager | pnpm | `11.17.0` |
| Language | TypeScript | `7.0.2` |
| Client | React / React DOM | `19.2.8` |
| Router | React Router | `8.3.0` |
| Build | Vite | `8.1.5` |
| React build plugin | `@vitejs/plugin-react` | `6.0.4` |
| Server | Fastify | `5.10.0` |
| Database | `better-sqlite3` | `13.0.1` |
| Scheduler | `ts-fsrs` | `5.4.1` |
| Optimizer | `@open-spaced-repetition/binding` | `0.5.0` |
| Runtime schemas | `typebox` | `1.3.8` |
| Fastify schemas | `@fastify/type-provider-typebox` | `6.1.0` |
| Localization | `i18next` | `26.3.6` |
| React localization | `react-i18next` | `17.0.11` |
| Time | `@js-temporal/polyfill` | `0.5.1` |
| PWA | `vite-plugin-pwa` | `1.3.0` |
| Unit/integration tests | Vitest | `4.1.10` |
| Browser tests | Playwright | `1.62.0` |
| Accessibility tests | `@axe-core/playwright` | `4.12.1` |
| Property tests | `fast-check` | `4.9.0` |

Node 24.18.0 is the current LTS baseline; Node 26 remains Current. React Router
8's engine and peer requirements fit the chosen Node and React versions.

pnpm 11 blocks unreviewed install scripts. The workspace must explicitly allow
the reviewed native build for `better-sqlite3`, rather than enabling all build
scripts:

```yaml
allowBuilds:
  better-sqlite3: true
```

Sources:

- [Node.js 24.18.0 LTS release](https://nodejs.org/en/blog/release/v24.18.0)
- [npm package registry](https://www.npmjs.com/)
- [pnpm settings](https://pnpm.io/settings)

## 15. Testing Consequences

The implementation plan must contain explicit tests for the discoveries above:

1. Stable FSRS-6 golden outcomes and full state transitions.
2. Adapter rejection of malformed settings and parameter arrays.
3. No application module outside the adapter imports upstream FSRS packages.
4. Time projection and inverse projection across DST and study boundaries.
5. Deterministic replay after the current timezone setting changes.
6. Optimizer prefix conversion, positive-target-day filtering, and exact
   eligible counts.
7. Cancellation through progress callbacks and worker termination recovery.
8. Timer overflow slicing and requery-on-fire.
9. Concurrent duplicate/stale rating idempotency.
10. Verified SQLite PRAGMAs and `BEGIN IMMEDIATE` rollback behavior.
11. Backup consistency during writes and restore rejection for corrupt, foreign,
    and future-schema files.
12. Host, Origin, and anti-forgery rejection tests.
13. Service-worker exclusion of API and SSE.
14. Focus and live-region behavior in both Arabic and English.
15. Manual NVDA speech assertions that automation cannot make.

## 16. Product-Spec Amendments Resulting from Research

The approved product behavior remains intact. The following technical
clarifications should be incorporated before planning:

1. Change the design status to approved, with implementation planning pending.
2. Name `ts-fsrs@5.4.1` as the initial FSRS-6 adapter and explicitly exclude
   research-only FSRS-7 until a stable supported implementation exists.
3. Normalize scheduler state under OpenRecall ownership; never persist raw
   upstream objects or deprecated fields.
4. Add scheduler time projection and capture per-review timezone/study boundary
   for deterministic replay.
5. Define the 400 threshold as adapter-accepted training target examples and
   label it an OpenRecall policy, not an upstream library requirement.
6. Correct optimizer cancellation semantics; do not describe `timeout` as a
   deadline.
7. Add the Node timer-delay cap and mandatory due-time requery.
8. Specify direct `better-sqlite3`, WAL, `synchronous=FULL`,
   `trusted_schema=OFF`, verified PRAGMAs, and immediate rating transactions.
9. Specify browser-download backup and staged multipart restore.
10. Add exact Host validation and bootstrap-token behavior.
11. Add `dir="auto"` to user card content.
12. Require prompt-based PWA updates and network-only API/SSE behavior.

These amendments were reviewed and approved on 2026-07-28 and are binding on
the implementation plans.
