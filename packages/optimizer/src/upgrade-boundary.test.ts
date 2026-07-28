import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const optimizerRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(optimizerRoot));

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
      if (
        source.includes(bindingPackage) ||
        source.includes("FSRSBindingReview") ||
        source.includes("FSRSBindingItem")
      ) {
        violations.push(relative(repositoryRoot, sourceFile));
      }
    }

    expect(violations).toEqual([]);
  });
});
