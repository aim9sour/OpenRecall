import type { OptimizerScope } from "@openrecall/contracts";

export interface OptimizerJobIdentity {
  readonly id: string;
  readonly kind: "training" | "step-recommendation";
  readonly scope: OptimizerScope;
  readonly cancel: () => void;
  readonly settled: Promise<void>;
}

export class OptimizerJobCoordinator {
  readonly #sectionDeletionGateCounts = new Map<string, number>();
  #active: OptimizerJobIdentity | null = null;

  get active(): OptimizerJobIdentity | null {
    return this.#active;
  }

  acquire(job: OptimizerJobIdentity): () => void {
    if (this.#active !== null) throw new Error("OPTIMIZER_RUN_CONFLICT");
    if (this.#scopeBlocked(job.scope)) {
      throw new Error("OPTIMIZER_SECTION_DELETION_IN_PROGRESS");
    }
    this.#active = job;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.#active?.id === job.id) this.#active = null;
    };
  }

  async quiesceForSectionDeletion(sectionId: string): Promise<() => void> {
    if (sectionId.trim().length === 0) {
      throw new Error("OPTIMIZER_SECTION_ID_INVALID");
    }
    this.#sectionDeletionGateCounts.set(
      sectionId,
      (this.#sectionDeletionGateCounts.get(sectionId) ?? 0) + 1,
    );
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const count = this.#sectionDeletionGateCounts.get(sectionId) ?? 0;
      if (count <= 1) this.#sectionDeletionGateCounts.delete(sectionId);
      else this.#sectionDeletionGateCounts.set(sectionId, count - 1);
    };
    try {
      const active = this.#active;
      if (
        active !== null &&
        (active.scope.scopeType === "global" || active.scope.sectionId === sectionId)
      ) {
        active.cancel();
        await active.settled;
      }
      return release;
    } catch (error) {
      release();
      throw error;
    }
  }

  async whenIdle(): Promise<void> {
    await this.#active?.settled;
  }

  cancelActive(): void {
    this.#active?.cancel();
  }

  #scopeBlocked(scope: OptimizerScope): boolean {
    return scope.scopeType === "global"
      ? this.#sectionDeletionGateCounts.size > 0
      : this.#sectionDeletionGateCounts.has(scope.sectionId);
  }
}
