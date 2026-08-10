import type { OptimizerTechnicalInfo } from "@openrecall/contracts";

export const view: OptimizerTechnicalInfo = {
  manifest: {
    upstreamPackage: "@open-spaced-repetition/binding", upstreamVersion: "0.5.0",
    fsrsCoreVersion: "FSRS-6", algorithmVersion: "6.0", adapterVersion: 2, schemaVersion: 1,
    controls: [
      { key: "numEpochs", labelKey: "a", descriptionKey: "b", choices: [3, 5, 7, 10], defaultValue: 5, deprecated: false },
      { key: "batchSize", labelKey: "a", descriptionKey: "b", choices: [128, 256, 512, 1024], defaultValue: 512, deprecated: false },
      { key: "maxSeqLen", labelKey: "a", descriptionKey: "b", choices: [64, 128, 256, 512], defaultValue: 256, deprecated: false },
    ],
    readOnly: { seed: 2023, learningRate: 0.04, gamma: 1 }, capabilities: [],
  },
  officialTrainingConfig: { numEpochs: 5, batchSize: 512, seed: 2023, maxSeqLen: 256, learningRate: 0.04, gamma: 1 },
  parameterSource: { kind: "official", profileId: "official-fsrs6-v1", eligibleExampleCount: 0 },
  activeProfile: {
    profileId: "official-fsrs6-v1", sourceKind: "official", eligibleExampleCount: 0,
    reviewCutoffMs: null, createdAtMs: null, packageVersion: null, metricLogLoss: null, metricRmseBins: null,
  },
};
