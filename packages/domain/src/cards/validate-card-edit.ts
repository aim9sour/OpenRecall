import { containsMarkup } from "../import/detect-markup.js";
import { normalizeText } from "../import/normalize.js";

const MAX_TEXT_CODE_POINTS = 20_000;

export interface CardEditPresentation {
  readonly id?: string;
  readonly front: string;
  readonly back: string;
  readonly notes: string | null;
}

export interface ValidatedCardEdit {
  readonly itemId: string;
  readonly presentations: readonly CardEditPresentation[];
}

export interface CardEditIssue {
  readonly path: string;
  readonly messageKey: string;
}

export type CardEditValidation =
  | { readonly ok: true; readonly value: ValidatedCardEdit }
  | { readonly ok: false; readonly issues: readonly CardEditIssue[] };

function validateText(
  value: unknown,
  path: string,
  required: boolean,
  issues: CardEditIssue[],
): string | null {
  if (value === undefined || value === null) {
    if (required) {
      issues.push({
        path,
        messageKey:
          value === undefined ? "error.field.required" : "error.field.string",
      });
    }
    return null;
  }
  if (typeof value !== "string") {
    issues.push({ path, messageKey: "error.field.string" });
    return null;
  }

  const normalized = normalizeText(value);
  if (required && normalized.trim().length === 0) {
    issues.push({ path, messageKey: "error.field.required" });
  }
  if (Array.from(normalized).length > MAX_TEXT_CODE_POINTS) {
    issues.push({ path, messageKey: "error.field.tooLong" });
  }
  if (containsMarkup(normalized)) {
    issues.push({ path, messageKey: "import.markupNotAllowed" });
  }
  return normalized;
}

export function validateCardEdit(
  itemId: string,
  input: unknown,
): CardEditValidation {
  const issues: CardEditIssue[] = [];
  if (!Array.isArray(input) || input.length === 0) {
    return {
      ok: false,
      issues: [
        {
          path: "presentations[0]",
          messageKey: "error.field.required",
        },
      ],
    };
  }

  const presentations: CardEditPresentation[] = [];
  input.forEach((candidate, index) => {
    const path = `presentations[${index}]`;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    ) {
      issues.push({ path, messageKey: "error.field.object" });
      return;
    }
    const record = candidate as Record<string, unknown>;
    const id = record["id"];
    if (id !== undefined && (typeof id !== "string" || id.length === 0)) {
      issues.push({ path: `${path}.id`, messageKey: "error.field.string" });
    }
    const front = validateText(
      record["front"],
      `${path}.front`,
      true,
      issues,
    );
    const back = validateText(
      record["back"],
      `${path}.back`,
      true,
      issues,
    );
    const rawNotes = validateText(
      record["notes"],
      `${path}.notes`,
      false,
      issues,
    );
    if (front !== null && back !== null) {
      presentations.push({
        ...(typeof id === "string" && id.length > 0 ? { id } : {}),
        front,
        back,
        notes:
          rawNotes === null || rawNotes.trim().length === 0
            ? null
            : rawNotes,
      });
    }
  });

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, value: { itemId, presentations } };
}
