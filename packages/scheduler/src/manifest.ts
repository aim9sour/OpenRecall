import type {
  SchedulerControl,
  SchedulerSettings,
} from "@openrecall/contracts";

export const DEFAULT_SCHEDULER_SETTINGS: SchedulerSettings = {
  requestedRetention: 0.9,
  maximumIntervalDays: 36_500,
  enableFuzz: false,
  enableShortTerm: true,
  learningStepsMinutes: [1, 10],
  relearningStepsMinutes: [10],
};

export const SCHEDULER_CONTROLS = [
  {
    key: "requestedRetention",
    kind: "number",
    labelKey: "settings.scheduler.requestedRetention.label",
    descriptionKey: "settings.scheduler.requestedRetention.description",
    defaultValue: DEFAULT_SCHEDULER_SETTINGS.requestedRetention,
    min: 0.8,
    max: 0.95,
    step: 0.01,
    deprecated: false,
  },
  {
    key: "maximumIntervalDays",
    kind: "integer",
    labelKey: "settings.scheduler.maximumIntervalDays.label",
    descriptionKey: "settings.scheduler.maximumIntervalDays.description",
    defaultValue: DEFAULT_SCHEDULER_SETTINGS.maximumIntervalDays,
    min: 1,
    max: 36_500,
    step: 1,
    deprecated: false,
  },
  {
    key: "enableFuzz",
    kind: "boolean",
    labelKey: "settings.scheduler.enableFuzz.label",
    descriptionKey: "settings.scheduler.enableFuzz.description",
    defaultValue: DEFAULT_SCHEDULER_SETTINGS.enableFuzz,
    deprecated: false,
  },
  {
    key: "enableShortTerm",
    kind: "boolean",
    labelKey: "settings.scheduler.enableShortTerm.label",
    descriptionKey: "settings.scheduler.enableShortTerm.description",
    defaultValue: DEFAULT_SCHEDULER_SETTINGS.enableShortTerm,
    deprecated: false,
  },
  {
    key: "learningStepsMinutes",
    kind: "steps",
    labelKey: "settings.scheduler.learningStepsMinutes.label",
    descriptionKey: "settings.scheduler.learningStepsMinutes.description",
    defaultValue: DEFAULT_SCHEDULER_SETTINGS.learningStepsMinutes,
    maxMinutes: 1_439,
    deprecated: false,
  },
  {
    key: "relearningStepsMinutes",
    kind: "steps",
    labelKey: "settings.scheduler.relearningStepsMinutes.label",
    descriptionKey: "settings.scheduler.relearningStepsMinutes.description",
    defaultValue: DEFAULT_SCHEDULER_SETTINGS.relearningStepsMinutes,
    maxMinutes: 1_439,
    deprecated: false,
  },
] as const satisfies readonly SchedulerControl[];

export const FSRS6_MANIFEST = {
  algorithm: "FSRS-6",
  algorithmId: "FSRS-6",
  algorithmVersion: "6.0",
  upstreamPackage: "ts-fsrs@5.4.1",
  adapterVersion: 1,
  adapterSchemaVersion: 1,
  controls: SCHEDULER_CONTROLS,
  defaultWeights: [
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722,
    0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729,
    0.5425, 0.0912, 0.0658, 0.1542,
  ] as const,
} as const;
