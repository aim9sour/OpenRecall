import { describe, expect, it } from "vitest";
import { MaintenanceMode } from "./maintenance-mode.js";

describe("MaintenanceMode", () => {
  it("allows one owner, rejects stale revisions, and advances only after a completed restore", () => {
    const maintenance = new MaintenanceMode();
    expect(maintenance.revision).toBe(1);
    expect(maintenance.active).toBe(false);

    expect(() => maintenance.acquire(0)).toThrow(
      "RESTORE_REVISION_CONFLICT",
    );
    const lease = maintenance.acquire(1);
    expect(maintenance.active).toBe(true);
    expect(() => maintenance.acquire(1)).toThrow("MAINTENANCE_MODE");

    lease.release();
    expect(maintenance.active).toBe(false);
    expect(maintenance.revision).toBe(1);

    const completed = maintenance.acquire(1);
    completed.completeRestore();
    expect(maintenance.active).toBe(false);
    expect(maintenance.revision).toBe(2);
    expect(() => completed.release()).not.toThrow();
  });
});
