import { mkdir, readdir, symlink } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  CardImportRepository,
  RatingTransaction,
  ReviewQueueRepository,
  ReviewSessionRepository,
} from "@openrecall/database";
import { withTempDatabase } from "@openrecall/test-support";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  APPLICATION_ID,
  SCHEMA_VERSION,
} from "./constants.js";
import { createBackupService } from "./backup-service.js";
import { openDatabase } from "./open-database.js";
import { SectionRepository } from "./section-repository.js";

function interceptFirstBackupProgress(
  db: ReturnType<typeof openDatabase>,
  action: () => void,
): void {
  const original = db.backup.bind(db);
  let acted = false;
  Object.defineProperty(db, "backup", {
    configurable: true,
    value: (
      destination: string,
      options?: Database.BackupOptions,
    ) =>
      original(destination, {
        progress(info) {
          if (!acted) {
            acted = true;
            action();
          }
          return options?.progress(info) ?? 100;
        },
      }),
  });
}

describe("BackupService", () => {
  it("creates a content-free contained snapshot and validates SQLite identity/integrity", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const snapshotDirectory = join(dirname(databasePath), "snapshots");
      const service = createBackupService({
        db,
        snapshotDirectory,
        nowMs: () => 1_785_232_800_000,
      });
      try {
        const snapshot = await service.createSnapshot(
          "automatic",
          "PRIVATE reason must not enter filename",
          new AbortController().signal,
        );

        expect(snapshot.filename).toMatch(
          /^openrecall-automatic-1785232800000-[0-9a-f-]{36}\.sqlite3$/,
        );
        expect(snapshot.filename).not.toMatch(/PRIVATE|reason/i);
        expect(relative(snapshotDirectory, snapshot.path)).not.toMatch(
          /^\.\.(?:[\\/]|$)/,
        );
        expect(await service.validateSnapshot(snapshot.path)).toEqual({
          userVersion: SCHEMA_VERSION,
          createdAtMs: 1_785_232_800_000,
        });

        const copy = new Database(snapshot.path, {
          readonly: true,
          fileMustExist: true,
        });
        try {
          copy.pragma("foreign_keys = ON");
          expect(copy.pragma("application_id", { simple: true })).toBe(
            APPLICATION_ID,
          );
          expect(copy.pragma("user_version", { simple: true })).toBe(
            SCHEMA_VERSION,
          );
          expect(copy.pragma("quick_check", { simple: true })).toBe("ok");
          expect(copy.pragma("foreign_key_check")).toEqual([]);
        } finally {
          copy.close();
        }
      } finally {
        db.close();
      }
    });
  });

  it("contains a rating transaction completely or not at all when it commits during backup", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const snapshotDirectory = join(dirname(databasePath), "snapshots");
      const section = new SectionRepository(db).createSection({
        name: "Biology",
        nowMs: 100,
      });
      const itemId = new CardImportRepository(db).commitImport(
        section.id,
        [
          {
            sourceIndex: 0,
            front: "Question",
            back: "Answer",
            notes: null,
            variants: [],
          },
        ],
        100,
      ).importedItemIds[0]!;
      const queue = new ReviewQueueRepository(db);
      const session = queue.startOrResumeSession(section.id, 100);
      const sessions = new ReviewSessionRepository(db);
      const current = sessions.claimNext(session.id, 100);
      if (current === null) throw new Error("TEST_CARD_NOT_CLAIMED");
      const ratings = new RatingTransaction(db);
      ratings.markShown(
        session.id,
        current.entryId,
        current.presentationId,
        110,
      );
      ratings.markRevealed(session.id, current.entryId, 120);

      interceptFirstBackupProgress(db, () => {
        ratings.rate({
          sessionId: session.id,
          entryId: current.entryId,
          learningItemId: itemId,
          rating: 3,
          expectedStateRevision: 0,
          idempotencyKey: "backup-concurrent-rating",
          nowMs: 130,
        });
      });
      const service = createBackupService({
        db,
        snapshotDirectory,
        nowMs: () => 200,
      });
      try {
        const snapshot = await service.createSnapshot(
          "automatic",
          "rating-consistency",
          new AbortController().signal,
        );
        const copy = new Database(snapshot.path, {
          readonly: true,
          fileMustExist: true,
        });
        try {
          const logCount = Number(
            copy
              .prepare(
                "SELECT count(*) FROM review_logs WHERE learning_item_id = ?",
              )
              .pluck()
              .get(itemId),
          );
          const revision = Number(
            copy
              .prepare(
                "SELECT revision FROM scheduler_states WHERE learning_item_id = ?",
              )
              .pluck()
              .get(itemId),
          );
          const requestCount = Number(
            copy
              .prepare(
                "SELECT count(*) FROM rating_requests WHERE learning_item_id = ?",
              )
              .pluck()
              .get(itemId),
          );
          expect([logCount, revision, requestCount]).toSatisfy(
            (values: number[]) =>
              values.every((value) => value === 0) ||
              values.every((value) => value === 1),
          );
        } finally {
          copy.close();
        }
      } finally {
        db.close();
      }
    });
  });

  it("cancels through the online-backup progress callback and removes partial output", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const snapshotDirectory = join(dirname(databasePath), "snapshots");
      const controller = new AbortController();
      interceptFirstBackupProgress(db, () => controller.abort());
      const service = createBackupService({
        db,
        snapshotDirectory,
        nowMs: () => 300,
      });
      try {
        await expect(
          service.createSnapshot(
            "automatic",
            "cancel-test",
            controller.signal,
          ),
        ).rejects.toThrow("BACKUP_CANCELLED");
        expect(await readdir(snapshotDirectory)).toEqual([]);
      } finally {
        db.close();
      }
    });
  });

  it("keeps the newest ten automatic snapshots without deleting manual snapshots", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const snapshotDirectory = join(dirname(databasePath), "snapshots");
      let nowMs = 1_000;
      const service = createBackupService({
        db,
        snapshotDirectory,
        nowMs: () => nowMs,
      });
      try {
        const manual = await service.createSnapshot(
          "manual",
          "download",
          new AbortController().signal,
        );
        const automatic: string[] = [];
        for (let index = 0; index < 11; index += 1) {
          nowMs = 2_000 + index;
          automatic.push(
            (
              await service.createSnapshot(
                "automatic",
                "retention",
                new AbortController().signal,
              )
            ).filename,
          );
        }
        const files = await readdir(snapshotDirectory);

        expect(files).toContain(manual.filename);
        expect(
          files.filter((filename) =>
            filename.startsWith("openrecall-automatic-") &&
            filename.endsWith(".sqlite3"),
          ),
        ).toHaveLength(10);
        expect(files).not.toContain(automatic[0]);
        expect(files).toEqual(
          expect.arrayContaining(automatic.slice(1)),
        );
      } finally {
        db.close();
      }
    });
  });

  it("rejects a configured snapshot-directory symlink instead of following it", async () => {
    await withTempDatabase(async (databasePath) => {
      const db = openDatabase(databasePath);
      const root = dirname(databasePath);
      const target = join(root, "outside-snapshots");
      const snapshotDirectory = join(root, "snapshot-link");
      await mkdir(target);
      await symlink(target, snapshotDirectory, "junction");
      const service = createBackupService({
        db,
        snapshotDirectory,
        nowMs: () => 1_000,
      });
      try {
        await expect(
          service.createSnapshot(
            "automatic",
            "path-safety",
            new AbortController().signal,
          ),
        ).rejects.toThrow("BACKUP_DIRECTORY_SYMLINK");
        expect(await readdir(target)).toEqual([]);
      } finally {
        db.close();
      }
    });
  });
});
