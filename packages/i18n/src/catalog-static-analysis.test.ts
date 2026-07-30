import {
  readFileSync,
  readdirSync,
  type Dirent,
} from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATALOG_KEYS,
  catalogResourceKeys,
  localeDefinitions,
} from "./index.js";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(
    (entry: Dirent) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "node_modules" || entry.name === "dist"
          ? []
          : sourceFiles(path);
      }
      return /\.(?:ts|tsx|mts)$/.test(entry.name) &&
        !/\.test\.(?:ts|tsx)$/.test(entry.name)
        ? [path]
        : [];
    },
  );
}

function applicationSources(): readonly string[] {
  const root = process.cwd();
  return [
    ...sourceFiles(resolve(root, "apps")),
    ...sourceFiles(resolve(root, "packages")),
  ].filter(
    (path) => !path.includes(`${join("packages", "i18n", "src")}`),
  );
}

describe("catalog static analysis", () => {
  it("registers every literal translation key and no unused required key", () => {
    const sources = applicationSources().map((path) =>
      readFileSync(path, "utf8"),
    );
    const directKeys = new Set<string>();
    const dynamicPrefixes = new Set<string>();

    for (const source of sources) {
      for (const match of source.matchAll(
        /\bt\s*\(\s*["']([^"']+)["']/g,
      )) {
        directKeys.add(match[1]!);
      }
      for (const match of source.matchAll(
        /\bt\s*\(\s*`([^`$]*)\$\{/g,
      )) {
        dynamicPrefixes.add(match[1]!);
      }
    }

    const required = new Set<string>(CATALOG_KEYS);
    expect(
      [...directKeys].filter((key) => !required.has(key)).sort(),
    ).toEqual([]);

    const combinedSource = sources.join("\n");
    expect(
      CATALOG_KEYS.filter(
        (key) =>
          !combinedSource.includes(JSON.stringify(key)) &&
          !combinedSource.includes(`'${key}'`) &&
          ![...dynamicPrefixes].some((prefix) =>
            key.startsWith(prefix),
          ),
      ),
    ).toEqual([]);
  });

  it("keeps production catalogs exact, nonempty, distinct, and directional", () => {
    const englishResources: Readonly<Record<string, string>> =
      localeDefinitions.en.resources;
    const arabicResources: Readonly<Record<string, string>> =
      localeDefinitions.ar.resources;
    expect(localeDefinitions.ar).toMatchObject({
      tag: "ar",
      direction: "rtl",
      formatLocale: "ar-EG-u-nu-arab",
    });
    expect(localeDefinitions.en).toMatchObject({
      tag: "en",
      direction: "ltr",
      formatLocale: "en-US",
    });

    for (const key of catalogResourceKeys("en")) {
      const english = englishResources[key]?.trim();
      const arabicKey = catalogResourceKeys("ar").includes(key)
        ? key
        : null;
      const arabic =
        arabicKey === null
          ? undefined
          : arabicResources[arabicKey]?.trim();
      expect(english, `missing English ${key}`).not.toBe("");
      if (!key.startsWith("review.joined_")) {
        expect(arabic, `missing Arabic ${key}`).not.toBe("");
        expect(arabic, `untranslated Arabic ${key}`).not.toBe(
          english,
        );
      }
    }
    for (const key of catalogResourceKeys("ar")) {
      expect(
        arabicResources[key]?.trim(),
        `missing Arabic ${key}`,
      ).not.toBe("");
    }

    for (const [tag, definition] of Object.entries(
      localeDefinitions,
    )) {
      const expected = catalogResourceKeys(
        tag as keyof typeof localeDefinitions,
      );
      expect(Object.keys(definition.resources).sort()).toEqual(
        [...expected].sort(),
      );
    }
  });
});
