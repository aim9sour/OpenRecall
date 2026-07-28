import { randomUUID } from "node:crypto";
import {
  duplicateKey,
  normalizedDuplicateText,
  type AcceptedImportItem,
  type AcceptedPresentation,
} from "@openrecall/domain";
import type Database from "better-sqlite3";
import {
  OFFICIAL_PARAMETER_PROFILE_ID,
  SCHEDULER_ADAPTER_VERSION,
  SCHEDULER_ALGORITHM_ID,
  SCHEDULER_ALGORITHM_VERSION,
} from "./review-types.js";

interface LearningItemInsert {
  readonly id: string;
  readonly sectionId: string;
  readonly nowMs: number;
}

interface PresentationInsert {
  readonly id: string;
  readonly learningItemId: string;
  readonly kind: "primary" | "variant";
  readonly ordinal: number;
  readonly front: string;
  readonly back: string;
  readonly notes: string | null;
  readonly normalizedFront: string;
  readonly normalizedBack: string;
}

export class CardImportRepository {
  readonly #db;
  readonly #insertLearningItem;
  readonly #insertSchedulerState;
  readonly #insertPresentation;
  readonly #insertExposure;
  readonly #selectDuplicateKeys;

  constructor(db: Database.Database) {
    this.#db = db;
    this.#insertLearningItem = db.prepare<LearningItemInsert>(`
      INSERT INTO learning_items
        (id, section_id, lifecycle, created_at_ms, updated_at_ms)
      VALUES
        (@id, @sectionId, 'active', @nowMs, @nowMs)
    `);
    this.#insertSchedulerState = db.prepare<LearningItemInsert>(`
      INSERT INTO scheduler_states
        (
          learning_item_id,
          section_id,
          due_at_ms,
          memory_state,
          step_index,
          stability,
          difficulty,
          elapsed_days_at_last_review,
          scheduled_days,
          last_review_at_ms,
          repetitions,
          lapses,
          revision,
          algorithm_id,
          algorithm_version,
          adapter_version,
          parameter_profile_id
        )
      VALUES
        (
          @id,
          @sectionId,
          @nowMs,
          'new',
          NULL,
          0,
          0,
          0,
          0,
          NULL,
          0,
          0,
          0,
          '${SCHEDULER_ALGORITHM_ID}',
          '${SCHEDULER_ALGORITHM_VERSION}',
          ${SCHEDULER_ADAPTER_VERSION},
          '${OFFICIAL_PARAMETER_PROFILE_ID}'
        )
    `);
    this.#insertPresentation = db.prepare<PresentationInsert>(`
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
          normalized_back
        )
      VALUES
        (
          @id,
          @learningItemId,
          @kind,
          @ordinal,
          @front,
          @back,
          @notes,
          @normalizedFront,
          @normalizedBack
        )
    `);
    this.#insertExposure = db.prepare<[string]>(`
      INSERT INTO presentation_exposures
        (presentation_id, show_count)
      VALUES
        (?, 0)
    `);
    this.#selectDuplicateKeys = db.prepare<
      [string],
      { readonly front: string; readonly back: string }
    >(`
      SELECT
        presentations.normalized_front AS front,
        presentations.normalized_back AS back
      FROM presentations
      JOIN learning_items
        ON learning_items.id = presentations.learning_item_id
      WHERE learning_items.section_id = ?
        AND learning_items.lifecycle = 'active'
        AND presentations.kind = 'primary'
    `);
  }

  getDuplicateKeys(sectionId: string): ReadonlySet<string> {
    return new Set(
      this.#selectDuplicateKeys
        .all(sectionId)
        .map((row) => duplicateKey(row.front, row.back)),
    );
  }

  commitImport(
    sectionId: string,
    acceptedItems: readonly AcceptedImportItem[],
    nowMs: number,
  ): { readonly importedItemIds: string[] } {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new RangeError("IMPORT_TIME_INVALID");
    }

    const commit = this.#db.transaction(() => {
      const importedItemIds: string[] = [];

      for (const item of acceptedItems) {
        const learningItemId = randomUUID();
        this.#insertLearningItem.run({
          id: learningItemId,
          sectionId,
          nowMs,
        });
        this.#insertSchedulerState.run({
          id: learningItemId,
          sectionId,
          nowMs,
        });

        const presentations: readonly AcceptedPresentation[] = [
          {
            front: item.front,
            back: item.back,
            notes: item.notes,
          },
          ...item.variants,
        ];

        presentations.forEach((presentation, ordinal) => {
          const presentationId = randomUUID();
          this.#insertPresentation.run({
            id: presentationId,
            learningItemId,
            kind: ordinal === 0 ? "primary" : "variant",
            ordinal,
            front: presentation.front,
            back: presentation.back,
            notes: presentation.notes,
            normalizedFront: normalizedDuplicateText(presentation.front),
            normalizedBack: normalizedDuplicateText(presentation.back),
          });
          this.#insertExposure.run(presentationId);
        });

        importedItemIds.push(learningItemId);
      }

      return importedItemIds;
    });

    return { importedItemIds: commit.immediate() };
  }
}
