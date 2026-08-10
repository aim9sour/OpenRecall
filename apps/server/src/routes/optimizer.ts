import {
  ApiErrorSchema,
  OptimizerProfileApplicationSchema,
  OptimizerProfileApplySchema,
  OptimizerProfileListSchema,
  OptimizerProfilePreviewSchema,
  OptimizerEligibilitySchema,
  OptimizerRunSchema,
  OptimizerScopeQuerySchema,
  OptimizerScopeSchema,
  OptimizerTrainingPreflightRequestSchema,
  OptimizerTrainingPreflightSchema,
  StepRecommendationApplySchema,
  StepRecommendationRestoreSchema,
  StepRecommendationRunSchema,
  StepRecommendationStartSchema,
  UuidSchema,
  type OptimizerScope,
  type OptimizerScopeQuery,
  type OptimizerProfileApply,
  type OptimizerTrainingPreflightRequest,
  type StepRecommendationApply,
  type StepRecommendationRestore,
  type StepRecommendationStart,
} from "@openrecall/contracts";
import type { SectionRepository } from "@openrecall/database";
import type { FastifyInstance, FastifyReply } from "fastify";
import { Type } from "typebox";
import {
  OptimizerEligibilityError,
  type OptimizerRunServiceApi,
} from "../optimizer/optimizer-run-service.js";
import type { ProfileApplicationServiceApi } from "../optimizer/profile-application-service.js";
import type { StepRecommendationServiceApi } from "../optimizer/step-recommendation-service.js";

const RunParamsSchema = Type.Object(
  { runId: UuidSchema },
  { additionalProperties: false },
);

interface RunParams {
  readonly runId: string;
}

const ProfileParamsSchema = Type.Object(
  {
    profileId: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

interface ProfileParams {
  readonly profileId: string;
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
  if (
    code === "OPTIMIZER_RUN_CONFLICT" ||
    code === "OPTIMIZER_SECTION_DELETION_IN_PROGRESS"
  ) {
    return reply.code(409).send({
      code,
      messageKey: "optimizer.runConflict",
    });
  }
  throw error;
}

function profileError(reply: FastifyReply, error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "PROFILE_NOT_APPLICABLE") {
    return reply.code(404).send({
      code,
      messageKey: "optimizer.profileNotFound",
    });
  }
  if (
    code === "PROFILE_APPLICATION_STALE" ||
    code === "PROFILE_APPLICATION_BUSY"
  ) {
    return reply.code(409).send({
      code,
      messageKey:
        code === "PROFILE_APPLICATION_STALE"
          ? "optimizer.profileStale"
          : "optimizer.profileBusy",
    });
  }
  throw error;
}

function stepRecommendationError(
  reply: FastifyReply,
  error: unknown,
) {
  const code = error instanceof Error ? error.message : "";
  if (
    code === "STEP_RECOMMENDATION_NOT_FOUND" ||
    code === "STEP_RECOMMENDATION_SECTION_NOT_FOUND"
  ) {
    return reply.code(404).send({
      code,
      messageKey:
        code === "STEP_RECOMMENDATION_NOT_FOUND"
          ? "optimizer.steps.runNotFound"
          : "error.sectionNotFound",
    });
  }
  if (code === "STEP_RECOMMENDATION_INPUT_INVALID") {
    return reply.code(400).send({
      code,
      messageKey: "error.validation",
    });
  }
  const messageKeyByCode = {
    STEP_RECOMMENDATION_STALE: "optimizer.steps.stale",
    STEP_RECOMMENDATION_NOT_APPLICABLE:
      "optimizer.steps.notApplicable",
    STEP_RECOMMENDATION_RESTORE_STALE:
      "optimizer.steps.restoreStale",
    STEP_RECOMMENDATION_CONFLICT: "optimizer.steps.conflict",
    OPTIMIZER_RUN_CONFLICT: "optimizer.runConflict",
    OPTIMIZER_SECTION_DELETION_IN_PROGRESS:
      "optimizer.runConflict",
  } as const;
  if (code in messageKeyByCode) {
    return reply.code(409).send({
      code,
      messageKey:
        messageKeyByCode[code as keyof typeof messageKeyByCode],
    });
  }
  throw error;
}

export function registerOptimizerRoutes(
  server: FastifyInstance,
  options: {
    readonly optimizer: OptimizerRunServiceApi;
    readonly steps: StepRecommendationServiceApi;
    readonly profiles: ProfileApplicationServiceApi;
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

  server.post<{ Body: OptimizerTrainingPreflightRequest }>(
    "/api/v1/optimizer/preflight",
    {
      schema: {
        body: OptimizerTrainingPreflightRequestSchema,
        response: {
          200: OptimizerTrainingPreflightSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!sectionExists(request.body.scope, reply)) return;
      if (options.optimizer.preflight === undefined) {
        throw new Error("OPTIMIZER_PREFLIGHT_UNAVAILABLE");
      }
      return reply.code(200).send(
        options.optimizer.preflight(request.body.scope, request.body.settings),
      );
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

  server.post<{ Body: StepRecommendationStart }>(
    "/api/v1/optimizer/step-recommendations",
    {
      schema: {
        body: StepRecommendationStartSchema,
        response: {
          202: StepRecommendationRunSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!sectionExists(request.body.scope, reply)) return;
      try {
        return reply.code(202).send(
          options.steps.start(request.body.scope),
        );
      } catch (error) {
        return stepRecommendationError(reply, error);
      }
    },
  );

  server.get<{ Params: RunParams }>(
    "/api/v1/optimizer/step-recommendations/:runId",
    {
      schema: {
        params: RunParamsSchema,
        response: {
          200: StepRecommendationRunSchema,
          404: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const run = options.steps.get(request.params.runId);
      return run === null
        ? reply.code(404).send({
            code: "STEP_RECOMMENDATION_NOT_FOUND",
            messageKey: "optimizer.steps.runNotFound",
          })
        : reply.code(200).send(run);
    },
  );

  server.post<{ Params: RunParams }>(
    "/api/v1/optimizer/step-recommendations/:runId/cancel",
    {
      schema: {
        params: RunParamsSchema,
        response: {
          202: StepRecommendationRunSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const run = options.steps.get(request.params.runId);
      if (run === null) {
        return reply.code(404).send({
          code: "STEP_RECOMMENDATION_NOT_FOUND",
          messageKey: "optimizer.steps.runNotFound",
        });
      }
      if (!options.steps.cancel(request.params.runId)) {
        return reply.code(409).send({
          code: "STEP_RECOMMENDATION_NOT_RUNNING",
          messageKey: "optimizer.steps.notRunning",
        });
      }
      return reply.code(202).send(
        options.steps.get(request.params.runId) ?? run,
      );
    },
  );

  server.post<{
    Params: RunParams;
    Body: StepRecommendationApply;
  }>(
    "/api/v1/optimizer/step-recommendations/:runId/apply",
    {
      schema: {
        params: RunParamsSchema,
        body: StepRecommendationApplySchema,
        response: {
          200: StepRecommendationRunSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(200).send(
          await options.steps.apply(request.params.runId, request.body),
        );
      } catch (error) {
        return stepRecommendationError(reply, error);
      }
    },
  );

  server.post<{
    Params: RunParams;
    Body: StepRecommendationRestore;
  }>(
    "/api/v1/optimizer/step-recommendations/:runId/restore",
    {
      schema: {
        params: RunParamsSchema,
        body: StepRecommendationRestoreSchema,
        response: {
          200: StepRecommendationRunSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(200).send(
          await options.steps.restore(request.params.runId, request.body),
        );
      } catch (error) {
        return stepRecommendationError(reply, error);
      }
    },
  );

  server.get(
    "/api/v1/optimizer/profiles",
    {
      schema: {
        response: {
          200: OptimizerProfileListSchema,
        },
      },
    },
    async (_request, reply) =>
      reply.code(200).send(options.profiles.listProfiles()),
  );

  server.post<{ Params: ProfileParams }>(
    "/api/v1/optimizer/profiles/:profileId/preview",
    {
      schema: {
        params: ProfileParamsSchema,
        response: {
          200: OptimizerProfilePreviewSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(200).send(
          options.profiles.preview(request.params.profileId),
        );
      } catch (error) {
        return profileError(reply, error);
      }
    },
  );

  server.post<{
    Params: ProfileParams;
    Body: OptimizerProfileApply;
  }>(
    "/api/v1/optimizer/profiles/:profileId/apply",
    {
      schema: {
        params: ProfileParamsSchema,
        body: OptimizerProfileApplySchema,
        response: {
          200: OptimizerProfileApplicationSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(200).send(
          await options.profiles.apply(
            request.params.profileId,
            request.body.revisionToken,
          ),
        );
      } catch (error) {
        return profileError(reply, error);
      }
    },
  );

  server.post<{
    Params: ProfileParams;
    Body: OptimizerProfileApply;
  }>(
    "/api/v1/optimizer/profiles/:profileId/rollback",
    {
      schema: {
        params: ProfileParamsSchema,
        body: OptimizerProfileApplySchema,
        response: {
          200: OptimizerProfileApplicationSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(200).send(
          await options.profiles.rollback(
            request.params.profileId,
            request.body.revisionToken,
          ),
        );
      } catch (error) {
        return profileError(reply, error);
      }
    },
  );
}
