export { toBindingItems } from "./binding-adapter.js";
export { buildTrainingSet } from "./build-training-set.js";
export {
  trainOptimizer,
  type TrainOptimizerInput,
} from "./optimizer-client.js";
export {
  validateOptimizerOutput,
  type OptimizerResult,
} from "./validate-output.js";
export type {
  OptimizerExample,
  OptimizerReview,
  OptimizerScope,
  StoredOptimizerReview,
  TrainingSetSummary,
} from "./types.js";
