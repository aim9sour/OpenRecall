import { API_VERSION } from "@openrecall/contracts";
import type { LocaleTag } from "@openrecall/i18n";
import type { FastifyInstance } from "fastify";
import { Type } from "typebox";

const BootstrapResponseSchema = Type.Object(
  {
    apiVersion: Type.Literal(API_VERSION),
    csrfToken: Type.String({ minLength: 1 }),
    databaseRevision: Type.Integer({ minimum: 1 }),
    locale: Type.Union([Type.Literal("ar"), Type.Literal("en")]),
  },
  { additionalProperties: false },
);

export function registerBootstrapRoute(
  server: FastifyInstance,
  options: {
    readonly csrfToken: string;
    readonly locale: LocaleTag;
    readonly databaseRevision: () => number;
  },
): void {
  server.get(
    "/api/v1/bootstrap",
    {
      schema: {
        response: {
          200: BootstrapResponseSchema,
        },
      },
    },
    async () => ({
      apiVersion: API_VERSION,
      csrfToken: options.csrfToken,
      databaseRevision: options.databaseRevision(),
      locale: options.locale,
      internalMarker: "must-not-cross-the-response-schema",
    }),
  );
}
