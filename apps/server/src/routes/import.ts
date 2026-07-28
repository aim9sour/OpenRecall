import { createHash } from "node:crypto";
import { ApiErrorSchema, UuidSchema } from "@openrecall/contracts";
import {
  CardImportRepository,
  type SectionRepository,
} from "@openrecall/database";
import {
  validateImportJson,
  type ValidatedImportPreview,
} from "@openrecall/domain";
import type { FastifyInstance } from "fastify";
import { Type } from "typebox";

const ParamsSchema = Type.Object(
  { sectionId: UuidSchema },
  { additionalProperties: false },
);
const PreviewBodySchema = Type.Object(
  {
    previewId: Type.String({ minLength: 1, maxLength: 200 }),
    content: Type.Unknown(),
  },
  { additionalProperties: false },
);
const CommitBodySchema = Type.Object(
  {
    previewId: Type.String({ minLength: 1, maxLength: 200 }),
    content: Type.Unknown(),
    digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    selectedIndexes: Type.Array(Type.Integer({ minimum: 0 }), {
      minItems: 1,
      maxItems: 10_000,
    }),
  },
  { additionalProperties: false },
);

interface Params {
  readonly sectionId: string;
}

interface PreviewBody {
  readonly previewId: string;
  readonly content: unknown;
}

interface CommitBody extends PreviewBody {
  readonly digest: string;
  readonly selectedIndexes: number[];
}

function digestPreview(
  previewId: string,
  preview: ValidatedImportPreview,
): string {
  const canonical = JSON.stringify({
    previewId,
    rows: preview.rows,
    acceptedItems: preview.acceptedItems,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function registerImportRoutes(
  server: FastifyInstance,
  options: {
    readonly cards: CardImportRepository;
    readonly sections: SectionRepository;
    readonly nowMs: () => number;
  },
): void {
  function validate(
    sectionId: string,
    content: unknown,
  ): ValidatedImportPreview | undefined {
    if (options.sections.getSection(sectionId, options.nowMs()) === undefined) {
      return undefined;
    }
    return validateImportJson(content, options.cards.getDuplicateKeys(sectionId));
  }

  server.post<{ Params: Params; Body: PreviewBody }>(
    "/api/v1/sections/:sectionId/import/preview",
    {
      schema: {
        params: ParamsSchema,
        body: PreviewBodySchema,
        response: { 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const preview = validate(
        request.params.sectionId,
        request.body.content,
      );
      if (preview === undefined) {
        return reply.code(404).send({
          code: "SECTION_NOT_FOUND",
          messageKey: "error.sectionNotFound",
        });
      }
      return reply.code(200).send({
        previewId: request.body.previewId,
        digest: digestPreview(request.body.previewId, preview),
        total: preview.total,
        valid: preview.valid,
        duplicate: preview.duplicate,
        invalid: preview.invalid,
        rows: preview.rows,
      });
    },
  );

  server.post<{ Params: Params; Body: CommitBody }>(
    "/api/v1/sections/:sectionId/import/commit",
    {
      schema: {
        params: ParamsSchema,
        body: CommitBodySchema,
        response: {
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const preview = validate(
        request.params.sectionId,
        request.body.content,
      );
      if (preview === undefined) {
        return reply.code(404).send({
          code: "SECTION_NOT_FOUND",
          messageKey: "error.sectionNotFound",
        });
      }
      if (
        digestPreview(request.body.previewId, preview) !== request.body.digest
      ) {
        return reply.code(409).send({
          code: "IMPORT_PREVIEW_STALE",
          messageKey: "import.previewStale",
        });
      }

      const selected = new Set(request.body.selectedIndexes);
      if (selected.size !== request.body.selectedIndexes.length) {
        return reply.code(400).send({
          code: "IMPORT_SELECTION_INVALID",
          messageKey: "import.selectionInvalid",
        });
      }
      const acceptedItems = preview.acceptedItems.filter((item) =>
        selected.has(item.sourceIndex),
      );
      if (
        acceptedItems.length !== selected.size ||
        acceptedItems.length === 0
      ) {
        return reply.code(400).send({
          code: "IMPORT_SELECTION_INVALID",
          messageKey: "import.selectionInvalid",
        });
      }

      const result = options.cards.commitImport(
        request.params.sectionId,
        acceptedItems,
        options.nowMs(),
      );
      return reply.code(201).send(result);
    },
  );
}
