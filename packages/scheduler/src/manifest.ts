import type { SchedulerSettingsV1 } from "./types.js";

export const DEFAULT_SCHEDULER_SETTINGS: SchedulerSettingsV1 = {
  requestedRetention: 0.9,
  maximumIntervalDays: 36_500,
  enableFuzz: false,
  enableShortTerm: true,
  learningStepsMinutes: [1, 10],
  relearningStepsMinutes: [10],
};

export const FSRS6_MANIFEST = {
  algorithm: "FSRS-6",
  upstreamPackage: "ts-fsrs@5.4.1",
  adapterSchemaVersion: 1,
  defaultWeights: [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722,
    0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729,
    0.5425, 0.0912, 0.0658, 0.1542,
  ] as const,
} as const;
