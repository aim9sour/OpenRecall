import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "./config.js";

const NON_MUTATING_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function tokensMatch(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) {
    return false;
  }

  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function registerSecurity(
  server: FastifyInstance,
  config: ServerConfig,
  csrfToken: string,
): void {
  server.addHook("onRequest", async (request, reply) => {
    if (request.headers.host !== config.authority) {
      await reply.code(421).send({
        code: "HOST_NOT_ALLOWED",
        messageKey: "error.hostNotAllowed",
      });
      return reply;
    }

    if (NON_MUTATING_METHODS.has(request.method)) {
      return;
    }

    if (request.headers.origin !== config.publicOrigin) {
      await reply.code(403).send({
        code: "ORIGIN_NOT_ALLOWED",
        messageKey: "error.originNotAllowed",
      });
      return reply;
    }

    const suppliedToken = request.headers["x-openrecall-csrf"];
    if (
      typeof suppliedToken !== "string" ||
      !tokensMatch(suppliedToken, csrfToken)
    ) {
      await reply.code(403).send({
        code: "CSRF_TOKEN_INVALID",
        messageKey: "error.csrfTokenInvalid",
      });
      return reply;
    }
  });
}
