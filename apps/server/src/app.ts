import { randomBytes } from "node:crypto";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  LogController,
} from "fastify";
import { loadConfig, type ServerConfig } from "./config.js";
import { registerBootstrapRoute } from "./routes/bootstrap.js";
import { registerSecurity } from "./security.js";

const PROCESS_CSRF_TOKEN = randomBytes(32).toString("base64url");

export interface BuildServerOptions {
  readonly config?: ServerConfig;
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
    logController: new LogController({ disableRequestLogging: true }),
    logger: false,
  }).withTypeProvider<TypeBoxTypeProvider>();

  registerSecurity(server, config, PROCESS_CSRF_TOKEN);
  registerErrorHandler(server);
  registerBootstrapRoute(server, {
    csrfToken: PROCESS_CSRF_TOKEN,
    locale: config.locale,
  });

  await server.ready();
  return server;
}
