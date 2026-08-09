# OpenRecall Review Priority and Section Disclosures Design

Date: 2026-08-09

Status: Approved for implementation

## Objective

Make intra-session learning repetitions appear immediately after the card that
is currently being reviewed once their exact due time has arrived, make the
End review control finish the session directly, and replace the section page's
eager long layout with three accessible, lazy disclosures.

## Confirmed product decisions

- A due learning repetition must not interrupt the active card. It becomes the
  next card claimed after that active card is rated.
- A learning repetition must not wait behind the ordinary backlog that was
  queued at session start.
- End review finishes the session immediately. It does not open a choice
  between pausing and finishing.
- The Statistics, Cards, and Section management areas are collapsed by
  default and independently expandable.
- Section statistics and cards must not be requested when the section route
  first loads. Their data is loaded only when the corresponding disclosure is
  opened for the first time.
- Start review and Import cards remain visible outside the disclosures.
- Implementation is performed by the primary agent. An independent agent may
  review the finished changes but must not implement them.
- Automated work must not inspect, configure, start, stop, or otherwise
  control the owner's installed NVDA.

## Root-cause findings

### Due repetitions are merged correctly but claimed with ordinary ordering

`DueWakeService` already keeps an exact timer for the nearest scheduler due
time. When the timer fires, `ReviewQueueRepository.mergeDueItems` inserts the
new appearance and publishes a review invalidation event. This mechanism also
runs while another card is active, so no polling or fixed client-side learning
step is missing.

The defect is in `ReviewSessionRepository.selectQueued`. Every queued
appearance is ordered by `enqueued_due_at_ms` and then ID. Cards that were due
when the session began consequently have earlier due timestamps than a
learning repetition that becomes due one minute later. The repetition is
inserted at the correct minute but remains behind the entire original backlog.

### End review currently opens a pause-or-finish dialog

`ReviewPage` routes End review through `EndSessionDialog`, whose first action
is Continue later and whose second action is Finish. The server's `/finish`
route already performs the requested terminal operation: it completes the
session, marks queued and active appearances as removed, and returns the
immutable session summary. The mismatch is the client interaction, not the
finish transaction.

### The section route and card list load eagerly

The section route loader requests the section summary and full section
statistics concurrently. `SectionPage` immediately mounts `CardList`, and
`CardList` requests the first card page from its mount effect. Statistics,
cards, and section management are then rendered one after another, producing a
long page even when the user only wants to start a review or import cards.

## Alternatives considered

### Queue every newly inserted appearance ahead of the backlog

Ordering by newest enqueue time would be small, but it would also prioritize a
previously unseen item that happens to become due while a session is open. A
stream of such items could repeatedly displace the established backlog, and
the rule would not express the user's intent: prompt intra-session learning
repetitions.

### Store a persistent queue-priority column

A migration and a priority column would make the distinction explicit, but it
would permanently extend the database format for a value that is already
derivable from session history. It would also require migration, backup, and
compatibility coverage without improving the scheduler state.

### Derive repetition priority from the current session

This is the selected approach. A queued appearance is a session repetition
when a completed appearance for the same learning item already exists in the
same session. SQLite's `EXISTS` expression yields a deterministic boolean
ordering key without changing the schema. Repetitions sort first; ties retain
the existing due-time and ID order.

The rule is restricted to queue presentation. It does not alter FSRS state,
learning steps, due timestamps, parameter profiles, or future scheduler
adapters.

## Design

### 1. Exact due repetition priority

`ReviewSessionRepository` will select queued appearances using these ordering
terms:

1. appearances whose learning item already has a completed appearance in this
   session;
2. `enqueued_due_at_ms` ascending;
3. queue entry ID ascending as the deterministic final tie-breaker.

The existing active appearance check remains first. Therefore a due repetition
never replaces or interrupts the question or answer already displayed. When
the user rates that active appearance, the route calls `claimNext`; if a
repetition became due in the meantime, it is selected ahead of ordinary queued
cards.

If the session has no active appearance when the exact server timer fires, the
existing invalidation and `/next` recovery path claims the due appearance. If
the browser misses the event, rating the current card, reopening the route, or
the existing waiting-state deadline still converges on canonical database
state.

No new polling loop, timer cadence, scheduler step, or database migration is
introduced.

### 2. Direct terminal End review action

The visible End review button will invoke the existing `/finish` endpoint
directly. Before starting the request, the page will invalidate pending claim
work and block reveal/rating/claim interactions so an older asynchronous
response cannot replace the completion summary.

On success, the returned completed state renders `SessionSummary`. On failure,
the page removes the interaction block, clears busy state, announces the
localized error, and leaves the current review usable.

The pause choice and `EndSessionDialog` are removed from the current UI. Server
pause/resume behavior remains for database and API compatibility with sessions
paused by earlier OpenRecall versions. A previously paused session can still
be resumed safely, but users cannot create a new paused session through End
review.

### 3. Accessible lazy section disclosures

The section route loader will request only `SectionSummary`. The section page
keeps Back to home, the section name, Import cards, and Start review visible.
It then presents three independent level-two disclosure headings:

- Statistics;
- Cards;
- Section management.

Each heading contains one native button. The button exposes `aria-expanded`
and `aria-controls`; its panel has the matching ID and an accessible
relationship back to the heading button. Enter and Space use native button
behavior. The controls remain in normal Tab order, and collapsing a panel
removes its descendants from visual display and the accessibility tree.

All disclosures start collapsed. Opening Statistics for the first time starts
the section-statistics request and exposes an in-panel loading status. Opening
Cards for the first time mounts `CardList`, which then performs its existing
paginated request. Section management is mounted only after its first opening
and requires no extra initial request.

After a panel has been opened once, its component remains mounted but hidden
while collapsed. This preserves card searches, pagination, loaded statistics,
rename form state, and errors during the current page visit without issuing a
second request every time the panel is reopened. The hidden subtree contributes
no page length and no focusable controls while collapsed.

The Cards disclosure heading becomes the single structural label for the card
area; `CardList` will not render a redundant second Cards heading inside the
panel.

### 4. Loading and error boundaries

Statistics loading state belongs inside the Statistics panel and uses the
existing localized status and error conventions. A failed request can be
retried from that panel without reloading the section route. Card-list loading
and retry behavior remains owned by `CardList`.

Renaming the section updates the route heading and the management panel without
collapsing unrelated panels. Permanent section deletion retains the existing
navigation and home-page announcement behavior.

## Accessibility and user-visible behavior

- Due repetition claims continue to focus and announce only the new question
  content through the existing review focus behavior.
- End review does not move focus into an unnecessary dialog. Successful
  completion renders the existing summary and return controls; failures retain
  a usable review.
- The three disclosure buttons have concise localized accessible names and
  announce expanded or collapsed state through `aria-expanded`.
- Hidden panel controls cannot be reached by Tab or screen-reader navigation.
- Loading messages occur only inside the panel the user intentionally opened.
- No automated test interacts with the installed NVDA. Browser and DOM tests
  validate the accessibility contract instead.

## Test strategy

All behavior changes follow red-green-refactor. Each regression test is first
observed failing for the intended reason.

1. Database repository tests create an ordinary backlog plus a completed
   learning item that re-enters when due. Before its due time the ordinary next
   item is claimed; at the exact boundary the repetition is claimed first.
2. Queue tests retain deterministic due-time ordering among multiple
   repetitions and ordinary entries and confirm the active card is never
   displaced.
3. Server route tests exercise rating and due-wake integration so a repetition
   merged while another card is active becomes the next question after that
   card is rated.
4. Review-page tests assert that End review makes one `/finish` request without
   rendering the old dialog or calling `/pause`, protects against stale claim
   responses, renders the returned summary, and recovers from request failure.
5. Section-page and router tests assert that all three controls begin with
   `aria-expanded="false"`, their panels are hidden, and initial navigation
   requests neither statistics nor cards.
6. Disclosure tests open each panel with keyboard-compatible button behavior,
   assert first-open lazy loading, no duplicate request after collapse and
   reopen, hidden focus exclusion, localized error handling, and preserved
   rename/deletion behavior.
7. The project typecheck, lint, unit/integration suite, accessibility tests,
   production build, and browser end-to-end suite run before completion.

## Compatibility and non-goals

- No SQLite schema migration or backup format change.
- No change to scheduler calculations, FSRS parameters, learning/relearning
  step settings, optimizer data, or algorithm version adapters.
- No interruption or automatic replacement of the currently visible card.
- No global accordion rule that forces only one section panel to remain open.
- No persistence of disclosure state across navigation or application restarts.
- No removal of legacy server pause/resume compatibility in this change.
- No interaction with the user's physical screen reader.

## References

- W3C WAI-ARIA Authoring Practices, Accordion Pattern:
  <https://www.w3.org/WAI/ARIA/apg/patterns/accordion/>
- WAI-ARIA 1.2, `aria-expanded` state:
  <https://www.w3.org/TR/wai-aria/#aria-expanded>
- React documentation, Conditional Rendering:
  <https://react.dev/learn/conditional-rendering>
- SQLite documentation, `EXISTS` operator:
  <https://sqlite.org/lang_expr.html#the_exists_operator>
- SQLite documentation, `ORDER BY`:
  <https://www.sqlite.org/lang_select.html#orderby>
