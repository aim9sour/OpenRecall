import { describe, expect, it } from "vitest";
import { OptimizerJobCoordinator } from "./optimizer-job-coordinator.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("OptimizerJobCoordinator", () => {
  it("allows only one CPU-heavy job and releases by matching identity", () => {
    const coordinator = new OptimizerJobCoordinator();
    const settled = Promise.resolve();
    const release = coordinator.acquire({
      id: "training-a",
      kind: "training",
      scope: { scopeType: "global", sectionId: null },
      cancel() {},
      settled,
    });
    expect(() => coordinator.acquire({
      id: "step-b",
      kind: "step-recommendation",
      scope: { scopeType: "section", sectionId: "section-b" },
      cancel() {},
      settled,
    })).toThrow("OPTIMIZER_RUN_CONFLICT");
    release();
    expect(() => coordinator.acquire({
      id: "step-b",
      kind: "step-recommendation",
      scope: { scopeType: "section", sectionId: "section-b" },
      cancel() {},
      settled,
    })).not.toThrow();
  });

  it("cancels affected work, waits, and blocks matching/global jobs until release", async () => {
    const coordinator = new OptimizerJobCoordinator();
    const work = deferred();
    let cancelled = false;
    const releaseJob = coordinator.acquire({
      id: "training-a",
      kind: "training",
      scope: { scopeType: "section", sectionId: "section-a" },
      cancel() { cancelled = true; },
      settled: work.promise,
    });
    const gatePromise = coordinator.quiesceForSectionDeletion("section-a");
    expect(cancelled).toBe(true);
    work.resolve();
    releaseJob();
    const releaseGate = await gatePromise;
    const job = {
      id: "next",
      kind: "training" as const,
      cancel() {},
      settled: Promise.resolve(),
    };
    expect(() => coordinator.acquire({ ...job, scope: { scopeType: "global", sectionId: null } })).toThrow("OPTIMIZER_SECTION_DELETION_IN_PROGRESS");
    expect(() => coordinator.acquire({ ...job, scope: { scopeType: "section", sectionId: "section-a" } })).toThrow("OPTIMIZER_SECTION_DELETION_IN_PROGRESS");
    releaseGate();
    expect(() => coordinator.acquire({ ...job, scope: { scopeType: "section", sectionId: "section-a" } })).not.toThrow();
  });
});
