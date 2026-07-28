export type ReviewSessionStatus =
  | "active"
  | "waiting"
  | "paused"
  | "completed";

export interface ReviewSessionSnapshot {
  readonly id: string;
  readonly sectionId: string;
  readonly status: ReviewSessionStatus;
  readonly revision: number;
  readonly completedAppearances: number;
  readonly currentlyRemaining: number;
  readonly newRemaining: number;
  readonly repeatedWithinSession: number;
  readonly elapsedActiveMs: number;
  readonly newlyJoined: number;
  readonly nextDueAtMs: number | null;
  readonly remainingSnapshotAtMs: number;
}
