import {
  ApiErrorSchema,
  SectionCreateSchema,
  SectionConflictResponseSchema,
  SectionDeleteSchema,
  SectionRenameSchema,
  SectionSchema,
  SectionSummarySchema,
  UuidSchema,
  type SectionCreate,
  type SectionDelete,
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
import type { OptimizerRunServiceApi } from "../optimizer/optimizer-run-service.js";
import type { DueWakeService } from "../review/due-wake-service.js";
import type { ReviewEvents } from "../review/review-events.js";

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
    readonly events: Pick<ReviewEvents, "publish">;
    readonly optimizer: Pick<
      OptimizerRunServiceApi,
      "quiesceForSectionDeletion"
    >;
    readonly wake: Pick<DueWakeService, "rearm">;
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

  server.delete<{ Params: SectionParams; Body: SectionDelete }>(
    "/api/v1/sections/:sectionId",
    {
      schema: {
        params: SectionParamsSchema,
        body: SectionDeleteSchema,
        response: {
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: SectionConflictResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.body.confirmed !== true) {
        return reply.code(400).send({
          code: "SECTION_DELETE_CONFIRMATION_REQUIRED",
          messageKey: "section.delete.confirmationRequired",
        });
      }

      let releaseGate: (() => void) | undefined;
      try {
        releaseGate = await options.optimizer.quiesceForSectionDeletion(
          request.params.sectionId,
        );
        options.repository.deleteSection({
          sectionId: request.params.sectionId,
          expectedUpdatedAtMs: request.body.expectedUpdatedAtMs,
        });

        let rearmFailed = false;
        let rearmError: unknown;
        try {
          options.wake.rearm();
        } catch (error) {
          rearmFailed = true;
          rearmError = error;
        }

        let publishFailed = false;
        let publishError: unknown;
        try {
          options.events.publish({
            event: "section-deleted",
            data: { sectionId: request.params.sectionId },
          });
        } catch (error) {
          publishFailed = true;
          publishError = error;
        }

        if (rearmFailed) throw rearmError;
        if (publishFailed) throw publishError;
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof SectionNotFoundError) {
          return reply.code(404).send({
            code: "SECTION_NOT_FOUND",
            messageKey: "error.sectionNotFound",
          });
        }
        if (error instanceof SectionConflictError) {
          return reply.code(409).send({
            code: "SECTION_CONFLICT",
            messageKey: "section.delete.conflict",
            current: error.current,
          });
        }
        throw error;
      } finally {
        releaseGate?.();
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
