import { randomBytes } from "node:crypto";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  CardImportRepository,
  SectionRepository,
} from "@openrecall/database";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  LogController,
} from "fastify";
import { loadConfig, type ServerConfig } from "./config.js";
import { registerBootstrapRoute } from "./routes/bootstrap.js";
import { registerImportRoutes } from "./routes/import.js";
import { registerSectionRoutes } from "./routes/sections.js";
import { registerSecurity } from "./security.js";

const PROCESS_CSRF_TOKEN = randomBytes(32).toString("base64url");

export interface BuildServerOptions {
  readonly config?: ServerConfig;
  readonly database?: ConstructorParameters<typeof SectionRepository>[0];
  readonly nowMs?: () => number;
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

  registerSecurity(server, config, PROCESS_CSRF_TOKEN);
  registerErrorHandler(server);
  registerBootstrapRoute(server, {
    csrfToken: PROCESS_CSRF_TOKEN,
    locale: config.locale,
  });
  if (options.database !== undefined) {
    const repository = new SectionRepository(options.database);
    registerSectionRoutes(server, {
      repository,
      nowMs: options.nowMs ?? Date.now,
    });
    registerImportRoutes(server, {
      cards: new CardImportRepository(options.database),
      sections: repository,
      nowMs: options.nowMs ?? Date.now,
    });
    server.addHook("onClose", async () => {
      if (options.database?.open === true) {
        options.database.close();
      }
    });
  }

  await server.ready();
  return server;
}
