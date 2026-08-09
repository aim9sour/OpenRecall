# Import Preview Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each imported card's primary optional notes beside its question and answer in the import preview table.

**Architecture:** Keep the server preview contract and parsed JSON state unchanged. Extend the import page's existing defensive primary-field reader to accept `notes`, render one localized Notes column as literal text, and prove the behavior through the existing page integration test.

**Tech Stack:** TypeScript 7.0.2, React 19.2.8, React Router 8.3.0, Vitest 4.1.10, Testing Library 16.3.2, pnpm 11.17.0, Node 24.18.0.

## Global Constraints

- Show notes for the primary presentation only; never traverse or render `variants` in this change.
- Missing, `null`, empty, or non-string notes render an empty cell and never block preview or import.
- Render imported content only through React text nodes; do not parse HTML or introduce a raw-markup API.
- Add no dependency, API contract change, JSON schema change, SQLite migration, or backup-format change.
- Preserve selection, duplicate detection, validation, commit, focus, and live-region behavior.
- Add every new user-visible label to both English and Arabic catalogs and the typed catalog key list.
- The primary agent performs the implementation; another agent may only perform an independent review when a review skill requires it.
- Do not query, configure, launch, stop, or otherwise interact with the owner's installed NVDA.
- Follow red-green-refactor and run verification with Node `v24.18.0` and pnpm `11.17.0`.

---

## File structure

- `apps/web/src/pages/ImportPage.tsx` remains the sole owner of rendering parsed primary card fields in the import preview table.
- `apps/web/src/pages/ImportPage.test.tsx` owns the page-level regression coverage for literal primary notes, excluded variant notes, empty optional notes, selection, and commit.
- `packages/i18n/src/catalog-keys.ts` declares the new typed `import.notes` key.
- `packages/i18n/src/locales/en.ts` and `packages/i18n/src/locales/ar.ts` provide the shipped Notes header translations.
- `docs/superpowers/specs/2026-08-09-import-preview-notes-design.md` records final written-spec approval.
- `CHANGELOG.md` records the user-visible preview improvement under Unreleased.

### Task 1: Render primary notes in the import preview

**Files:**
- Modify: `apps/web/src/pages/ImportPage.test.tsx`
- Modify: `apps/web/src/pages/ImportPage.tsx:23-30,153-183`
- Modify: `packages/i18n/src/catalog-keys.ts:227-238`
- Modify: `packages/i18n/src/locales/en.ts:283-294`
- Modify: `packages/i18n/src/locales/ar.ts:280-291`
- Modify: `docs/superpowers/specs/2026-08-09-import-preview-notes-design.md:5`
- Modify: `CHANGELOG.md:8-14`

**Interfaces:**
- Consumes: the existing local `content: unknown` parsed from the selected JSON file and the source row's `index` from `ImportPreviewRow`.
- Produces: `cardText(content: unknown, index: number, field: "front" | "back" | "notes"): string` and a localized `import.notes` column whose cells contain only the primary source object's string notes.

- [ ] **Step 1: Expand the existing integration fixture and write failing notes assertions**

In `apps/web/src/pages/ImportPage.test.tsx`, change the preview response to describe two valid rows:

```ts
return {
  previewId: "preview",
  digest: "a".repeat(64),
  total: 2,
  valid: 2,
  duplicate: 0,
  invalid: 0,
  rows: [
    { index: 0, status: "valid", issues: [], warnings: [] },
    { index: 1, status: "valid", issues: [], warnings: [] },
  ],
} as T;
```

Replace the uploaded JSON object with this array so the first row distinguishes
primary notes from variant notes and the second row omits notes entirely:

```ts
JSON.stringify([
  {
    front: "2 < 3",
    back: "True & literal",
    notes: "Primary note: 2 < 3 & context",
    variants: [
      {
        front: "Alternative",
        back: "True",
        notes: "Variant-only note",
      },
    ],
  },
  {
    front: "Question without notes",
    back: "Answer without notes",
  },
]),
```

Immediately after the existing literal question assertion, add:

```ts
expect(screen.getByRole("columnheader", { name: "Notes" })).not.toBeNull();

const primaryNotes = screen.getByText("Primary note: 2 < 3 & context");
expect(primaryNotes.getAttribute("dir")).toBe("auto");
expect(primaryNotes.querySelector("*")).toBeNull();
expect(screen.queryByText("Variant-only note")).toBeNull();

const noNotesRow = screen.getByText("Question without notes").closest("tr");
expect(noNotesRow).not.toBeNull();
expect(noNotesRow?.querySelectorAll("td")[4]?.textContent).toBe("");
```

Replace the single-checkbox disable/enable interaction with both valid rows so
the existing commit path remains covered:

```ts
const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([true, true]);

for (const checkbox of checkboxes) await user.click(checkbox);
expect(
  (screen.getByRole("button", { name: "Import cards" }) as HTMLButtonElement)
    .disabled,
).toBe(true);
for (const checkbox of checkboxes) await user.click(checkbox);
await user.click(screen.getByRole("button", { name: "Import cards" }));
```

- [ ] **Step 2: Run the focused test and verify the intended failure**

Run in PowerShell with the repository's configured Node runtime first on
`PATH`:

```powershell
$env:PATH="C:\Users\abdo\AppData\Local\Temp\openrecall-node-v24.18.0-release\node-v24.18.0-win-x64;$env:PATH"
pnpm exec vitest run apps/web/src/pages/ImportPage.test.tsx
```

Expected: FAIL because no column header named `Notes` exists and the primary
notes string is not rendered. Confirm this is an assertion failure, not a test
setup, runtime, or syntax failure.

- [ ] **Step 3: Add the typed localized Notes label**

Add `"import.notes"` immediately after `"import.back"` in
`packages/i18n/src/catalog-keys.ts`:

```ts
"import.front",
"import.back",
"import.notes",
"import.messages",
```

Add the matching locale entries immediately after `import.back`:

```ts
// packages/i18n/src/locales/en.ts
"import.notes": "Notes",

// packages/i18n/src/locales/ar.ts
"import.notes": "الملاحظات",
```

- [ ] **Step 4: Implement the minimal defensive primary-notes rendering**

Broaden only the local field union in `apps/web/src/pages/ImportPage.tsx`:

```ts
function cardText(
  content: unknown,
  index: number,
  field: "front" | "back" | "notes",
) {
  const card = asCards(content)[index];
  if (typeof card !== "object" || card === null || Array.isArray(card)) {
    return "";
  }
  const value = (card as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}
```

Insert the Notes header after Answer and its literal text cell after the
primary answer cell:

```tsx
<th scope="col">{t("import.back")}</th>
<th scope="col">{t("import.notes")}</th>
<th scope="col">{t("import.messages")}</th>
```

```tsx
<td dir="auto">{cardText(content, row.index, "back")}</td>
<td dir="auto">{cardText(content, row.index, "notes")}</td>
<td><ul>{[...row.issues, ...row.warnings].map((message) => (
  <li key={`${message.path}-${message.messageKey}`}>
    {message.path}: {t(message.messageKey)}
  </li>
))}</ul></td>
```

Retain the existing issues/warnings behavior exactly as shown.

- [ ] **Step 5: Run the focused test and type checks**

Run:

```powershell
pnpm exec vitest run apps/web/src/pages/ImportPage.test.tsx
pnpm check
```

Expected: both commands exit `0`; the page test passes and the typed catalog
accepts `import.notes` in both locales.

- [ ] **Step 6: Record approval and the user-visible change**

In `docs/superpowers/specs/2026-08-09-import-preview-notes-design.md`, replace
the status with:

```markdown
Status: Approved for implementation
```

Under `## Unreleased` → `### Changed` in `CHANGELOG.md`, add:

```markdown
- Import previews now show each card's primary optional notes beside its
  question and answer before selection.
```

- [ ] **Step 7: Run the complete verification gate**

Confirm the runtime, then execute the repository's serial full gate:

```powershell
node --version
pnpm --version
pnpm verify:full
```

Expected versions: Node `v24.18.0`, pnpm `11.17.0`. Expected result:
typechecks, dependency-license validation, the complete Vitest suite including
DOM accessibility coverage, production builds, production smoke checks, and
Playwright end-to-end tests all exit `0`.

- [ ] **Step 8: Review the diff and commit the implementation**

Run:

```powershell
git diff --check
git diff -- apps/web/src/pages/ImportPage.tsx apps/web/src/pages/ImportPage.test.tsx packages/i18n/src/catalog-keys.ts packages/i18n/src/locales/en.ts packages/i18n/src/locales/ar.ts docs/superpowers/specs/2026-08-09-import-preview-notes-design.md CHANGELOG.md
git status --short
```

Verify the diff contains no variant traversal, raw HTML rendering, API/schema
change, unrelated file, or physical screen-reader interaction. Then commit:

```powershell
git add -- apps/web/src/pages/ImportPage.tsx apps/web/src/pages/ImportPage.test.tsx packages/i18n/src/catalog-keys.ts packages/i18n/src/locales/en.ts packages/i18n/src/locales/ar.ts docs/superpowers/specs/2026-08-09-import-preview-notes-design.md CHANGELOG.md
git commit -m "feat: show notes in import preview"
```
