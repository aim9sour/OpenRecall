import {
  OptimizerTrainingConfigSchema,
  OptimizerTrainingSettingsSchema,
  type OptimizerTrainingConfig,
  type OptimizerTrainingSettings,
} from "@openrecall/contracts";
import { Value } from "typebox/value";

export function validateOptimizerTrainingSettings(
  value: unknown,
): OptimizerTrainingSettings {
  if (!Value.Check(OptimizerTrainingSettingsSchema, value)) {
    throw new Error("OPTIMIZER_TRAINING_SETTINGS_INVALID");
  }
  return value;
}

export function validateOptimizerTrainingConfig(
  value: unknown,
): OptimizerTrainingConfig {
  if (!Value.Check(OptimizerTrainingConfigSchema, value)) {
    throw new Error("OPTIMIZER_TRAINING_CONFIG_INVALID");
  }
  return value;
}
