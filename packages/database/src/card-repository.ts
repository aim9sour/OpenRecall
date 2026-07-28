import { randomUUID } from "node:crypto";
import type {
  Card,
  CardLifecycle,
  CardPage,
  CardPresentationEdit,
} from "@openrecall/contracts";
import { normalizedDuplicateText } from "@openrecall/domain";
import type Database from "better-sqlite3";

interface ItemRow {
  readonly id: string;
  readonly section_id: string;
  readonly lifecycle: CardLifecycle;
  readonly created_at_ms: number;
  readonly updated_at_ms: number;
  readonly trashed_at_ms: number | null;
}

interface PresentationRow {
  readonly id: string;
  readonly learning_item_id: string;
  readonly kind: "primary" | "variant";
  readonly ordinal: number;
  readonly front: string;
  readonly back: string;
  readonly notes: string | null;
  readonly lifecycle: "active" | "retired";
}

interface CursorValue {
  readonly updatedAtMs: number;
  readonly id: string;
}

export interface ListCardsInput {
  readonly sectionId: string;
  readonly cursor: string | null;
  readonly query: string;
  readonly lifecycle: CardLifecycle;
  readonly limit: number;
}

export interface UpdateLearningItemInput {
  readonly itemId: string;
  readonly expectedUpdatedAtMs: number;
  readonly presentations: readonly CardPresentationEdit[];
  readonly nowMs: number;
}

export interface CardLifecycleInput {
  readonly itemId: string;
  readonly expectedUpdatedAtMs: number;
  readonly nowMs: number;
}

export interface PermanentDeleteItemInput {
  readonly itemId: string;
  readonly confirmationItemId: string;
  readonly expectedUpdatedAtMs: number;
}

function validateTime(nowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new RangeError("CARD_TIME_INVALID");
  }
}

function decodeCursor(cursor: string | null): CursorValue | null {
  if (cursor === null) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      typeof value !== "object" ||
      value === null ||
      !("updatedAtMs" in value) ||
      typeof value.updatedAtMs !== "number" ||
      !Number.isSafeInteger(value.updatedAtMs) ||
      value.updatedAtMs < 0 ||
      !("id" in value) ||
      typeof value.id !== "string" ||
      value.id.length === 0
    ) {
      throw new Error("INVALID");
    }
    return { updatedAtMs: value.updatedAtMs as number, id: value.id };
  } catch {
    throw new Error("CARD_CURSOR_INVALID");
  }
}

function encodeCursor(row: ItemRow): string {
  return Buffer.from(
    JSON.stringify({ updatedAtMs: row.updated_at_ms, id: row.id }),
  ).toString("base64url");
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export class CardRepository {
  readonly #db: Database.Database;
  readonly #selectItem;
  readonly #selectPresentations;

  constructor(db: Database.Database) {
    this.#db = db;
    this.#selectItem = db.prepare<[string], ItemRow>(`
      SELECT
        id,
        section_id,
        lifecycle,
        created_at_ms,
        updated_at_ms,
        trashed_at_ms
      FROM learning_items
      WHERE id = ?
    `);
    this.#selectPresentations = db.prepare<[string], PresentationRow>(`
      SELECT
        id,
        learning_item_id,
        kind,
        ordinal,
        front,
        back,
        notes,
        lifecycle
      FROM presentations
      WHERE learning_item_id = ?
        AND lifecycle = 'active'
      ORDER BY ordinal, id
    `);
  }

  #mapCard(row: ItemRow): Card {
    return {
      id: row.id,
      sectionId: row.section_id,
      lifecycle: row.lifecycle,
      createdAtMs: row.created_at_ms,
      updatedAtMs: row.updated_at_ms,
      trashedAtMs: row.trashed_at_ms,
      presentations: this.#selectPresentations.all(row.id).map(
        (presentation) => ({
          id: presentation.id,
          kind: presentation.kind,
          ordinal: presentation.ordinal,
          front: presentation.front,
          back: presentation.back,
          notes: presentation.notes,
        }),
      ),
    };
  }

  getCard(itemId: string): Card | null {
    const row = this.#selectItem.get(itemId);
    return row === undefined ? null : this.#mapCard(row);
  }

  listCards(input: ListCardsInput): CardPage {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new RangeError("CARD_PAGE_LIMIT_INVALID");
    }
    const cursor = decodeCursor(input.cursor);
    const rows = this.#db
      .prepare<
        {
          readonly sectionId: string;
          readonly lifecycle: CardLifecycle;
          readonly cursorUpdatedAtMs: number | null;
          readonly cursorId: string | null;
          readonly pattern: string;
          readonly hasQuery: number;
          readonly limit: number;
        },
        ItemRow
      >(`
        SELECT
          items.id,
          items.section_id,
          items.lifecycle,
          items.created_at_ms,
          items.updated_at_ms,
          items.trashed_at_ms
        FROM learning_items AS items
        WHERE items.section_id = @sectionId
          AND items.lifecycle = @lifecycle
          AND (
            @cursorUpdatedAtMs IS NULL
            OR items.updated_at_ms < @cursorUpdatedAtMs
            OR (
              items.updated_at_ms = @cursorUpdatedAtMs
              AND items.id < @cursorId
            )
          )
          AND (
            @hasQuery = 0
            OR EXISTS (
              SELECT 1
              FROM presentations
              WHERE presentations.learning_item_id = items.id
                AND presentations.lifecycle = 'active'
                AND (
                  presentations.front LIKE @pattern ESCAPE '\\'
                  OR presentations.back LIKE @pattern ESCAPE '\\'
                  OR coalesce(presentations.notes, '') LIKE @pattern ESCAPE '\\'
                )
            )
          )
        ORDER BY items.updated_at_ms DESC, items.id DESC
        LIMIT @limit
      `)
      .all({
        sectionId: input.sectionId,
        lifecycle: input.lifecycle,
        cursorUpdatedAtMs: cursor?.updatedAtMs ?? null,
        cursorId: cursor?.id ?? null,
        pattern: `%${escapeLike(input.query.trim())}%`,
        hasQuery: input.query.trim().length === 0 ? 0 : 1,
        limit: input.limit + 1,
      });
    const hasMore = rows.length > input.limit;
    const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
    return {
      items: pageRows.map((row) => this.#mapCard(row)),
      nextCursor:
        hasMore && pageRows.length > 0
          ? encodeCursor(pageRows[pageRows.length - 1]!)
          : null,
    };
  }

  updateLearningItem(input: UpdateLearningItemInput): Card {
    validateTime(input.nowMs);
    if (input.presentations.length === 0) {
      throw new Error("CARD_PRIMARY_REQUIRED");
    }

    const update = this.#db.transaction(
      (value: UpdateLearningItemInput): Card => {
        const item = this.#selectItem.get(value.itemId);
        if (item === undefined) {
          throw new Error("CARD_NOT_FOUND");
        }
        if (item.updated_at_ms !== value.expectedUpdatedAtMs) {
          throw new Error("CARD_EDIT_CONFLICT");
        }

        const allPresentations = this.#db
          .prepare<[string], PresentationRow>(`
            SELECT
              id,
              learning_item_id,
              kind,
              ordinal,
              front,
              back,
              notes,
              lifecycle
            FROM presentations
            WHERE learning_item_id = ?
            ORDER BY ordinal, id
          `)
          .all(value.itemId);
        const byId = new Map(
          allPresentations.map((presentation) => [
            presentation.id,
            presentation,
          ]),
        );
        const activePrimary = allPresentations.find(
          (presentation) =>
            presentation.lifecycle === "active" &&
            presentation.kind === "primary",
        );
        const selectedIds = new Set<string>();
        const resolved = value.presentations.map((presentation, index) => {
          const id =
            presentation.id ??
            (index === 0 && activePrimary !== undefined
              ? activePrimary.id
              : randomUUID());
          if (selectedIds.has(id)) {
            throw new Error("CARD_PRESENTATION_DUPLICATE");
          }
          if (presentation.id !== undefined && !byId.has(id)) {
            throw new Error("CARD_PRESENTATION_MISMATCH");
          }
          selectedIds.add(id);
          return { ...presentation, id };
        });

        this.#bumpAffectedSessions(value.itemId);
        this.#db
          .prepare(
            `
              UPDATE session_queue_entries
              SET status = 'removed'
              WHERE learning_item_id = ?
                AND status IN ('queued', 'active')
            `,
          )
          .run(value.itemId);
        this.#db
          .prepare(
            `
              UPDATE presentations
              SET ordinal = ordinal + 1000000
              WHERE learning_item_id = ?
            `,
          )
          .run(value.itemId);

        const updatePresentation = this.#db.prepare(`
          UPDATE presentations
          SET
            kind = @kind,
            ordinal = @ordinal,
            front = @front,
            back = @back,
            notes = @notes,
            normalized_front = @normalizedFront,
            normalized_back = @normalizedBack,
            lifecycle = 'active'
          WHERE id = @id
            AND learning_item_id = @itemId
        `);
        const insertPresentation = this.#db.prepare(`
          INSERT INTO presentations
            (
              id,
              learning_item_id,
              kind,
              ordinal,
              front,
              back,
              notes,
              normalized_front,
              normalized_back,
              lifecycle
            )
          VALUES
            (
              @id,
              @itemId,
              @kind,
              @ordinal,
              @front,
              @back,
              @notes,
              @normalizedFront,
              @normalizedBack,
              'active'
            )
        `);
        const insertExposure = this.#db.prepare(`
          INSERT INTO presentation_exposures
            (presentation_id, show_count)
          VALUES
            (?, 0)
        `);
        resolved.forEach((presentation, ordinal) => {
          const parameters = {
            id: presentation.id,
            itemId: value.itemId,
            kind: ordinal === 0 ? "primary" : "variant",
            ordinal,
            front: presentation.front,
            back: presentation.back,
            notes: presentation.notes ?? null,
            normalizedFront: normalizedDuplicateText(presentation.front),
            normalizedBack: normalizedDuplicateText(presentation.back),
          };
          if (byId.has(presentation.id)) {
            if (updatePresentation.run(parameters).changes !== 1) {
              throw new Error("CARD_PRESENTATION_UPDATE_FAILED");
            }
          } else {
            insertPresentation.run(parameters);
            insertExposure.run(presentation.id);
          }
        });

        let retiredOrdinal = resolved.length;
        const hasReferences = this.#db.prepare<[string, string], number>(`
          SELECT
            EXISTS(
              SELECT 1 FROM review_logs WHERE presentation_id = ?
            )
            OR EXISTS(
              SELECT 1
              FROM session_queue_entries
              WHERE presentation_id = ?
            )
        `);
        const deletePresentation = this.#db.prepare(
          "DELETE FROM presentations WHERE id = ?",
        );
        const retirePresentation = this.#db.prepare(`
          UPDATE presentations
          SET
            kind = 'variant',
            ordinal = ?,
            lifecycle = 'retired'
          WHERE id = ?
        `);
        for (const presentation of allPresentations) {
          if (selectedIds.has(presentation.id)) {
            continue;
          }
          const referenced = hasReferences.pluck().get(
            presentation.id,
            presentation.id,
          );
          if (referenced === 0) {
            deletePresentation.run(presentation.id);
          } else {
            retirePresentation.run(retiredOrdinal, presentation.id);
            retiredOrdinal += 1;
          }
        }

        if (
          this.#db
            .prepare(
              `
                UPDATE learning_items
                SET updated_at_ms = ?
                WHERE id = ?
                  AND updated_at_ms = ?
              `,
            )
            .run(
              value.nowMs,
              value.itemId,
              value.expectedUpdatedAtMs,
            ).changes !== 1
        ) {
          throw new Error("CARD_EDIT_CONFLICT");
        }
        return this.#mapCard(this.#selectItem.get(value.itemId)!);
      },
    );

    return update.immediate(input);
  }

  trashItem(input: CardLifecycleInput): Card {
    return this.#setLifecycle(input, "trashed");
  }

  restoreItem(input: CardLifecycleInput): Card {
    return this.#setLifecycle(input, "active");
  }

  #setLifecycle(
    input: CardLifecycleInput,
    lifecycle: CardLifecycle,
  ): Card {
    validateTime(input.nowMs);
    const mutate = this.#db.transaction(() => {
      const item = this.#selectItem.get(input.itemId);
      if (item === undefined) {
        throw new Error("CARD_NOT_FOUND");
      }
      if (item.updated_at_ms !== input.expectedUpdatedAtMs) {
        throw new Error("CARD_EDIT_CONFLICT");
      }
      this.#bumpAffectedSessions(input.itemId);
      if (lifecycle === "trashed") {
        this.#db
          .prepare(
            `
              UPDATE session_queue_entries
              SET status = 'removed'
              WHERE learning_item_id = ?
                AND status IN ('queued', 'active')
            `,
          )
          .run(input.itemId);
      }
      const result = this.#db
        .prepare(
          `
            UPDATE learning_items
            SET
              lifecycle = @lifecycle,
              updated_at_ms = @nowMs,
              trashed_at_ms =
                CASE WHEN @lifecycle = 'trashed' THEN @nowMs ELSE NULL END
            WHERE id = @itemId
              AND updated_at_ms = @expectedUpdatedAtMs
          `,
        )
        .run({ ...input, lifecycle });
      if (result.changes !== 1) {
        throw new Error("CARD_EDIT_CONFLICT");
      }
      return this.#mapCard(this.#selectItem.get(input.itemId)!);
    });
    return mutate.immediate();
  }

  permanentlyDeleteItem(input: PermanentDeleteItemInput): void {
    if (input.itemId !== input.confirmationItemId) {
      throw new Error("PERMANENT_DELETE_CONFIRMATION_MISMATCH");
    }
    const remove = this.#db.transaction(() => {
      const item = this.#selectItem.get(input.itemId);
      if (item === undefined) {
        throw new Error("CARD_NOT_FOUND");
      }
      if (item.updated_at_ms !== input.expectedUpdatedAtMs) {
        throw new Error("CARD_EDIT_CONFLICT");
      }
      this.#bumpAffectedSessions(input.itemId);
      this.#db
        .prepare("DELETE FROM rating_requests WHERE learning_item_id = ?")
        .run(input.itemId);
      this.#db
        .prepare("DELETE FROM review_logs WHERE learning_item_id = ?")
        .run(input.itemId);
      this.#db
        .prepare(
          "DELETE FROM session_queue_entries WHERE learning_item_id = ?",
        )
        .run(input.itemId);
      if (
        this.#db
          .prepare(
            "DELETE FROM learning_items WHERE id = ? AND updated_at_ms = ?",
          )
          .run(input.itemId, input.expectedUpdatedAtMs).changes !== 1
      ) {
        throw new Error("CARD_EDIT_CONFLICT");
      }
    });
    remove.immediate();
  }

  #bumpAffectedSessions(itemId: string): void {
    this.#db
      .prepare(
        `
          UPDATE review_sessions
          SET revision = revision + 1
          WHERE id IN (
            SELECT session_id
            FROM session_queue_entries
            WHERE learning_item_id = ?
              AND status IN ('queued', 'active')
          )
        `,
      )
      .run(itemId);
  }
}
