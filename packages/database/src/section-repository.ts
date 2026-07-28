import { randomUUID } from "node:crypto";
import type { SectionSummary } from "@openrecall/contracts";
import type Database from "better-sqlite3";

export interface Section {
  readonly id: string;
  readonly name: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

interface SectionRow {
  readonly id: string;
  readonly name: string;
  readonly created_at_ms: number;
  readonly updated_at_ms: number;
}

interface SectionSummaryRow {
  readonly id: string;
  readonly name: string;
  readonly created_at_ms: number;
  readonly total_count: number;
  readonly new_count: number;
}

export class SectionNameError extends Error {
  constructor() {
    super("SECTION_NAME_INVALID");
  }
}

function normalizeSectionName(name: string): string {
  const normalized = name.trim();
  const characterCount = Array.from(normalized).length;

  if (characterCount < 1 || characterCount > 200) {
    throw new SectionNameError();
  }

  return normalized;
}

function validateNow(nowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new RangeError("SECTION_TIME_INVALID");
  }
}

function mapSection(row: SectionRow): Section {
  return {
    id: row.id,
    name: row.name,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function mapSummary(row: SectionSummaryRow): SectionSummary {
  return {
    id: row.id,
    name: row.name,
    createdAtMs: row.created_at_ms,
    counts: {
      total: row.total_count,
      new: row.new_count,
      dueNow: 0,
    },
    nextDueAtMs: null,
  };
}

export class SectionRepository {
  readonly #insert;
  readonly #list;
  readonly #get;

  constructor(db: Database.Database) {
    this.#insert = db.prepare<
      {
        readonly id: string;
        readonly name: string;
        readonly nowMs: number;
      },
      SectionRow
    >(`
      INSERT INTO sections (id, name, created_at_ms, updated_at_ms)
      VALUES (@id, @name, @nowMs, @nowMs)
      RETURNING id, name, created_at_ms, updated_at_ms
    `);

    const summarySelect = `
      SELECT
        sections.id,
        sections.name,
        sections.created_at_ms,
        count(learning_items.id) AS total_count,
        count(learning_items.id) AS new_count
      FROM sections
      LEFT JOIN learning_items
        ON learning_items.section_id = sections.id
        AND learning_items.lifecycle = 'active'
    `;

    this.#list = db.prepare<[], SectionSummaryRow>(`
      ${summarySelect}
      GROUP BY sections.id
      ORDER BY sections.updated_at_ms DESC, sections.id ASC
    `);

    this.#get = db.prepare<[string], SectionSummaryRow>(`
      ${summarySelect}
      WHERE sections.id = ?
      GROUP BY sections.id
    `);
  }

  createSection(input: { readonly name: string; readonly nowMs: number }): Section {
    validateNow(input.nowMs);
    const name = normalizeSectionName(input.name);
    const row = this.#insert.get({
      id: randomUUID(),
      name,
      nowMs: input.nowMs,
    });

    if (row === undefined) {
      throw new Error("SECTION_INSERT_FAILED");
    }

    return mapSection(row);
  }

  listSections(nowMs: number): SectionSummary[] {
    validateNow(nowMs);
    return this.#list.all().map(mapSummary);
  }

  getSection(sectionId: string, nowMs: number): SectionSummary | undefined {
    validateNow(nowMs);
    const row = this.#get.get(sectionId);
    return row === undefined ? undefined : mapSummary(row);
  }
}
