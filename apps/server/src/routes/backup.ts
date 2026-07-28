import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import type { BackupService } from "@openrecall/database";
import type { FastifyInstance } from "fastify";

async function removeSnapshot(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      // Best-effort post-response cleanup must not turn a completed
      // download into an unhandled rejection.
    }
  }
}

export function registerBackupRoutes(
  server: FastifyInstance,
  options: {
    readonly backups: BackupService;
  },
): void {
  server.post("/api/v1/backup", async (_request, reply) => {
    const snapshot = await options.backups.createSnapshot(
      "manual",
      "manual-download",
      new AbortController().signal,
    );
    await options.backups.validateSnapshot(snapshot.path);
    const stream = createReadStream(snapshot.path);
    stream.once("close", () => {
      void removeSnapshot(snapshot.path);
    });
    stream.once("error", () => {
      void removeSnapshot(snapshot.path);
    });

    return reply
      .header("Cache-Control", "no-store")
      .header(
        "Content-Disposition",
        `attachment; filename="${snapshot.filename}"`,
      )
      .type("application/vnd.sqlite3")
      .send(stream);
  });
}
