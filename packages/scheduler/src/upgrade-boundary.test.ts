import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyRating, createInitialState } from "./fsrs6-adapter.js";
import {
  DEFAULT_SCHEDULER_SETTINGS,
  FSRS6_MANIFEST,
} from "./manifest.js";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
]);
const generatedDirectories = new Set([
  "coverage",
  "dist",
  "build",
  "node_modules",
]);

async function sourceFilesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory() && !generatedDirectories.has(entry.name)) {
      files.push(...(await sourceFilesUnder(absolutePath)));
    } else if (sourceExtensions.has(extname(entry.name))) {
      files.push(absolutePath);
    }
  }

  return files;
}

describe("FSRS adapter upgrade boundary", () => {
  it("keeps upstream package references inside packages/scheduler", async () => {
    const roots = [
      join(repositoryRoot, "apps"),
      join(repositoryRoot, "packages"),
    ];
    const sourceFiles = (await Promise.all(roots.map(sourceFilesUnder))).flat();
    const violations: string[] = [];

    for (const sourceFile of sourceFiles) {
      if (sourceFile.startsWith(join(repositoryRoot, "packages", "scheduler"))) {
        continue;
      }

      const source = await readFile(sourceFile, "utf8");
      if (source.includes("ts-fsrs")) {
        violations.push(sourceFile.slice(repositoryRoot.length + 1));
      }
    }

    expect(violations).toEqual([]);
  });

  it("serializes only the stable application-owned scheduling shape", () => {
    const nowMs = Date.parse("2026-07-28T10:00:00.000Z");
    const outcome = applyRating(createInitialState(nowMs), 3, {
      nowMs,
      studyDay: {
        timeZone: "UTC",
        boundaryMinutes: 0,
      },
      settings: DEFAULT_SCHEDULER_SETTINGS,
      weights: FSRS6_MANIFEST.defaultWeights,
      parameterProfileId: "official-defaults",
    });
    const serialized = JSON.stringify(outcome);

    expect(Object.keys(outcome).sort()).toEqual([
      "dueAtMs",
      "rating",
      "retrievabilityBefore",
      "state",
    ]);
    expect(Object.keys(outcome.state).sort()).toEqual([
      "difficulty",
      "dueAtMs",
      "elapsedDaysAtLastReview",
      "lapses",
      "lastReviewAtMs",
      "memoryState",
      "repetitions",
      "revision",
      "scheduledDays",
      "schemaVersion",
      "stability",
      "stepIndex",
    ]);
    expect(serialized).not.toMatch(
      /\b(?:Again|Hard|Good|Easy|New|Learning|Review|Relearning)\b/,
    );
    expect(serialized).not.toMatch(
      /"(?:due|last_review|elapsed_days|scheduled_days|learning_steps|reps)"/,
    );
  });
});
