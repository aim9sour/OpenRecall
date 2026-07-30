import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_ROOTS = ["apps", "packages", "scripts"];
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const LOOPBACK_TEMPLATE = "http:" + "//${host}:${port}";
const STATIC_PARSER_ORIGIN = "http:" + "//openrecall.invalid";
const EXCLUDED_DIRECTORIES = new Set([
  "assets",
  "dist",
  "node_modules",
  "public",
]);
const ADAPTER_IMPORTS = new Map([
  [
    "ts-fsrs",
    new Set(["packages/scheduler/src/fsrs6-adapter.ts"]),
  ],
  [
    "@open-spaced-repetition/binding",
    new Set([
      "packages/optimizer/src/binding-adapter.ts",
      "packages/optimizer/src/optimizer-worker.ts",
    ]),
  ],
]);

function portablePath(root, path) {
  return relative(root, path).replaceAll("\\", "/");
}

async function sourceFiles(root, directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) return [];
      if (entry.isDirectory()) {
        return EXCLUDED_DIRECTORIES.has(entry.name)
          ? []
          : sourceFiles(root, path);
      }
      if (
        !SOURCE_EXTENSIONS.has(extname(entry.name)) ||
        /\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(entry.name)
      ) {
        return [];
      }
      return [path];
    }),
  );
  return nested.flat();
}

function importsPackage(source, packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    String.raw`(?:from\s*|import\s*|import\s*\(\s*|require\s*\(\s*)["']${escaped}(?:/[^"']*)?["']`,
    "u",
  ).test(source);
}

function assertAdapterImports(source, path) {
  for (const [packageName, allowedPaths] of ADAPTER_IMPORTS) {
    if (importsPackage(source, packageName) && !allowedPaths.has(path)) {
      throw new Error(`ADAPTER_IMPORT_FORBIDDEN:${path}`);
    }
  }
}

function isAllowedRuntimeUrl(rawUrl, path) {
  if (rawUrl.includes("${")) {
    return (
      path === "apps/server/src/startup/single-instance.ts" &&
      rawUrl === LOOPBACK_TEMPLATE
    );
  }
  if (rawUrl === STATIC_PARSER_ORIGIN) {
    return path === "apps/server/src/production/static-client.ts";
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  return url.protocol === "http:" && url.hostname === "127.0.0.1";
}

function assertRuntimeUrls(source, path) {
  const matches = source.matchAll(/https?:\/\/[^\s"'`<>)\\]+/gu);
  for (const match of matches) {
    const rawUrl = match[0].replace(/[.,;:]$/u, "");
    if (!isAllowedRuntimeUrl(rawUrl, path)) {
      throw new Error(`RUNTIME_EXTERNAL_URL_FORBIDDEN:${path}`);
    }
  }
}

export async function checkAdapterBoundaries(root = process.cwd()) {
  const repositoryRoot = resolve(root);
  const files = (
    await Promise.all(
      SOURCE_ROOTS.map((directory) =>
        sourceFiles(
          repositoryRoot,
          resolve(repositoryRoot, directory),
        ),
      ),
    )
  ).flat();

  for (const file of files) {
    const path = portablePath(repositoryRoot, file);
    const source = await readFile(file, "utf8");
    assertAdapterImports(source, path);
    assertRuntimeUrls(source, path);
  }
}

const invokedPath =
  process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  checkAdapterBoundaries()
    .then(() => {
      process.stdout.write("OPENRECALL_ADAPTER_BOUNDARIES_OK\n");
    })
    .catch((error) => {
      const diagnostic =
        error instanceof Error
          ? error.message
          : "ADAPTER_BOUNDARY_CHECK_FAILED";
      process.stderr.write(`${diagnostic}\n`);
      process.exitCode = 1;
    });
}
