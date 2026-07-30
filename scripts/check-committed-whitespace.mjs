import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const COMMIT_ID = /^[0-9a-f]{7,64}$/iu;

export function committedWhitespaceArgs(baseCommit) {
  const normalizedBase = baseCommit?.trim();
  if (normalizedBase === undefined || normalizedBase === "") {
    return [
      "diff-tree",
      "--check",
      "--no-commit-id",
      "--root",
      "-r",
      "HEAD",
    ];
  }
  if (!COMMIT_ID.test(normalizedBase)) {
    throw new Error("OPENRECALL_DIFF_BASE_INVALID");
  }
  return ["diff", "--check", `${normalizedBase}...HEAD`];
}

export function checkCommittedWhitespace({
  baseCommit = process.env["OPENRECALL_DIFF_BASE"],
  root = process.cwd(),
} = {}) {
  const result = spawnSync(
    "git",
    committedWhitespaceArgs(baseCommit),
    {
      cwd: resolve(root),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.error !== undefined) {
    throw new Error("GIT_WHITESPACE_CHECK_UNAVAILABLE", {
      cause: result.error,
    });
  }
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error("COMMITTED_WHITESPACE_INVALID");
  }
}

const invokedPath =
  process.argv[1] === undefined ? "" : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    checkCommittedWhitespace();
    process.stdout.write("OPENRECALL_COMMITTED_WHITESPACE_OK\n");
  } catch (error) {
    const diagnostic =
      error instanceof Error
        ? error.message
        : "COMMITTED_WHITESPACE_CHECK_FAILED";
    process.stderr.write(`${diagnostic}\n`);
    process.exitCode = 1;
  }
}
