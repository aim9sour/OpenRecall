# Scheduler and optimizer upgrade protocol

OpenRecall treats a scheduler upgrade as a data-format change, not a routine
dependency bump. Stored review logs, scheduler states, parameter profiles, and
replay results must remain explainable after an upgrade.

## Released baseline

The current stable boundary is:

- algorithm: FSRS-6, algorithm version `6.0`;
- scheduler: `ts-fsrs@5.4.1`;
- optimizer: `@open-spaced-repetition/binding@0.5.0`;
- OpenRecall adapter version: `1`;
- parameter count: 21.

These versions are pinned in the lockfile. Runtime scheduling goes through
`packages/scheduler/src/fsrs6-adapter.ts`; historical replay goes through a
versioned `ReplayAdapter`. Database rows record the algorithm ID, algorithm
version, adapter version, parameter-profile ID, settings, timezone, and study
day boundary used for each rating.

The optimizer binding is a public beta. Its option named `timeout` is a progress
polling interval, not a deadline. OpenRecall therefore runs it in a worker and
uses its cooperative progress channel for cancellation.

## Required upgrade review

Do not change either FSRS package until all of the following are complete:

1. Confirm that the candidate is a stable release in the upstream scheduler and
   optimizer projects. Read the complete upstream changelogs and release notes,
   including transitive `fsrs-rs` changes.
2. Record the exact scheduler algorithm, parameter shape and defaults,
   supported states, time units, learning/relearning behavior, fuzz behavior,
   and optimizer input contract. Never infer these from a package version.
3. Add a new adapter and manifest. Do not mutate an adapter that has already
   written released data. Increment the adapter and adapter-schema versions when
   stored state or mapping semantics change.
4. Implement explicit old-state-to-new-state and parameter-profile mapping.
   Reject unknown algorithm/adapter versions instead of coercing them.
5. Add a database migration that preserves old identifiers and immutable review
   evidence. Opening an existing database must first create and validate an
   automatic SQLite snapshot.
6. Replay the released golden fixtures through their original adapter and prove
   byte-for-byte-equivalent state, due time, parameter source, and revision.
7. Replay the same histories through the candidate adapter and review every
   intentional state or due-date difference. Test new, learning, review,
   relearning, same-day, lapse, long-interval, timezone, and study-day-boundary
   cases.
8. Build optimizer examples in global target-review time order. Prove raw review
   and eligible-prefix counts separately, run real optimization and time-series
   evaluation, exercise cancellation, and validate all returned parameters and
   metrics before persistence.
9. Preview the candidate profile against stored histories. Show earlier, later,
   and unchanged due counts plus the old and new 30-day workloads. Applying or
   rolling back requires an automatic snapshot, a matching source cutoff and
   state revisions, and one atomic transaction.
10. Run the complete repository checks, both locale E2E projects, accessibility
    checks, backup/restore tests, and an upgrade from every released schema
    fixture before publishing.

Upstream references:

- [ts-fsrs repository](https://github.com/open-spaced-repetition/ts-fsrs)
- [fsrs-rs repository](https://github.com/open-spaced-repetition/fsrs-rs)
- [FSRS benchmark](https://github.com/open-spaced-repetition/srs-benchmark)

## FSRS-7 naming gate

Research or benchmark code is not a production integration. OpenRecall must not
label itself as supporting FSRS-7 until a stable supported scheduler and
optimizer combination exposes the same algorithm, and the adapter, mappings,
migrations, golden replay, optimizer evaluation, backup/restore, and release
gates above all pass.

Until then, the truthful claim is “FSRS-6 with an upgradeable, versioned
adapter.” A beta package may be studied on a separate branch, but it must not
read or write a user's production database.

## Failed upgrade or rollback

An upgrade failure must leave the existing database and active parameter
profile usable. Do not partially rewrite scheduler rows or relabel old history.
Restore the validated pre-migration snapshot or roll back through the same
profile-application path, then rearm the nearest-due service from the reopened
database.
