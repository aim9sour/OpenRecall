import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  ComputeParametersOptions,
  TrainingConfig,
} from "@open-spaced-repetition/binding";
import * as binding from "@open-spaced-repetition/binding";
import { OPTIMIZER_TRAINING_MANIFEST } from "./manifest.js";

type ExpectedTrainingKeys =
  | "numEpochs"
  | "batchSize"
  | "seed"
  | "maxSeqLen"
  | "learningRate"
  | "gamma";
type UnknownTrainingKeys = Exclude<keyof TrainingConfig, ExpectedTrainingKeys>;
type MissingTrainingKeys = Exclude<ExpectedTrainingKeys, keyof TrainingConfig>;

type ExpectedComputeOptionKeys =
  | "enableShortTerm"
  | "numRelearningSteps"
  | "trainingConfig"
  | "progress"
  | "timeout";
type UnknownComputeOptionKeys = Exclude<
  keyof ComputeParametersOptions,
  ExpectedComputeOptionKeys
>;
type MissingComputeOptionKeys = Exclude<
  ExpectedComputeOptionKeys,
  keyof ComputeParametersOptions
>;

const optimizerRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(optimizerRoot));
const require = createRequire(import.meta.url);

async function sourceFilesUnder(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFilesUnder(path)));
    } else if (
      [".ts", ".tsx", ".js", ".mjs", ".cjs"].includes(extname(entry.name))
    ) {
      files.push(path);
    }
  }
  return files;
}

describe("optimizer binding upgrade boundary", () => {
  it("requires classification when the runtime export surface changes", () => {
    expect(Object.keys(binding).sort()).toEqual([
      "BindingItemState",
      "BindingMemoryState",
      "BindingNextStates",
      "FSRS",
      "FSRSBinding",
      "FSRSBindingItem",
      "FSRSBindingReview",
      "FSRSItem",
      "FSRSReview",
      "ItemState",
      "MemoryState",
      "NextStates",
      "computeOptimalSteps",
      "computeParameters",
      "convertCsvToFsrsItems",
      "evaluateWithTimeSeriesSplits",
    ].sort());
  });

  it("requires a product decision for every upstream option and version change", async () => {
    const noUnknownTrainingKeys: UnknownTrainingKeys extends never ? true : never = true;
    const noMissingTrainingKeys: MissingTrainingKeys extends never ? true : never = true;
    const noUnknownComputeKeys: UnknownComputeOptionKeys extends never ? true : never = true;
    const noMissingComputeKeys: MissingComputeOptionKeys extends never ? true : never = true;

    expect([
      noUnknownTrainingKeys,
      noMissingTrainingKeys,
      noUnknownComputeKeys,
      noMissingComputeKeys,
    ]).toEqual([true, true, true, true]);
    const bindingEntry = require.resolve("@open-spaced-repetition/binding");
    const bindingPackage = JSON.parse(
      await readFile(join(dirname(dirname(bindingEntry)), "package.json"), "utf8"),
    ) as { version: string };
    expect(bindingPackage.version).toBe("0.5.0");
    expect(OPTIMIZER_TRAINING_MANIFEST.upstreamVersion).toBe(bindingPackage.version);
  });

  it("keeps every binding import and constructor inside packages/optimizer", async () => {
    const roots = [
      join(repositoryRoot, "apps"),
      join(repositoryRoot, "packages"),
    ];
    const sourceFiles = (await Promise.all(roots.map(sourceFilesUnder))).flat();
    const violations: string[] = [];
    const bindingPackage = ["@open-spaced-repetition", "binding"].join("/");

    for (const sourceFile of sourceFiles) {
      if (sourceFile.startsWith(optimizerRoot)) continue;
      const source = await readFile(sourceFile, "utf8");
      const importsBinding = new RegExp(
        String.raw`(?:from\s*|import\s*\()\s*["']${bindingPackage}`,
      ).test(source);
      if (
        importsBinding ||
        source.includes("FSRSBindingReview") ||
        source.includes("FSRSBindingItem")
      ) {
        violations.push(relative(repositoryRoot, sourceFile));
      }
    }

    expect(violations).toEqual([]);
  });
});
