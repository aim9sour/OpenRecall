import { fastifySSE } from "@fastify/sse";
import type { FastifyInstance } from "fastify";
import type { ReviewEvents } from "../review/review-events.js";

export interface EventRouteOptions {
  readonly events: ReviewEvents;
  readonly heartbeatIntervalMs?: number | undefined;
  readonly publicOrigin: string;
}

export function registerEventRoutes(
  server: FastifyInstance,
  options: EventRouteOptions,
): void {
  void server.register(async (eventServer) => {
    await eventServer.register(fastifySSE, {
      heartbeatInterval: options.heartbeatIntervalMs ?? 30_000,
    });

    eventServer.get(
      "/api/v1/events",
      { sse: "only" },
      async (request, reply) => {
        if (
          request.headers.origin !== undefined &&
          request.headers.origin !== options.publicOrigin
        ) {
          return reply.code(403).send({
            code: "ORIGIN_NOT_ALLOWED",
            messageKey: "error.originNotAllowed",
          });
        }

        reply.sse.keepAlive();
        const unsubscribe = options.events.subscribe({
          send: (event) => reply.sse.send(event),
          close: () => reply.sse.close(),
        });
        reply.sse.onClose(unsubscribe);
        reply.sse.sendHeaders();
      },
    );
  });
}
