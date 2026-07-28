import {
  FSRSBindingItem,
  FSRSBindingReview,
} from "@open-spaced-repetition/binding";
import type { OptimizerExample } from "./types.js";

export function toBindingItems(
  examples: readonly OptimizerExample[],
): FSRSBindingItem[] {
  return examples.map(
    (example) =>
      new FSRSBindingItem(
        example.reviews.map(
          (review) =>
            new FSRSBindingReview(review.rating, review.deltaDays),
        ),
      ),
  );
}
