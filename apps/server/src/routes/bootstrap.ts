import { API_VERSION } from "@openrecall/contracts";
import {
  DEVELOPMENT_LOCALES,
  SUPPORTED_LOCALES,
  type LocaleTag,
} from "@openrecall/i18n";
import type { FastifyInstance } from "fastify";
import { Type } from "typebox";

const BootstrapResponseSchema = Type.Object(
  {
    apiVersion: Type.Literal(API_VERSION),
    csrfToken: Type.String({ minLength: 1 }),
    databaseRevision: Type.Integer({ minimum: 1 }),
    locale: Type.Union(
      [...SUPPORTED_LOCALES, ...DEVELOPMENT_LOCALES].map((tag) =>
        Type.Literal(tag),
      ),
    ),
    localeUpdatedAtMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export function registerBootstrapRoute(
  server: FastifyInstance,
  options: {
    readonly csrfToken: string;
    readonly localePreference: () => {
      readonly locale: LocaleTag;
      readonly updatedAtMs: number;
    };
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
    async () => {
      const localePreference = options.localePreference();
      return {
        apiVersion: API_VERSION,
        csrfToken: options.csrfToken,
        databaseRevision: options.databaseRevision(),
        locale: localePreference.locale,
        localeUpdatedAtMs: localePreference.updatedAtMs,
        internalMarker: "must-not-cross-the-response-schema",
      };
    },
  );
}
