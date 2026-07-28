import { randomBytes } from "node:crypto";

export type PresentationId = string;

export interface PresentationCandidate {
  readonly id: PresentationId;
  readonly lastShownAtMs: number | null;
  readonly showCount: number;
}

export type RandomIndex = (maxExclusive: number) => number;

const UINT32_RANGE = 0x1_0000_0000;

export function cryptoRandomIndex(maxExclusive: number): number {
  if (
    !Number.isSafeInteger(maxExclusive) ||
    maxExclusive <= 0 ||
    maxExclusive > UINT32_RANGE
  ) {
    throw new RangeError("Random index bound must be from 1 through 2^32.");
  }

  const unbiasedLimit =
    Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;

  for (;;) {
    const sample = randomBytes(4).readUInt32BE(0);
    if (sample < unbiasedLimit) {
      return sample % maxExclusive;
    }
  }
}

function validateCandidates(
  candidates: readonly PresentationCandidate[],
): void {
  if (candidates.length === 0) {
    throw new RangeError("At least one presentation candidate is required.");
  }

  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (
      candidate.id.length === 0 ||
      ids.has(candidate.id) ||
      !Number.isSafeInteger(candidate.showCount) ||
      candidate.showCount < 0 ||
      (candidate.lastShownAtMs !== null &&
        !Number.isSafeInteger(candidate.lastShownAtMs))
    ) {
      throw new RangeError("Presentation candidates are invalid.");
    }
    ids.add(candidate.id);
  }
}

export function selectPresentation(
  candidates: readonly PresentationCandidate[],
  randomIndex: RandomIndex = cryptoRandomIndex,
): PresentationId {
  validateCandidates(candidates);

  if (candidates.length === 1) {
    return candidates[0]!.id;
  }

  let eligible = [...candidates];
  const shown = eligible.filter(
    (candidate) => candidate.lastShownAtMs !== null,
  );
  if (shown.length > 0) {
    const mostRecentAtMs = Math.max(
      ...shown.map((candidate) => candidate.lastShownAtMs!),
    );
    const mostRecent = shown.filter(
      (candidate) => candidate.lastShownAtMs === mostRecentAtMs,
    );
    if (mostRecent.length === 1) {
      eligible = eligible.filter(
        (candidate) => candidate.id !== mostRecent[0]!.id,
      );
    }
  }

  const hasNeverShown = eligible.some(
    (candidate) => candidate.lastShownAtMs === null,
  );
  if (hasNeverShown) {
    eligible = eligible.filter(
      (candidate) => candidate.lastShownAtMs === null,
    );
  } else {
    const oldestAtMs = Math.min(
      ...eligible.map((candidate) => candidate.lastShownAtMs!),
    );
    eligible = eligible.filter(
      (candidate) => candidate.lastShownAtMs === oldestAtMs,
    );
  }

  const lowestShowCount = Math.min(
    ...eligible.map((candidate) => candidate.showCount),
  );
  const tied = eligible.filter(
    (candidate) => candidate.showCount === lowestShowCount,
  );

  if (tied.length === 1) {
    return tied[0]!.id;
  }

  const selectedIndex = randomIndex(tied.length);
  if (
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= tied.length
  ) {
    throw new RangeError("Random index returned an out-of-range value.");
  }

  return tied[selectedIndex]!.id;
}
