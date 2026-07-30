import helmet from "@fastify/helmet";
import type { FastifyInstance } from "fastify";

export async function registerSecurityHeaders(
  server: FastifyInstance,
): Promise<void> {
  await server.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        baseUri: ["'none'"],
        connectSrc: ["'self'"],
        defaultSrc: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        workerSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    frameguard: { action: "deny" },
    hsts: false,
    referrerPolicy: { policy: "no-referrer" },
    xContentTypeOptions: true,
  });
}
