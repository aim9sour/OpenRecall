# OpenRecall statistics definitions

These definitions are normative for the statistics API and user interface. A
review event is one completed rating of one learning item. Alternate
presentations are not separate learning items.

## Scope and date range

- Global scope includes review logs from every section.
- Section scope includes only review logs whose stored `section_id` matches
  that section.
- `fromStudyDay` is inclusive and `toStudyDay` is exclusive.
- A study day is calculated in the configured IANA time zone after applying
  the configured study-day boundary. For example, with a 04:00 boundary, a
  rating at 03:59 belongs to the preceding study day.
- Date filters apply to historical review-event metrics and daily activity.
  Current state counts and the workload forecast describe current active
  cards, so they are not historical snapshots and are not restricted by the
  review-log date range.
- A requested range must be valid, ordered, and no longer than five years.

## Summary metrics

| Metric | Exact definition | Denominator and exclusions |
| --- | --- | --- |
| Review events | Number of completed rating rows in scope. | No rating row is excluded. |
| Unique cards | Count of distinct learning-item IDs represented by those rating rows. | Alternate presentations of one item count once. |
| Rating count | Number of in-scope events for each rating: Again `1`, Hard `2`, Good `3`, Easy `4`. | The four counts must sum to review events. |
| Actual recall | `(Hard + Good + Easy) / review events`. | The value is `null`, displayed as “Not enough data,” when there are no review events. Again is the only unsuccessful-recall rating. |
| Mean predicted retrievability | Sum of valid `retrievability_before` probabilities divided by the number of non-null probabilities. | Null samples are excluded and reported by `retrievabilityExcluded`. The value is `null` when no valid sample exists. |
| Study time | Sum of non-null, non-negative integer `review_duration_ms` values. | Null durations are excluded and reported by `durationExcluded`. A true sum of zero remains zero. |

Non-null probabilities outside `[0, 1]`, negative/non-integer durations, bad
ratings, missing learning-item IDs, and invalid timestamps are treated as
corrupt data. OpenRecall rejects the affected calculation instead of clamping
or silently changing it.

## Daily activity

Events are grouped by their computed study-day key. Each row contains:

- the number of review events that day;
- distinct learning items reviewed that day;
- the sum of recorded durations that day; and
- the number of events whose duration was unavailable.

The sum of all daily review-event counts always equals the number of review
events in the same scope and range.

## Current card states

Only active learning items with a scheduler state are counted.

- `total`: all such items;
- `dueNow`: items whose stored `due_at_ms` is less than or equal to the
  request's current time;
- `new`, `learning`, `review`, and `relearning`: counts by the stored scheduler
  memory state.

Trashed cards do not contribute to these current counts. Restoring a card
restores its existing state but does not create an artificial review event.

## Thirty-day workload forecast

The forecast is a dense series of 30 study days beginning with the current
study day. It groups the currently stored due timestamp of every active card.
Cards already overdue are counted on the current day. Dates with no currently
scheduled cards are included with a true zero.

This is a **current-schedule workload forecast**, not a simulation or promise
of future workload. Every future rating can change a card's due timestamp, so
the series changes after reviews, edits to scheduler settings, optimization,
restores, or deletions.

## Section progress

For each section, progress uses the same current-state definitions: active
total, due now, new, learning, review, and relearning. Section names and IDs
identify the scope; card content is never included in aggregate-statistics
responses.

## Per-card statistics

The card disclosure reports the current scheduler state and its algorithm and
parameter-profile source, current due time and retrievability, repetitions,
lapses, stability, difficulty, last rating, and last review time.

Presentation exposure rows contain active and retired presentation IDs,
lifecycle, show count, first shown time, and last shown time. Review history is
paginated and uses immutable question, answer, and notes snapshots recorded at
review time. Editing a card therefore does not rewrite its history. Moving a
card to trash preserves state and history; permanent deletion atomically
removes that learning item, all its presentations, state, exposures, queue
entries, and history without affecting sibling cards.
