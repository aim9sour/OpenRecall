import { randomBytes } from "node:crypto";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  CardImportRepository,
  ReviewQueueRepository,
  SectionRepository,
} from "@openrecall/database";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  LogController,
} from "fastify";
import { loadConfig, type ServerConfig } from "./config.js";
import { DueWakeService } from "./review/due-wake-service.js";
import { ReviewEvents } from "./review/review-events.js";
import { registerBootstrapRoute } from "./routes/bootstrap.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerImportRoutes } from "./routes/import.js";
import { registerSectionRoutes } from "./routes/sections.js";
import { registerSecurity } from "./security.js";

const PROCESS_CSRF_TOKEN = randomBytes(32).toString("base64url");

export interface BuildServerOptions {
  readonly config?: ServerConfig;
  readonly database?: ConstructorParameters<typeof SectionRepository>[0];
  readonly nowMs?: () => number;
  readonly reviewEvents?: ReviewEvents;
  readonly sseHeartbeatIntervalMs?: number;
}

function validationPath(error: {
  readonly instancePath?: string;
  readonly params?: Record<string, unknown>;
}): string {
  if (error.instancePath !== undefined && error.instancePath !== "") {
    return error.instancePath;
  }

  const missingProperty = error.params?.["missingProperty"];
  return typeof missingProperty === "string" ? `/${missingProperty}` : "/";
}

function registerErrorHandler(server: FastifyInstance): void {
  server.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({
      code: "NOT_FOUND",
      messageKey: "error.notFound",
    }),
  );

  server.setErrorHandler((error: FastifyError, _request, reply) => {
    if (Array.isArray(error.validation)) {
      return reply.code(400).send({
        code: "VALIDATION_ERROR",
        messageKey: "error.validation",
        fieldErrors: error.validation.map((validationError) => ({
          path: validationPath(validationError),
          messageKey: "error.field.invalid",
        })),
      });
    }

    const statusCode =
      error.statusCode !== undefined &&
      error.statusCode >= 400 &&
      error.statusCode < 500
        ? error.statusCode
        : 500;

    return reply.code(statusCode).send({
      code: statusCode === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
      messageKey:
        statusCode === 404 ? "error.notFound" : "error.internal",
    });
  });
}

export async function buildServer(
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const server = Fastify({
    bodyLimit: 5 * 1_024 * 1_024,
    logController: new LogController({ disableRequestLogging: true }),
    logger: false,
  }).withTypeProvider<TypeBoxTypeProvider>();
  const reviewEvents = options.reviewEvents ?? new ReviewEvents();

  registerSecurity(server, config, PROCESS_CSRF_TOKEN);
  registerErrorHandler(server);
  registerEventRoutes(server, {
    events: reviewEvents,
    heartbeatIntervalMs: options.sseHeartbeatIntervalMs,
    publicOrigin: config.publicOrigin,
  });
  registerBootstrapRoute(server, {
    csrfToken: PROCESS_CSRF_TOKEN,
    locale: config.locale,
  });
  if (options.database !== undefined) {
    const repository = new SectionRepository(options.database);
    const queue = new ReviewQueueRepository(options.database);
    const dueWake = new DueWakeService(queue, reviewEvents, {
      now: options.nowMs ?? Date.now,
      setTimer(callback, delayMs) {
        return setTimeout(callback, delayMs);
      },
      clearTimer(timer) {
        clearTimeout(timer as ReturnType<typeof setTimeout>);
      },
    });
    registerSectionRoutes(server, {
      repository,
      nowMs: options.nowMs ?? Date.now,
    });
    registerImportRoutes(server, {
      cards: new CardImportRepository(options.database),
      sections: repository,
      nowMs: options.nowMs ?? Date.now,
    });
    server.addHook("onReady", async () => {
      dueWake.start();
    });
    server.addHook("preClose", async () => {
      dueWake.stop();
      reviewEvents.closeAll();
    });
    server.addHook("onClose", async () => {
      if (options.database?.open === true) {
        options.database.close();
      }
    });
  } else {
    server.addHook("preClose", async () => {
      reviewEvents.closeAll();
    });
  }

  await server.ready();
  return server;
}
