# OpenRecall Chrome/NVDA review checklist

This checklist is intentionally speech-focused. The text of a card is test
data; NVDA may add its normal role/state suffixes after that text.

## Verification record

| Check | Version | Arabic | English |
| --- | --- | --- | --- |
| Automated Chromium keyboard, focus, SSE, and end-to-end review | Chrome for Testing 151.0.7922.34; Playwright 1.62.0 | Pass | Pass |
| Automated management/statistics lifecycle, keyboard, RTL/LTR, and 400% reflow equivalent | Chrome for Testing 151.0.7922.34; Playwright 1.62.0 | Pass | Pass |
| Automated axe serious/critical findings | axe-core 4.12.1 | None | None |
| Installed desktop Chrome detected | Google Chrome 150.0.7871.184 | Not run manually | Not run manually |
| Manual NVDA speech run | NVDA was not installed or discoverable on this machine on 2026-07-28 | Pending | Pending |

Do not mark the manual rows as passed without listening to both language runs
on the released build. Record the exact NVDA and Chrome versions here when that
run is performed.

## Test data

- Question: `What is active recall?` / `ما المقصود بالاستدعاء النشط؟`
- Answer: `Retrieving an answer from memory.` / `استرجاع الإجابة من الذاكرة.`
- Notes: `Do not reread first.` / `لا تقرأ الإجابة أولًا.`
- Add a second presentation with a visibly different question for the same
  learning item.

## Run once in Arabic and once in English

1. Start a review.
   - “Question” / `السؤال` is the `h1`; the question content is normal text.
   - Focus moves directly to that normal question content. Expected speech
     begins with only the question text, without the preceding heading label or
     a heading-role announcement.
   - The live region must not repeat the question, answer, or notes.

2. Press Space or activate “Show answer” / `عرض الإجابة`.
   - “Answer” / `الإجابة` is an `h2`; the answer content is normal text.
   - Focus moves directly to that normal answer content. Expected speech begins
     with only the answer text, without the preceding heading label or a
     heading-role announcement.
   - Optional “Notes” / `الملاحظات` is a separate `h2`, reachable with heading
     navigation; the notes content itself is normal text.
   - With empty or omitted notes, neither a notes heading nor content exists.

3. Inspect the rating group and activate Again / `مرة أخرى`.
   - Four buttons are exposed in a named rating group, each with its interval.
   - Intervals use localized minutes below one hour, hours below 24 hours, days
     below 30 days, and months from 30 days onward.
   - When the next card is ready, focus moves directly to its normal question
     content and NVDA announces it without the preceding heading label.
   - If due work joined the current session, the polite status announces only
     the count; it never exposes card content.

4. Reach the waiting state.
   - Focus moves to “No cards are due now” /
     `لا توجد بطاقات مستحقة الآن`.
   - The exact next due date and time is exposed in a semantic `time` element,
     or the page says that no future review is scheduled.
   - When the due timer fires, the item rejoins without a refresh. Its alternate
     presentation is announced directly as the newly focused question.
   - The same transition succeeds if the SSE notification is unavailable,
     because the page keeps one server-relative timer for the exact due interval.

5. Press 0 or activate End review / `إنهاء المراجعة`.
   - Pressing 0 only focuses the button and performs no destructive action.
   - The dialog name is “End this review session?” /
     `هل تريد إنهاء جلسة المراجعة؟`.
   - Its description distinguishes Continue later (pause) from Finish session
     (permanent completion).
   - Tab and Shift+Tab remain inside the dialog. Escape/Cancel closes it and
     restores focus to the End review button.

6. Choose Continue later / `المتابعة لاحقًا`, reload, then resume.
   - The paused state persists after reload.
   - Focus is on “Review paused” / `المراجعة متوقفة مؤقتًا`.
   - Resume returns to the current card or waiting state without losing the
     session.

7. Explicitly finish.
   - Focus moves to “Review completed” / `اكتملت المراجعة`.
   - Heading navigation reaches the semantic summary, definition-list totals,
     and rating-distribution table.
   - Home and Back to section are real links with unambiguous names.

## Keyboard isolation

- Space and keys 1–4 do nothing while focus is in an input, textarea, select,
  editable region, or modal dialog.
- Keys 1–4 rate only while the answer is visible.
- Browser and NVDA commands keep their native behavior when OpenRecall does not
  own the shortcut.

## Management and statistics run

Run once in Arabic and once in English:

1. Open a section containing a reviewed multi-presentation card.
   - Heading navigation reaches the section statistics before card management.
   - Every presentation editor is a named fieldset.
   - Editing question text does not change the scheduler state or the immutable
     question snapshot in review history.

2. Expand “Show card statistics” / `عرض إحصاءات البطاقة`.
   - The disclosure button exposes its expanded state and remains the focus
     owner while data loads.
   - NVDA announces the busy state without moving focus.
   - Definition-list terms expose current state, due time, retrievability,
     stability, difficulty, repetitions, lapses, and last review.
   - Table navigation reaches presentation exposures and paginated review
     history, including the historical text snapshot.

3. Move the card to trash, then undo.
   - The status message announces the reversible action and its undo button.
   - The restored card retains state and review history.

4. Open permanent delete on a separate card.
   - The dialog says that the whole learning item, every presentation, state,
     and history will be removed.
   - Focus is trapped and restored on cancel.
   - After confirmation, only that card disappears.

5. Open global statistics and apply section and date filters.
   - All three controls have native labels.
   - Focus moves to the Results / `النتائج` heading after the loader refresh.
   - Heading navigation reaches a plain-language summary before each visual
     chart.
   - Each visual chart is ignored by accessibility APIs; its captioned native
     table contains every value and is the authoritative NVDA representation.
   - “Not enough data” is distinguishable from a real numeric zero.

6. At 400% browser zoom, or an equivalent 320 CSS-pixel viewport:
   - No horizontal page scrolling is required.
   - Wide data tables scroll only inside their own keyboard-focusable
     containers.
   - Visible focus and table/heading navigation remain usable in both RTL and
     LTR layouts.
