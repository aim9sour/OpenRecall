# OpenRecall Import Preview Notes Design

Date: 2026-08-09

Status: Approved for implementation

## Objective

Show the primary presentation's optional notes beside its question and answer
in the JSON import preview so the user can understand the complete card before
deciding whether to import it.

## Confirmed product decisions

- Add a dedicated Notes column to the existing import preview table.
- Show notes for the primary presentation only.
- Do not show the notes, questions, or answers of `variants` in this change.
- Keep notes optional. A missing, `null`, or empty notes value produces an
  empty cell and never blocks preview or import.
- Preserve the existing selection, duplicate detection, validation, and commit
  behavior.
- Automated tests must not inspect, configure, start, stop, or otherwise
  interact with the owner's installed NVDA.

## Current behavior and data flow

`ImportPage` keeps the parsed JSON content locally after the server validates
it. The preview response contains each source index, validation status,
warnings, and issues, while the page reads the primary `front` and `back`
directly from the parsed source object for display. The same source object
already contains the optional primary `notes`, so this feature requires no API
contract, validation, database, or backup-format change.

The current table columns are Select, Status, Question, Answer, and Messages.
Notes are validated and imported but are not visible before commit, which
prevents a user from considering all primary learning context when selecting a
card.

## Alternatives considered

### Dedicated Notes column

This is the selected approach. It matches the existing Question and Answer
presentation, makes the field directly discoverable in visual and table
navigation, and requires no extra expansion action for every card.

### Collapsible details for every row

This would keep the table narrower, but it would add a separate action for
each card and hide information that the user explicitly wants while making an
import decision.

### Notes appended inside the Answer cell

This would avoid another column, but it would weaken the semantic distinction
between answer and notes and make table navigation less predictable for
screen-reader users.

## Design

The import preview table gains a localized Notes column immediately after
Answer and before Messages. For each preview row, the page safely reads the
primary source object's `notes` property using the same defensive rules used
for `front` and `back`:

- a string is rendered as literal text;
- a missing property, `null`, or any non-string value renders as an empty
  cell;
- `variants` are never traversed for display;
- the cell uses automatic text direction so Arabic, English, and mixed card
  content remain readable.

React text rendering remains the only rendering path. Notes are not parsed as
HTML and no raw markup API is introduced. Existing invalid rows can still be
previewed safely because the display helper tolerates malformed source values.

The column header uses a new import-specific translation key in every shipped
locale. The wording is `Notes` in English and `الملاحظات` in Arabic. Reusing a
generic card translation is intentionally avoided so the import catalog stays
explicit and independently evolvable.

## Accessibility and layout

- The Notes label is a normal table column header with `scope="col"`, allowing
  browser and screen-reader table navigation to associate it with each notes
  cell.
- Card content remains ordinary text, not a heading or interactive element.
- Empty notes cells do not announce invented filler such as "No notes" and do
  not add noise during fast navigation.
- The existing horizontally scrollable table container handles the additional
  column without forcing content outside the page.
- No focus management or live-region behavior changes are required.

## Test strategy

Implementation follows red-green-refactor:

1. Extend the import-page test fixture with primary notes and different
   variant notes.
2. Add an assertion that the localized Notes column exists and the primary
   notes are rendered literally with automatic text direction.
3. Assert that variant notes are absent from the preview.
4. Cover a card with omitted or `null` primary notes and verify preview and
   selection remain usable without placeholder text.
5. Run the focused import-page test, typecheck, lint, the complete automated
   test suite, accessibility checks, and production build before completion.

## Compatibility and non-goals

- No API or TypeBox contract change.
- No database migration or SQLite backup change.
- No JSON import schema change.
- No change to duplicate detection or whether duplicate rows may be selected.
- No display of variants in the preview.
- No editing of card content from the preview table.
- No interaction with the user's physical screen reader.
