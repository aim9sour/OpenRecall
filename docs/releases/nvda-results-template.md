# Stable Chrome and NVDA manual results

Status: **not executed**. This is a manual-only release gate. Automated focus,
role, name, keyboard, reflow, and axe checks are supporting evidence, not a
substitute for hearing the real speech output.

Automation must not control, reconfigure, restart, inspect, or send global
shortcuts to a tester's installed screen reader without the tester's explicit
consent. Fill this document during a consented human audit and keep exact
speech observations free of real card content.

## Environment

| Field | Result |
| --- | --- |
| Date and timezone | |
| Windows edition/build | |
| Stable Chrome version | |
| NVDA version and installation type | |
| OpenRecall commit | |
| Keyboard layout | |
| Speech synthesizer/language | |
| Auditor | |

## Result notation

- `[x]` means the human auditor completed the flow and heard/observed the
  expected result.
- `[ ]` means not run or failed. Add an issue link and exact reproduction for a
  failure.
- Use synthetic card text only. Do not paste personal study content into this
  repository.

## Arabic

- [ ] Landmarks, headings, skip link, and RTL navigation order are correct.
- [ ] Section creation, JSON import, and validation-error focus work by
  keyboard.
- [ ] Starting review announces the question text directly.
- [ ] Revealing announces the answer text directly without adding “Answer.”
- [ ] Optional notes are reachable by heading navigation, but the immediate
  announcement does not add “Notes.”
- [ ] Rating with keys `1`–`4` announces the next question directly and once.
- [ ] Queue and session status announcements do not duplicate card content.
- [ ] Waiting, due-item arrival, pause, resume, early finish, and completion
  work.
- [ ] Card edit, statistics disclosure, trash, restore, and permanent deletion
  work.
- [ ] Scheduler settings, training, backup download, and restore work.
- [ ] 400% zoom, forced colors, light/dark/system themes, and reduced motion
  preserve every critical flow.

Observed speech or issue references:

```text
Not run.
```

## English

- [ ] Landmarks, headings, skip link, and LTR navigation order are correct.
- [ ] Section creation, JSON import, and validation-error focus work by
  keyboard.
- [ ] Starting review announces the question text directly.
- [ ] Revealing announces the answer text directly without adding “Answer.”
- [ ] Optional notes are reachable by heading navigation, but the immediate
  announcement does not add “Notes.”
- [ ] Rating with keys `1`–`4` announces the next question directly and once.
- [ ] Queue and session status announcements do not duplicate card content.
- [ ] Waiting, due-item arrival, pause, resume, early finish, and completion
  work.
- [ ] Card edit, statistics disclosure, trash, restore, and permanent deletion
  work.
- [ ] Scheduler settings, training, backup download, and restore work.
- [ ] 400% zoom, forced colors, light/dark/system themes, and reduced motion
  preserve every critical flow.

Observed speech or issue references:

```text
Not run.
```

## Sign-off

- [ ] No unresolved critical-flow defect.
- [ ] Exact environment and both locale sections are complete.
- [ ] The first-release checklist links this signed result.

Auditor name/date:

```text
Not signed.
```
