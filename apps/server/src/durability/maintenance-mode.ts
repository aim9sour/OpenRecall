export interface MaintenanceLease {
  completeRestore(): void;
  release(): void;
}

export class MaintenanceMode {
  #activeToken: symbol | null = null;
  #revision = 1;

  get active(): boolean {
    return this.#activeToken !== null;
  }

  get revision(): number {
    return this.#revision;
  }

  acquire(expectedRevision = this.#revision): MaintenanceLease {
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 1 ||
      expectedRevision !== this.#revision
    ) {
      throw new Error("RESTORE_REVISION_CONFLICT");
    }
    if (this.#activeToken !== null) {
      throw new Error("MAINTENANCE_MODE");
    }
    const token = Symbol("maintenance-owner");
    this.#activeToken = token;
    let released = false;
    const release = () => {
      if (released) return;
      if (this.#activeToken !== token) {
        throw new Error("MAINTENANCE_LEASE_INVALID");
      }
      released = true;
      this.#activeToken = null;
    };
    return {
      completeRestore: () => {
        if (released || this.#activeToken !== token) {
          throw new Error("MAINTENANCE_LEASE_INVALID");
        }
        this.#revision += 1;
        release();
      },
      release,
    };
  }
}
