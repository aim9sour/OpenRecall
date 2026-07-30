# JSON card import format

JSON import creates learning items inside one selected section. It accepts
either one card object or an array of card objects. The file must decode to no
more than 5 MiB and contain no more than 10,000 cards.

## Card shape

```json
{
  "front": "Required question",
  "back": "Required answer",
  "notes": "Optional plain-text notes",
  "variants": [
    {
      "front": "Alternate wording",
      "back": "Alternate answer",
      "notes": null
    }
  ]
}
```

- `front`: required, non-empty plain string.
- `back`: required, non-empty plain string.
- `notes`: optional string or `null`; omission and `null` both mean no notes.
- `variants`: optional array with any number of objects using the same
  `front`/`back`/`notes` rules. A variant cannot contain another `variants`
  array.

Every field is normalized for line endings and Unicode. HTML-like tags,
comments, doctype markup, and fields longer than 20,000 code points are
rejected. Markdown characters are not interpreted or rendered; they remain
literal plain text. Ordinary comparison text such as `2 < 3` remains valid.
Unknown fields produce preview warnings and are not persisted.

The primary presentation and all variants become one learning item with one
FSRS scheduler state. Smart rotation chooses among them; rating any
presentation updates that shared state.

## Preview and commit

Import never writes immediately. The preview reports each source index as
`valid`, `duplicate`, or `invalid`, with localized message keys and exact paths.
The commit includes the unchanged preview digest and selected valid indexes, so
tampered or stale content is rejected atomically.

[The valid example](../../examples/cards.valid.json) contains two accepted
items. [The invalid example](../../examples/cards.invalid.json) demonstrates:

- `cards[0].back`: missing required answer;
- `cards[1].variants[0].back`: variant answer is not a string;
- `cards[1].extra`: unknown field warning.

Duplicate detection compares normalized primary front/back text against both
the section and earlier rows in the same file. Variants do not become duplicate
scheduling items.

## Not a backup format

JSON import contains card presentations only. It cannot preserve review logs,
due states, sessions, statistics, settings, trained parameters, or audit
history. Use the in-application SQLite backup and restore workflow for backup.
