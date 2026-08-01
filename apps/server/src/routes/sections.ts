import {
  ApiErrorSchema,
  SectionCreateSchema,
  SectionConflictResponseSchema,
  SectionRenameSchema,
  SectionSchema,
  SectionSummarySchema,
  UuidSchema,
  type SectionCreate,
  type SectionRename,
} from "@openrecall/contracts";
import {
  SectionConflictError,
  SectionNameError,
  SectionNotFoundError,
  type SectionRepository,
} from "@openrecall/database";
import type { FastifyInstance } from "fastify";
import { Type } from "typebox";

const SectionParamsSchema = Type.Object(
  {
    sectionId: UuidSchema,
  },
  { additionalProperties: false },
);

interface SectionParams {
  readonly sectionId: string;
}

export function registerSectionRoutes(
  server: FastifyInstance,
  options: {
    readonly repository: SectionRepository;
    readonly nowMs: () => number;
  },
): void {
  server.get(
    "/api/v1/sections",
    {
      schema: {
        response: {
          200: Type.Array(SectionSummarySchema),
        },
      },
    },
    async () => options.repository.listSections(options.nowMs()),
  );

  server.post<{ Body: SectionCreate }>(
    "/api/v1/sections",
    {
      schema: {
        body: SectionCreateSchema,
        response: {
          201: SectionSchema,
          400: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const section = options.repository.createSection({
          name: request.body.name,
          nowMs: options.nowMs(),
        });
        return reply.code(201).send(section);
      } catch (error) {
        if (error instanceof SectionNameError) {
          return reply.code(400).send({
            code: "VALIDATION_ERROR",
            messageKey: "error.validation",
            fieldErrors: [
              { path: "/name", messageKey: "error.field.invalid" },
            ],
          });
        }
        throw error;
      }
    },
  );

  server.patch<{ Params: SectionParams; Body: SectionRename }>(
    "/api/v1/sections/:sectionId",
    {
      schema: {
        params: SectionParamsSchema,
        body: SectionRenameSchema,
        response: {
          200: SectionSummarySchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: SectionConflictResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const section = options.repository.renameSection({
          sectionId: request.params.sectionId,
          name: request.body.name,
          expectedUpdatedAtMs: request.body.expectedUpdatedAtMs,
          nowMs: options.nowMs(),
        });
        return reply.code(200).send(section);
      } catch (error) {
        if (error instanceof SectionNameError) {
          return reply.code(400).send({
            code: "VALIDATION_ERROR",
            messageKey: "error.validation",
            fieldErrors: [
              { path: "/name", messageKey: "error.field.invalid" },
            ],
          });
        }
        if (error instanceof SectionNotFoundError) {
          return reply.code(404).send({
            code: "SECTION_NOT_FOUND",
            messageKey: "error.sectionNotFound",
          });
        }
        if (error instanceof SectionConflictError) {
          return reply.code(409).send({
            code: "SECTION_CONFLICT",
            messageKey: "section.rename.conflict",
            current: error.current,
          });
        }
        throw error;
      }
    },
  );

  server.get<{ Params: SectionParams }>(
    "/api/v1/sections/:sectionId",
    {
      schema: {
        params: SectionParamsSchema,
        response: {
          200: SectionSummarySchema,
          404: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const section = options.repository.getSection(
        request.params.sectionId,
        options.nowMs(),
      );

      if (section === undefined) {
        return reply.code(404).send({
          code: "SECTION_NOT_FOUND",
          messageKey: "error.sectionNotFound",
        });
      }

      return reply.code(200).send(section);
    },
  );
}
