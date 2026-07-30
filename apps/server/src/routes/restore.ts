import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  ApiErrorSchema,
  RestoreResultSchema,
  type RestoreResult,
} from "@openrecall/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";

export const RESTORE_MAX_UPLOAD_BYTES = 2 * 1_024 * 1_024 * 1_024;

export interface RestoreServiceApi {
  restoreFromUpload(
    stagedPath: string,
    expectedCurrentRevision: number,
  ): Promise<RestoreResult>;
}

async function removeUpload(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

function stableRestoreError(reply: FastifyReply, error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (
    code === "RESTORE_REVISION_CONFLICT" ||
    code === "MAINTENANCE_MODE"
  ) {
    return reply.code(code === "MAINTENANCE_MODE" ? 503 : 409).send({
      code,
      messageKey:
        code === "MAINTENANCE_MODE"
          ? "error.maintenance"
          : "restore.revisionConflict",
    });
  }
  if (
    code === "RESTORE_FILE_INVALID" ||
    code === "RESTORE_APPLICATION_MISMATCH" ||
    code === "RESTORE_SCHEMA_FUTURE" ||
    code === "RESTORE_FOREIGN_KEYS_INVALID"
  ) {
    return reply.code(400).send({
      code,
      messageKey: "restore.invalid",
    });
  }
  throw error;
}

export function registerRestoreRoutes(
  server: FastifyInstance,
  options: {
    readonly restore: RestoreServiceApi;
    readonly uploadDirectory: string;
    readonly maxUploadBytes?: number;
  },
): void {
  const maximum = options.maxUploadBytes ?? RESTORE_MAX_UPLOAD_BYTES;
  server.post(
    "/api/v1/restore",
    {
      bodyLimit: maximum + 1_024 * 1_024,
      schema: {
        response: {
          200: RestoreResultSchema,
          400: ApiErrorSchema,
          409: ApiErrorSchema,
          413: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const directory = resolve(options.uploadDirectory);
      await mkdir(directory, { recursive: true });
      if ((await lstat(directory)).isSymbolicLink()) {
        return reply.code(400).send({
          code: "RESTORE_UPLOAD_PATH_INVALID",
          messageKey: "restore.invalid",
        });
      }
      const stagedPath = resolve(
        join(directory, `restore-upload-${randomUUID()}.sqlite3`),
      );
      let expectedRevision: number | null = null;
      let fileCount = 0;
      let fieldCount = 0;
      try {
        const parts = request.parts({
          limits: {
            fields: 1,
            fileSize: maximum,
            files: 1,
            parts: 2,
          },
        });
        for await (const part of parts) {
          if (part.type === "file") {
            fileCount += 1;
            if (part.fieldname !== "database" || fileCount !== 1) {
              part.file.resume();
              throw new Error("RESTORE_UPLOAD_INVALID");
            }
            await pipeline(
              part.file,
              createWriteStream(stagedPath, {
                flags: "wx",
                mode: 0o600,
              }),
            );
            if (part.file.truncated) {
              throw new Error("RESTORE_UPLOAD_TOO_LARGE");
            }
          } else {
            fieldCount += 1;
            if (
              part.fieldname !== "expectedCurrentRevision" ||
              fieldCount !== 1 ||
              typeof part.value !== "string"
            ) {
              throw new Error("RESTORE_UPLOAD_INVALID");
            }
            const parsed = Number(part.value);
            if (!Number.isSafeInteger(parsed) || parsed < 1) {
              throw new Error("RESTORE_UPLOAD_INVALID");
            }
            expectedRevision = parsed;
          }
        }
        if (
          fileCount !== 1 ||
          fieldCount !== 1 ||
          expectedRevision === null
        ) {
          throw new Error("RESTORE_UPLOAD_INVALID");
        }
        try {
          const result = await options.restore.restoreFromUpload(
            stagedPath,
            expectedRevision,
          );
          return reply.code(200).send(result);
        } catch (error) {
          return stableRestoreError(reply, error);
        }
      } catch (error) {
        const statusCode =
          error instanceof Error &&
          (error.message === "RESTORE_UPLOAD_TOO_LARGE" ||
            ("statusCode" in error && error.statusCode === 413))
            ? 413
            : 400;
        return reply.code(statusCode).send({
          code:
            statusCode === 413
              ? "RESTORE_UPLOAD_TOO_LARGE"
              : "RESTORE_UPLOAD_INVALID",
          messageKey:
            statusCode === 413
              ? "restore.tooLarge"
              : "restore.invalid",
        });
      } finally {
        await removeUpload(stagedPath);
      }
    },
  );
}
