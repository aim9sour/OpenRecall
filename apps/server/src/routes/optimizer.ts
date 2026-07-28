import {
  ApiErrorSchema,
  OptimizerEligibilitySchema,
  OptimizerRunSchema,
  OptimizerScopeQuerySchema,
  OptimizerScopeSchema,
  UuidSchema,
  type OptimizerScope,
  type OptimizerScopeQuery,
} from "@openrecall/contracts";
import type { SectionRepository } from "@openrecall/database";
import type { FastifyInstance, FastifyReply } from "fastify";
import { Type } from "typebox";
import {
  OptimizerEligibilityError,
  type OptimizerRunServiceApi,
} from "../optimizer/optimizer-run-service.js";

const RunParamsSchema = Type.Object(
  { runId: UuidSchema },
  { additionalProperties: false },
);

interface RunParams {
  readonly runId: string;
}

function scopeFromQuery(query: OptimizerScopeQuery): OptimizerScope | null {
  if (query.scopeType === "global" && query.sectionId === undefined) {
    return { scopeType: "global", sectionId: null };
  }
  if (query.scopeType === "section" && query.sectionId !== undefined) {
    return { scopeType: "section", sectionId: query.sectionId };
  }
  return null;
}

function optimizerError(reply: FastifyReply, error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (error instanceof OptimizerEligibilityError) {
    return reply.code(409).send({
      code,
      messageKey: "optimizer.insufficient",
    });
  }
  if (code === "OPTIMIZER_RUN_CONFLICT") {
    return reply.code(409).send({
      code,
      messageKey: "optimizer.runConflict",
    });
  }
  throw error;
}

export function registerOptimizerRoutes(
  server: FastifyInstance,
  options: {
    readonly optimizer: OptimizerRunServiceApi;
    readonly sections: SectionRepository;
    readonly nowMs: () => number;
  },
): void {
  const sectionExists = (
    scope: OptimizerScope,
    reply: FastifyReply,
  ): boolean => {
    if (
      scope.scopeType === "global" ||
      options.sections.getSection(
        scope.sectionId,
        options.nowMs(),
      ) !== undefined
    ) {
      return true;
    }
    void reply.code(404).send({
      code: "SECTION_NOT_FOUND",
      messageKey: "error.sectionNotFound",
    });
    return false;
  };

  server.get<{ Querystring: OptimizerScopeQuery }>(
    "/api/v1/optimizer/eligibility",
    {
      schema: {
        querystring: OptimizerScopeQuerySchema,
        response: {
          200: OptimizerEligibilitySchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const scope = scopeFromQuery(request.query);
      if (scope === null) {
        return reply.code(400).send({
          code: "OPTIMIZER_SCOPE_INVALID",
          messageKey: "error.validation",
        });
      }
      if (!sectionExists(scope, reply)) return;
      return reply.code(200).send(
        options.optimizer.getEligibility(scope),
      );
    },
  );

  server.post<{ Body: OptimizerScope }>(
    "/api/v1/optimizer/runs",
    {
      schema: {
        body: OptimizerScopeSchema,
        response: {
          202: OptimizerRunSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!sectionExists(request.body, reply)) return;
      try {
        return reply.code(202).send(
          options.optimizer.startRun(request.body),
        );
      } catch (error) {
        return optimizerError(reply, error);
      }
    },
  );

  server.get<{ Params: RunParams }>(
    "/api/v1/optimizer/runs/:runId",
    {
      schema: {
        params: RunParamsSchema,
        response: {
          200: OptimizerRunSchema,
          404: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const run = options.optimizer.getRun(request.params.runId);
      return run === null
        ? reply.code(404).send({
            code: "OPTIMIZER_RUN_NOT_FOUND",
            messageKey: "optimizer.runNotFound",
          })
        : reply.code(200).send(run);
    },
  );

  server.post<{ Params: RunParams }>(
    "/api/v1/optimizer/runs/:runId/cancel",
    {
      schema: {
        params: RunParamsSchema,
        response: {
          202: OptimizerRunSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const run = options.optimizer.getRun(request.params.runId);
      if (run === null) {
        return reply.code(404).send({
          code: "OPTIMIZER_RUN_NOT_FOUND",
          messageKey: "optimizer.runNotFound",
        });
      }
      if (!options.optimizer.cancelRun(request.params.runId)) {
        return reply.code(409).send({
          code: "OPTIMIZER_RUN_NOT_RUNNING",
          messageKey: "optimizer.runNotRunning",
        });
      }
      return reply.code(202).send(
        options.optimizer.getRun(request.params.runId) ?? run,
      );
    },
  );
}
