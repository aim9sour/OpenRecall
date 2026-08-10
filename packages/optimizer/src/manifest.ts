import type {
  OptimizerTrainingConfig,
  OptimizerTrainingManifest,
  OptimizerTrainingSettings,
  OptimizerSettingsSource,
} from "@openrecall/contracts";

export const OFFICIAL_OPTIMIZER_TRAINING_CONFIG = {
  numEpochs: 5,
  batchSize: 512,
  seed: 2023,
  maxSeqLen: 256,
  learningRate: 0.04,
  gamma: 1,
} as const satisfies OptimizerTrainingConfig;

export const DEFAULT_OPTIMIZER_TRAINING_SETTINGS = {
  numEpochs: OFFICIAL_OPTIMIZER_TRAINING_CONFIG.numEpochs,
  batchSize: OFFICIAL_OPTIMIZER_TRAINING_CONFIG.batchSize,
  maxSeqLen: OFFICIAL_OPTIMIZER_TRAINING_CONFIG.maxSeqLen,
} as const satisfies OptimizerTrainingSettings;

export const OPTIMIZER_TRAINING_MANIFEST = {
  upstreamPackage: "@open-spaced-repetition/binding",
  upstreamVersion: "0.5.0",
  fsrsCoreVersion: "FSRS-6",
  algorithmVersion: "6.0",
  adapterVersion: 2,
  schemaVersion: 1,
  controls: [
    {
      key: "numEpochs",
      labelKey: "settings.optimizer.numEpochs.label",
      descriptionKey: "settings.optimizer.numEpochs.description",
      choices: [3, 5, 7, 10],
      defaultValue: 5,
      deprecated: false,
    },
    {
      key: "batchSize",
      labelKey: "settings.optimizer.batchSize.label",
      descriptionKey: "settings.optimizer.batchSize.description",
      choices: [128, 256, 512, 1024],
      defaultValue: 512,
      deprecated: false,
    },
    {
      key: "maxSeqLen",
      labelKey: "settings.optimizer.maxSeqLen.label",
      descriptionKey: "settings.optimizer.maxSeqLen.description",
      choices: [64, 128, 256, 512],
      defaultValue: 256,
      deprecated: false,
    },
  ],
  readOnly: { seed: 2023, learningRate: 0.04, gamma: 1 },
  capabilities: [
    { key: "weights", classification: "managed" },
    { key: "enableShortTerm", classification: "derived" },
    { key: "numRelearningSteps", classification: "derived" },
    { key: "computeParameters", classification: "tool" },
    { key: "evaluateWithTimeSeriesSplits", classification: "tool" },
    { key: "computeOptimalSteps", classification: "tool" },
    { key: "progress", classification: "internal" },
    { key: "timeout", classification: "internal" },
    { key: "convertCsvToFsrsItems", classification: "internal" },
    { key: "dynamicWasi", classification: "internal" },
    { key: "bindingClasses", classification: "internal" },
    { key: "FSRSBinding.nextStates", classification: "internal" },
    { key: "FSRSBinding.evaluate", classification: "internal" },
    { key: "FSRSBinding.memoryStateFromSM2", classification: "internal" },
    { key: "FSRSBinding.universalMetrics", classification: "internal" },
  ],
} as const satisfies OptimizerTrainingManifest;

export interface EffectiveOptimizerTrainingSettings {
  readonly settings: OptimizerTrainingSettings;
  readonly source: OptimizerSettingsSource;
}

export function resolveOptimizerTrainingConfig(
  settings: OptimizerTrainingSettings,
): OptimizerTrainingConfig {
  return { ...OFFICIAL_OPTIMIZER_TRAINING_CONFIG, ...settings };
}
