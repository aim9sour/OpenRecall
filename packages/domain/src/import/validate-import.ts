import type {
  ImportPreview,
  ImportPreviewRow,
} from "@openrecall/contracts";
import { containsMarkup } from "./detect-markup.js";
import { duplicateKey, normalizeText } from "./normalize.js";

const MAX_DECODED_BYTES = 5 * 1_024 * 1_024;
const MAX_ITEMS = 10_000;
const MAX_TEXT_CODE_POINTS = 20_000;

export interface AcceptedPresentation {
  readonly front: string;
  readonly back: string;
  readonly notes: string | null;
}

export interface AcceptedImportItem extends AcceptedPresentation {
  readonly sourceIndex: number;
  readonly variants: readonly AcceptedPresentation[];
}

export interface ValidatedImportPreview extends ImportPreview {
  readonly acceptedItems: readonly AcceptedImportItem[];
}

export type DuplicateKeySet = ReadonlySet<string>;

interface ValidationMessage {
  readonly path: string;
  readonly messageKey: string;
}

interface MutableValidation {
  readonly issues: ValidationMessage[];
  readonly warnings: ValidationMessage[];
}

function invalidRoot(
  total: number,
  path: string,
  messageKey: string,
): ValidatedImportPreview {
  return {
    total,
    valid: 0,
    duplicate: 0,
    invalid: Math.max(total, 1),
    rows: [
      {
        index: 0,
        status: "invalid",
        issues: [{ path, messageKey }],
        warnings: [],
      },
    ],
    acceptedItems: [],
  };
}

function decodedSize(value: unknown): number | undefined {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined
      ? undefined
      : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  validation: MutableValidation,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      validation.warnings.push({
        path: `${path}.${key}`,
        messageKey: "import.unknownField",
      });
    }
  }
}

function validateText(
  value: unknown,
  path: string,
  validation: MutableValidation,
  required: boolean,
): string | null {
  if (value === undefined || value === null) {
    if (required) {
      validation.issues.push({
        path,
        messageKey:
          value === undefined ? "error.field.required" : "error.field.string",
      });
    }
    return null;
  }

  if (typeof value !== "string") {
    validation.issues.push({ path, messageKey: "error.field.string" });
    return null;
  }

  const normalized = normalizeText(value);
  if (required && normalized.trim().length === 0) {
    validation.issues.push({ path, messageKey: "error.field.required" });
  }
  if (Array.from(normalized).length > MAX_TEXT_CODE_POINTS) {
    validation.issues.push({ path, messageKey: "error.field.tooLong" });
  }
  if (containsMarkup(normalized)) {
    validation.issues.push({ path, messageKey: "import.markupNotAllowed" });
  }
  return normalized;
}

function validatePresentation(
  value: unknown,
  path: string,
  allowedFields: ReadonlySet<string>,
  validation: MutableValidation,
): AcceptedPresentation | undefined {
  if (!isRecord(value)) {
    validation.issues.push({ path, messageKey: "error.field.object" });
    return undefined;
  }

  collectUnknownFields(value, allowedFields, path, validation);
  const front = validateText(value["front"], `${path}.front`, validation, true);
  const back = validateText(value["back"], `${path}.back`, validation, true);
  const notes = validateText(
    value["notes"],
    `${path}.notes`,
    validation,
    false,
  );

  return front === null || back === null
    ? undefined
    : { front, back, notes };
}

function validateItem(
  value: unknown,
  index: number,
  seen: Set<string>,
): {
  readonly row: ImportPreviewRow;
  readonly accepted?: AcceptedImportItem;
} {
  const path = `cards[${index}]`;
  const validation: MutableValidation = { issues: [], warnings: [] };
  const primary = validatePresentation(
    value,
    path,
    new Set(["front", "back", "notes", "variants"]),
    validation,
  );
  const variants: AcceptedPresentation[] = [];

  if (isRecord(value) && value["variants"] !== undefined) {
    if (!Array.isArray(value["variants"])) {
      validation.issues.push({
        path: `${path}.variants`,
        messageKey: "error.field.array",
      });
    } else {
      value["variants"].forEach((variant, variantIndex) => {
        const accepted = validatePresentation(
          variant,
          `${path}.variants[${variantIndex}]`,
          new Set(["front", "back", "notes"]),
          validation,
        );
        if (accepted !== undefined) {
          variants.push(accepted);
        }
      });
    }
  }

  if (validation.issues.length > 0 || primary === undefined) {
    return {
      row: {
        index,
        status: "invalid",
        issues: validation.issues,
        warnings: validation.warnings,
      },
    };
  }

  const key = duplicateKey(primary.front, primary.back);
  if (seen.has(key)) {
    validation.warnings.push({
      path,
      messageKey: "import.duplicate",
    });
    return {
      row: {
        index,
        status: "duplicate",
        issues: [],
        warnings: validation.warnings,
      },
    };
  }

  seen.add(key);
  return {
    row: {
      index,
      status: "valid",
      issues: [],
      warnings: validation.warnings,
    },
    accepted: {
      sourceIndex: index,
      ...primary,
      variants,
    },
  };
}

export function validateImportJson(
  value: unknown,
  existing: DuplicateKeySet,
): ValidatedImportPreview {
  const size = decodedSize(value);
  if (size === undefined) {
    return invalidRoot(1, "cards", "import.invalidJsonValue");
  }
  if (size > MAX_DECODED_BYTES) {
    return invalidRoot(1, "cards", "import.fileTooLarge");
  }

  const values = Array.isArray(value) ? value : [value];
  if (values.length > MAX_ITEMS) {
    return invalidRoot(values.length, "cards", "import.tooManyItems");
  }

  const seen = new Set(existing);
  const rows: ImportPreviewRow[] = [];
  const acceptedItems: AcceptedImportItem[] = [];

  values.forEach((item, index) => {
    const result = validateItem(item, index, seen);
    rows.push(result.row);
    if (result.accepted !== undefined) {
      acceptedItems.push(result.accepted);
    }
  });

  return {
    total: rows.length,
    valid: rows.filter((row) => row.status === "valid").length,
    duplicate: rows.filter((row) => row.status === "duplicate").length,
    invalid: rows.filter((row) => row.status === "invalid").length,
    rows,
    acceptedItems,
  };
}
