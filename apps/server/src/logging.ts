import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import type {
  FastifyError,
  FastifyInstance,
  FastifyRequest,
} from "fastify";

export interface ContentFreeLogEntry {
  readonly diagnosticId?: string;
  readonly requestId: string;
  readonly route: string;
  readonly status: number;
  readonly durationMs: number;
}

const diagnosticIds = new WeakMap<FastifyRequest, string>();

export type ContentFreeLogSink = (
  entry: ContentFreeLogEntry,
) => void | Promise<void>;

export interface ContentFreeLoggingOptions {
  readonly nowMs?: () => number;
  readonly sink: ContentFreeLogSink;
}

function routeTemplate(request: FastifyRequest): string {
  return request.routeOptions.url ?? "unmatched";
}

export function registerContentFreeLogging(
  server: FastifyInstance,
  options: ContentFreeLoggingOptions,
): void {
  const startedAt = new WeakMap<FastifyRequest, number>();
  const nowMs = options.nowMs ?? Date.now;

  server.addHook("onRequest", async (request) => {
    startedAt.set(request, nowMs());
  });
  server.addHook("onResponse", async (request, reply) => {
    const start = startedAt.get(request) ?? nowMs();
    const diagnosticId = diagnosticIds.get(request);
    const entry: ContentFreeLogEntry = {
      ...(diagnosticId === undefined ? {} : { diagnosticId }),
      requestId: request.id,
      route: routeTemplate(request),
      status: reply.statusCode,
      durationMs: Math.max(0, nowMs() - start),
    };
    try {
      await options.sink(entry);
    } catch {
      // Diagnostics must never make the local application unavailable.
    }
  });
}

export function createJsonLinesLogSink(
  logFilePath: string,
): ContentFreeLogSink {
  return async (entry) => {
    await appendFile(logFilePath, `${JSON.stringify(entry)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  };
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

export function registerContentFreeErrorHandler(
  server: FastifyInstance,
): void {
  server.setErrorHandler((error: FastifyError, request, reply) => {
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
    if (statusCode === 500) {
      diagnosticIds.set(request, randomUUID());
    }

    return reply.code(statusCode).send({
      code: statusCode === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
      messageKey:
        statusCode === 404 ? "error.notFound" : "error.internal",
    });
  });
}
