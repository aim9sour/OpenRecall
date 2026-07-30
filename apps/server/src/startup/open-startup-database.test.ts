import { describe, expect, it, vi } from "vitest";
import { openStartupDatabase } from "./open-startup-database.js";

describe("openStartupDatabase", () => {
  it("fails closed without invoking restore fallback for an operational open failure", async () => {
    const transient = new Error("TRANSIENT_BACKUP_FAILURE");
    const recoverAfterOpenFailure = vi.fn(async () => true);

    await expect(
      openStartupDatabase({
        recovery: {
          requiresExistingDatabase: true,
          recoverAfterOpenFailure,
        },
        openExisting: vi.fn(async () => {
          throw transient;
        }),
        openFresh: vi.fn(),
        isValidationFailure: () => false,
      }),
    ).rejects.toBe(transient);
    expect(recoverAfterOpenFailure).not.toHaveBeenCalled();
  });

  it("uses the committed-old fallback exactly once for a classified validation failure", async () => {
    const invalid = new Error("DATABASE_INVALID");
    const recoverAfterOpenFailure = vi.fn(async () => true);
    const openExisting = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(invalid)
      .mockResolvedValueOnce("original");

    await expect(
      openStartupDatabase({
        recovery: {
          requiresExistingDatabase: true,
          recoverAfterOpenFailure,
        },
        openExisting,
        openFresh: vi.fn(),
        isValidationFailure: (error) => error === invalid,
      }),
    ).resolves.toBe("original");
    expect(recoverAfterOpenFailure).toHaveBeenCalledOnce();
    expect(openExisting).toHaveBeenCalledTimes(2);
  });
});
