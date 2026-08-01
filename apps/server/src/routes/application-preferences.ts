import {
  ApplicationLocalePreferenceMutationSchema,
  ApplicationLocalePreferenceSchema,
  EpochMillisecondsSchema,
  type ApplicationLocalePreferenceMutation,
} from "@openrecall/contracts";
import {
  ApplicationPreferenceConflictError,
  type ApplicationPreferenceRepository,
} from "@openrecall/database";
import {
  DEVELOPMENT_LOCALES,
  SUPPORTED_LOCALES,
} from "@openrecall/i18n";
import type { FastifyInstance } from "fastify";
import { Type } from "typebox";

const ApplicationLocaleConflictSchema = Type.Object(
  {
    code: Type.Literal("APPLICATION_SETTING_CONFLICT"),
    messageKey: Type.Literal("settings.language.conflict"),
    current: Type.Object(
      {
        locale: Type.Union(
          [...SUPPORTED_LOCALES, ...DEVELOPMENT_LOCALES].map((tag) =>
            Type.Literal(tag),
          ),
        ),
        updatedAtMs: EpochMillisecondsSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export function registerApplicationPreferenceRoutes(
  server: FastifyInstance,
  options: {
    readonly preferences: ApplicationPreferenceRepository;
    readonly nowMs: () => number;
  },
): void {
  server.put<{ Body: ApplicationLocalePreferenceMutation }>(
    "/api/v1/application-settings/locale",
    {
      schema: {
        body: ApplicationLocalePreferenceMutationSchema,
        response: {
          200: ApplicationLocalePreferenceSchema,
          409: ApplicationLocaleConflictSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(200).send(
          options.preferences.saveLocale({
            ...request.body,
            nowMs: options.nowMs(),
          }),
        );
      } catch (error) {
        if (error instanceof ApplicationPreferenceConflictError) {
          return reply.code(409).send({
            code: "APPLICATION_SETTING_CONFLICT",
            messageKey: "settings.language.conflict",
            current: error.current,
          });
        }
        throw error;
      }
    },
  );
}
