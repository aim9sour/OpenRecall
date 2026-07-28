import type { ReplayAdapter } from "@openrecall/domain";
import {
  applyRating,
  createInitialState,
  FSRS6_MANIFEST,
} from "@openrecall/scheduler";

export const currentReplayAdapter: ReplayAdapter = {
  algorithmId: FSRS6_MANIFEST.algorithmId,
  algorithmVersion: FSRS6_MANIFEST.algorithmVersion,
  adapterVersion: FSRS6_MANIFEST.adapterVersion,
  createInitialState,
  applyRating(state, rating, context) {
    return applyRating(state, rating, context).state;
  },
};
