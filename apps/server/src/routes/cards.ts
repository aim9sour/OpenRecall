import {
  ApiErrorSchema,
  CardEditSchema,
  CardItemParamsSchema,
  CardLifecycleMutationSchema,
  CardListQuerySchema,
  CardPageSchema,
  CardSchema,
  PermanentDeleteSchema,
  UuidSchema,
  type CardEdit,
  type CardItemParams,
  type CardLifecycleMutation,
  type CardListQuery,
  type PermanentDelete,
} from "@openrecall/contracts";
import type {
  CardRepository,
  SectionRepository,
} from "@openrecall/database";
import { validateCardEdit } from "@openrecall/domain";
import type { FastifyInstance, FastifyReply } from "fastify";
import { Type } from "typebox";

const SectionParamsSchema = Type.Object(
  { sectionId: UuidSchema },
  { additionalProperties: false },
);

interface SectionParams {
  readonly sectionId: string;
}

function sendCardError(reply: FastifyReply, error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "CARD_NOT_FOUND") {
    return reply.code(404).send({
      code,
      messageKey: "card.notFound",
    });
  }
  if (
    code === "CARD_EDIT_CONFLICT" ||
    code === "PERMANENT_DELETE_CONFIRMATION_MISMATCH"
  ) {
    return reply.code(409).send({
      code,
      messageKey:
        code === "CARD_EDIT_CONFLICT"
          ? "card.editConflict"
          : "card.deleteConfirmationMismatch",
    });
  }
  if (
    code === "CARD_CURSOR_INVALID" ||
    code === "CARD_PAGE_LIMIT_INVALID" ||
    code === "CARD_PRIMARY_REQUIRED" ||
    code === "CARD_PRESENTATION_DUPLICATE" ||
    code === "CARD_PRESENTATION_MISMATCH"
  ) {
    return reply.code(400).send({
      code,
      messageKey: "error.validation",
    });
  }
  throw error;
}

export function registerCardRoutes(
  server: FastifyInstance,
  options: {
    readonly cards: CardRepository;
    readonly sections: SectionRepository;
    readonly nowMs: () => number;
  },
): void {
  server.get<{ Params: SectionParams; Querystring: CardListQuery }>(
    "/api/v1/sections/:sectionId/cards",
    {
      schema: {
        params: SectionParamsSchema,
        querystring: CardListQuerySchema,
        response: {
          200: CardPageSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (
        options.sections.getSection(
          request.params.sectionId,
          options.nowMs(),
        ) === undefined
      ) {
        return reply.code(404).send({
          code: "SECTION_NOT_FOUND",
          messageKey: "error.sectionNotFound",
        });
      }
      try {
        return reply.code(200).send(
          options.cards.listCards({
            sectionId: request.params.sectionId,
            cursor: request.query.cursor ?? null,
            query: request.query.query ?? "",
            lifecycle: request.query.lifecycle ?? "active",
            limit: request.query.limit ?? 25,
          }),
        );
      } catch (error) {
        return sendCardError(reply, error);
      }
    },
  );

  server.get<{ Params: CardItemParams }>(
    "/api/v1/cards/:itemId",
    {
      schema: {
        params: CardItemParamsSchema,
        response: { 200: CardSchema, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const card = options.cards.getCard(request.params.itemId);
      return card === null
        ? reply.code(404).send({
            code: "CARD_NOT_FOUND",
            messageKey: "card.notFound",
          })
        : reply.code(200).send(card);
    },
  );

  server.put<{ Params: CardItemParams; Body: CardEdit }>(
    "/api/v1/cards/:itemId",
    {
      schema: {
        params: CardItemParamsSchema,
        body: CardEditSchema,
        response: {
          200: CardSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const validated = validateCardEdit(
        request.params.itemId,
        request.body.presentations,
      );
      if (!validated.ok) {
        return reply.code(400).send({
          code: "VALIDATION_ERROR",
          messageKey: "error.validation",
          fieldErrors: validated.issues,
        });
      }
      try {
        return reply.code(200).send(
          options.cards.updateLearningItem({
            itemId: request.params.itemId,
            expectedUpdatedAtMs: request.body.expectedUpdatedAtMs,
            presentations: validated.value.presentations,
            nowMs: options.nowMs(),
          }),
        );
      } catch (error) {
        return sendCardError(reply, error);
      }
    },
  );

  const lifecycleRoute = (
    action: "trash" | "restore",
  ): void => {
    server.post<{
      Params: CardItemParams;
      Body: CardLifecycleMutation;
    }>(
      `/api/v1/cards/:itemId/${action}`,
      {
        schema: {
          params: CardItemParamsSchema,
          body: CardLifecycleMutationSchema,
          response: {
            200: CardSchema,
            404: ApiErrorSchema,
            409: ApiErrorSchema,
          },
        },
      },
      async (request, reply) => {
        try {
          const input = {
            itemId: request.params.itemId,
            expectedUpdatedAtMs: request.body.expectedUpdatedAtMs,
            nowMs: options.nowMs(),
          };
          const card =
            action === "trash"
              ? options.cards.trashItem(input)
              : options.cards.restoreItem(input);
          return reply.code(200).send(card);
        } catch (error) {
          return sendCardError(reply, error);
        }
      },
    );
  };
  lifecycleRoute("trash");
  lifecycleRoute("restore");

  server.delete<{ Params: CardItemParams; Body: PermanentDelete }>(
    "/api/v1/cards/:itemId/permanent",
    {
      schema: {
        params: CardItemParamsSchema,
        body: PermanentDeleteSchema,
        response: {
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        options.cards.permanentlyDeleteItem({
          itemId: request.params.itemId,
          confirmationItemId: request.body.confirmationItemId,
          expectedUpdatedAtMs: request.body.expectedUpdatedAtMs,
        });
        return reply.code(204).send();
      } catch (error) {
        return sendCardError(reply, error);
      }
    },
  );
}
