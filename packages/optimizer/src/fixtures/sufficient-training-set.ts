import type { OptimizerExample } from "../types.js";

export const sufficientTrainingSet: readonly OptimizerExample[] =
  Array.from({ length: 480 }, (_, index) => ({
    learningItemId: `fixture-item-${Math.floor(index / 4)}`,
    targetReviewLogId: `fixture-log-${index}`,
    reviews: [
      { rating: 3 as const, deltaDays: 0 },
      {
        rating: ((index % 4) + 1) as 1 | 2 | 3 | 4,
        deltaDays: (index % 17) + 1,
      },
      {
        rating: (((index + 2) % 4) + 1) as 1 | 2 | 3 | 4,
        deltaDays: (index % 29) + 1,
      },
    ],
  }));
