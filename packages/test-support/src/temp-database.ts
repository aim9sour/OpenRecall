import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withTempDatabase(
  testFn: (databasePath: string) => void | Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "openrecall-test-"));
  const databasePath = join(directory, "openrecall.sqlite3");

  try {
    await testFn(databasePath);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
