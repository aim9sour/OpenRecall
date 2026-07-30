import { API_VERSION, APP_NAME } from "@openrecall/contracts";
import { SCHEMA_VERSION } from "@openrecall/database";
import type { FastifyInstance } from "fastify";
import { Type } from "typebox";
import type { MaintenanceMode } from "./durability/maintenance-mode.js";

const HealthResponseSchema = Type.Object(
  {
    app: Type.Literal(APP_NAME),
    apiVersion: Type.Literal(API_VERSION),
    status: Type.Union([
      Type.Literal("ok"),
      Type.Literal("unavailable"),
    ]),
    database: Type.Union([
      Type.Literal("open"),
      Type.Literal("closed"),
      Type.Literal("not-configured"),
    ]),
    schema: Type.Union([
      Type.Literal("supported"),
      Type.Literal("unsupported"),
      Type.Literal("not-checked"),
    ]),
    schemaVersion: Type.Literal(SCHEMA_VERSION),
    maintenance: Type.Boolean(),
  },
  { additionalProperties: false },
);

type ApplicationDatabase = {
  readonly open: boolean;
  pragma(
    source: string,
    options: { readonly simple: true },
  ): unknown;
};

type ApplicationDatabaseProvider = () =>
  | ApplicationDatabase
  | undefined;

export function registerHealthRoute(
  server: FastifyInstance,
  maintenance: MaintenanceMode,
  databaseProvider: ApplicationDatabaseProvider,
): void {
  server.get(
    "/api/v1/health",
    {
      schema: {
        response: {
          200: HealthResponseSchema,
          503: HealthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const database = databaseProvider();
      const databaseState =
        database === undefined
          ? ("not-configured" as const)
          : database.open
            ? ("open" as const)
            : ("closed" as const);
      const actualSchemaVersion =
        database !== undefined && database.open
          ? Number(database.pragma("user_version", { simple: true }))
          : undefined;
      const schemaState =
        actualSchemaVersion === undefined
          ? ("not-checked" as const)
          : actualSchemaVersion === SCHEMA_VERSION
            ? ("supported" as const)
            : ("unsupported" as const);
      const available =
        databaseState !== "closed" && schemaState !== "unsupported";

      return reply.code(available ? 200 : 503).send({
        app: APP_NAME,
        apiVersion: API_VERSION,
        status: available
          ? ("ok" as const)
          : ("unavailable" as const),
        database: databaseState,
        schema: schemaState,
        schemaVersion: SCHEMA_VERSION,
        maintenance: maintenance.active,
      });
    },
  );
}
