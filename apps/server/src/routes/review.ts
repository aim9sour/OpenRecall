import {
  ApiErrorSchema,
  OpenSessionConflictSchema,
  ReviewPageStateSchema,
  ReviewRateSchema,
  ReviewRevealSchema,
  ReviewSessionCreateSchema,
  ReviewSessionParamsSchema,
  ReviewShownSchema,
  type ReviewPageState,
  type ReviewRate,
  type ReviewReveal,
  type ReviewSessionCreate,
  type ReviewSessionParams,
  type ReviewShown,
} from "@openrecall/contracts";
import {
  OpenReviewSessionError,
  type RatingTransaction,
  type ReviewQueueRepository,
  type ReviewSessionRepository,
} from "@openrecall/database";
import type { ReviewSessionSnapshot } from "@openrecall/domain";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { DueWakeService } from "../review/due-wake-service.js";
import type { ReviewEvents } from "../review/review-events.js";

interface ReviewRouteOptions {
  readonly events: ReviewEvents;
  readonly nowMs: () => number;
  readonly queue: ReviewQueueRepository;
  readonly ratings: RatingTransaction;
  readonly sessions: ReviewSessionRepository;
  readonly wake: Pick<DueWakeService, "rearm">;
}

function safeCard(card: {
  readonly entryId: string;
  readonly learningItemId: string;
  readonly presentationId: string;
  readonly front: string;
  readonly stateRevision: number;
}) {
  return {
    entryId: card.entryId,
    learningItemId: card.learningItemId,
    presentationId: card.presentationId,
    front: card.front,
    stateRevision: card.stateRevision,
  };
}

function sendReviewError(reply: FastifyReply, error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (
    code === "REVIEW_SESSION_NOT_FOUND" ||
    code === "REVIEW_SECTION_NOT_FOUND"
  ) {
    return reply.code(404).send({
      code,
      messageKey:
        code === "REVIEW_SECTION_NOT_FOUND"
          ? "error.sectionNotFound"
          : "review.sessionNotFound",
    });
  }
  if (
    code === "REVIEW_APPEARANCE_MISMATCH" ||
    code === "REVIEW_CARD_NOT_SHOWN" ||
    code === "REVIEW_CARD_NOT_REVEALED" ||
    code === "STALE_SCHEDULER_STATE" ||
    code === "REVIEW_SESSION_COMPLETED" ||
    code === "REVIEW_SESSION_NOT_ACTIVE"
  ) {
    return reply.code(409).send({
      code,
      messageKey: "review.stateConflict",
    });
  }
  throw error;
}

export function registerReviewRoutes(
  server: FastifyInstance,
  options: ReviewRouteOptions,
): void {
  const pageState = (
    sessionId: string,
    nowMs: number,
    newlyJoined = 0,
  ): ReviewPageState | undefined => {
    const session = options.queue.getSessionSnapshot(
      sessionId,
      nowMs,
      newlyJoined,
    );
    if (session === undefined) {
      return undefined;
    }
    if (session.status === "completed") {
      const summary = options.queue.getSessionSummary(sessionId);
      return summary === undefined
        ? undefined
        : { kind: "completed", summary };
    }

    const current = options.sessions.getCurrent(sessionId);
    if (current === null) {
      return {
        kind: "waiting",
        nextDueAtMs: session.nextDueAtMs,
        session,
      };
    }
    const card = safeCard(current);
    if (current.kind === "question") {
      return { kind: "question", card, session };
    }
    return {
      kind: "answer",
      card: {
        ...card,
        back: current.back,
        notes: current.notes,
      },
      outcomes: options.ratings.previewRatings(
        sessionId,
        current.entryId,
        nowMs,
      ),
      session,
    };
  };

  const publish = (snapshot: ReviewSessionSnapshot): void => {
    options.events.publish({
      event: "review-invalidated",
      data: {
        sessionId: snapshot.id,
        revision: snapshot.revision,
      },
    });
  };

  server.post<{ Body: ReviewSessionCreate }>(
    "/api/v1/review-sessions",
    {
      schema: {
        body: ReviewSessionCreateSchema,
        response: {
          201: ReviewPageStateSchema,
          404: ApiErrorSchema,
          409: OpenSessionConflictSchema,
        },
      },
    },
    async (request, reply) => {
      const nowMs = options.nowMs();
      try {
        const snapshot = options.queue.startOrResumeSession(
          request.body.sectionId,
          nowMs,
        );
        options.sessions.claimNext(snapshot.id, nowMs);
        options.wake.rearm();
        publish(snapshot);
        const state = pageState(snapshot.id, nowMs, snapshot.newlyJoined);
        if (state === undefined) {
          throw new Error("REVIEW_SESSION_NOT_FOUND");
        }
        return reply.code(201).send(state);
      } catch (error) {
        if (error instanceof OpenReviewSessionError) {
          return reply.code(409).send({
            code: "OPEN_REVIEW_SESSION_EXISTS",
            messageKey: "review.openSessionExists",
            sessionId: error.sessionId,
            sectionId: error.sectionId,
          });
        }
        return sendReviewError(reply, error);
      }
    },
  );

  server.get<{ Params: ReviewSessionParams }>(
    "/api/v1/review-sessions/:id",
    {
      schema: {
        params: ReviewSessionParamsSchema,
        response: {
          200: ReviewPageStateSchema,
          404: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const state = pageState(request.params.id, options.nowMs());
      return state === undefined
        ? reply.code(404).send({
            code: "REVIEW_SESSION_NOT_FOUND",
            messageKey: "review.sessionNotFound",
          })
        : reply.code(200).send(state);
    },
  );

  server.post<{ Params: ReviewSessionParams }>(
    "/api/v1/review-sessions/:id/next",
    {
      schema: {
        params: ReviewSessionParamsSchema,
        response: {
          200: ReviewPageStateSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const nowMs = options.nowMs();
      try {
        const before = options.queue.getSessionSnapshot(
          request.params.id,
          nowMs,
        );
        if (before === undefined) {
          throw new Error("REVIEW_SESSION_NOT_FOUND");
        }
        if (before.status === "paused") {
          throw new Error("REVIEW_SESSION_NOT_ACTIVE");
        }
        const merged = options.queue.mergeDueItems(request.params.id, nowMs);
        options.sessions.claimNext(request.params.id, nowMs);
        options.wake.rearm();
        const snapshot = options.queue.getSessionSnapshot(
          request.params.id,
          nowMs,
          merged.added,
        );
        if (snapshot === undefined) {
          throw new Error("REVIEW_SESSION_NOT_FOUND");
        }
        publish(snapshot);
        const state = pageState(request.params.id, nowMs, merged.added);
        if (state === undefined) {
          throw new Error("REVIEW_SESSION_NOT_FOUND");
        }
        return reply.code(200).send(state);
      } catch (error) {
        return sendReviewError(reply, error);
      }
    },
  );

  server.post<{
    Params: ReviewSessionParams;
    Body: ReviewShown;
  }>(
    "/api/v1/review-sessions/:id/current/shown",
    {
      schema: {
        params: ReviewSessionParamsSchema,
        body: ReviewShownSchema,
        response: {
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        options.ratings.markShown(
          request.params.id,
          request.body.entryId,
          request.body.presentationId,
          options.nowMs(),
        );
        return reply.code(204).send();
      } catch (error) {
        return sendReviewError(reply, error);
      }
    },
  );

  server.post<{
    Params: ReviewSessionParams;
    Body: ReviewReveal;
  }>(
    "/api/v1/review-sessions/:id/current/reveal",
    {
      schema: {
        params: ReviewSessionParamsSchema,
        body: ReviewRevealSchema,
        response: {
          200: ReviewPageStateSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const nowMs = options.nowMs();
      try {
        options.ratings.markRevealed(
          request.params.id,
          request.body.entryId,
          nowMs,
        );
        const state = pageState(request.params.id, nowMs);
        if (state === undefined) {
          throw new Error("REVIEW_SESSION_NOT_FOUND");
        }
        return reply.code(200).send(state);
      } catch (error) {
        return sendReviewError(reply, error);
      }
    },
  );

  server.post<{
    Params: ReviewSessionParams;
    Body: ReviewRate;
  }>(
    "/api/v1/review-sessions/:id/current/rate",
    {
      schema: {
        params: ReviewSessionParamsSchema,
        body: ReviewRateSchema,
        response: {
          200: ReviewPageStateSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const nowMs = options.nowMs();
      try {
        const result = options.ratings.rate({
          sessionId: request.params.id,
          entryId: request.body.entryId,
          learningItemId: request.body.learningItemId,
          rating: request.body.rating,
          expectedStateRevision: request.body.expectedStateRevision,
          idempotencyKey: request.body.idempotencyKey,
          nowMs,
        });
        options.sessions.claimNext(request.params.id, nowMs);
        options.wake.rearm();
        const snapshot = options.queue.getSessionSnapshot(
          request.params.id,
          nowMs,
          result.newlyJoined,
        );
        if (snapshot === undefined) {
          throw new Error("REVIEW_SESSION_NOT_FOUND");
        }
        publish(snapshot);
        const state = pageState(
          request.params.id,
          nowMs,
          result.newlyJoined,
        );
        if (state === undefined) {
          throw new Error("REVIEW_SESSION_NOT_FOUND");
        }
        return reply.code(200).send(state);
      } catch (error) {
        return sendReviewError(reply, error);
      }
    },
  );

  for (const action of ["pause", "resume"] as const) {
    server.post<{ Params: ReviewSessionParams }>(
      `/api/v1/review-sessions/:id/${action}`,
      {
        schema: {
          params: ReviewSessionParamsSchema,
          response: {
            200: ReviewPageStateSchema,
            404: ApiErrorSchema,
            409: ApiErrorSchema,
          },
        },
      },
      async (request, reply) => {
        const nowMs = options.nowMs();
        try {
          const snapshot =
            action === "pause"
              ? options.queue.pauseSession(request.params.id, nowMs)
              : options.queue.resumeSession(request.params.id, nowMs);
          options.wake.rearm();
          publish(snapshot);
          const state = pageState(
            request.params.id,
            nowMs,
            snapshot.newlyJoined,
          );
          if (state === undefined) {
            throw new Error("REVIEW_SESSION_NOT_FOUND");
          }
          return reply.code(200).send(state);
        } catch (error) {
          return sendReviewError(reply, error);
        }
      },
    );
  }

  server.post<{ Params: ReviewSessionParams }>(
    "/api/v1/review-sessions/:id/finish",
    {
      schema: {
        params: ReviewSessionParamsSchema,
        response: {
          200: ReviewPageStateSchema,
          404: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const nowMs = options.nowMs();
      try {
        const summary = options.queue.finishSession(
          request.params.id,
          nowMs,
        );
        options.wake.rearm();
        const snapshot = options.queue.getSessionSnapshot(
          request.params.id,
          nowMs,
        );
        if (snapshot !== undefined) {
          publish(snapshot);
        }
        return reply.code(200).send({ kind: "completed", summary });
      } catch (error) {
        return sendReviewError(reply, error);
      }
    },
  );
}
