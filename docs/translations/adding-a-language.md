# Adding an OpenRecall language

Translations are a platform boundary. A new language must not require changes
to page, review, settings, statistics, or card components.

## 1. Add the locale definition

Create one file under `packages/i18n/src/locales/` that exports a
`LocaleDefinition`. Use the English catalog as the source checklist and set:

- `tag`: a canonical BCP 47 language tag;
- `displayName`: the language name written in that language;
- `direction`: `ltr` or `rtl`;
- `formatLocale`: an explicit Intl locale, including a numbering-system
  extension when required;
- `resources`: plain text for every catalog resource key.

Do not put HTML in a message. Keep interpolation tokens such as `{{count}}`,
`{{name}}`, and `{{percent}}` unchanged. Card content is user data and must
never be inserted into navigation labels, error logs, or generic live
announcements.

## 2. Register it in the locale package

Add the tag to `SUPPORTED_LOCALES`, import the definition in
`locale-definitions.ts`, and export it from the package index. These are the
only registry changes. Server validation and the bootstrap schema derive their
production locale allowlist from this package; application components do not
change.

`en-XA` is different: it is an expansion test locale, is absent from
`SUPPORTED_LOCALES`, and may be enabled only when the server runs in
development with:

```text
NODE_ENV=development
OPENRECALL_ENABLE_PSEUDO_LOCALE=1
OPENRECALL_LOCALE=en-XA
```

It must never be offered as a production language.

## 3. Prove catalog and plural parity

Run:

```bash
pnpm exec vitest run packages/i18n
pnpm check
```

The static analysis scans literal translation calls and dynamic key families.
It rejects missing, empty, stale, and extra catalog entries. Extend
`requiredPluralSuffixes` for the locale and test every category returned by
`Intl.PluralRules`; Arabic, for example, requires zero, one, two, few, many,
and other.

Use the shared explicit-locale formatters for numbers, absolute and relative
time, durations, plural counts, and rating counts. Add formatter tests for the
language's digits and an explicit timezone. Never rely on the machine's
process locale or timezone.

## 4. Manual release audit

Before release, inspect every route with representative long text and large
numbers in stable Chrome. Test:

- keyboard-only operation and visible focus;
- stable NVDA speech for headings, errors, review reveal, and the next question;
- the declared text direction plus `dir="auto"` user card content;
- 320 CSS-pixel width and 400% zoom;
- light, dark, forced-color, and reduced-motion modes;
- date, duration, rating, count, and all plural forms.

Capture screenshots for visual/layout review, but use the keyboard and NVDA
audit as the acceptance evidence for interaction and speech.
