import type { FastifyInstance } from "fastify";
import { Type } from "typebox";
import type { MaintenanceMode } from "../durability/maintenance-mode.js";

const HealthResponseSchema = Type.Object(
  {
    status: Type.Literal("ok"),
    maintenance: Type.Boolean(),
    databaseRevision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export function registerHealthRoute(
  server: FastifyInstance,
  maintenance: MaintenanceMode,
): void {
  server.get(
    "/api/v1/health",
    {
      schema: {
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async () => ({
      status: "ok" as const,
      maintenance: maintenance.active,
      databaseRevision: maintenance.revision,
    }),
  );
}
