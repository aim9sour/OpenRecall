import type { SchedulerControl } from "@openrecall/contracts";
import { SCHEDULER_CONTROLS } from "./manifest.js";
import type { SchedulerSettingsV1 } from "./types.js";

export type UpstreamStepString = `${number}m` | `${number}h`;

function control<Key extends SchedulerControl["key"]>(
  key: Key,
): Extract<SchedulerControl, { key: Key }> {
  const value = SCHEDULER_CONTROLS.find((candidate) => candidate.key === key);
  if (value === undefined) throw new Error("SCHEDULER_MANIFEST_INVALID");
  return value as Extract<SchedulerControl, { key: Key }>;
}

function validateSteps(
  steps: unknown,
  fieldName: string,
  maxMinutes: number,
): asserts steps is number[] {
  if (!Array.isArray(steps)) {
    throw new TypeError(`${fieldName} must be an array.`);
  }

  let previous = 0;
  for (const step of steps) {
    if (
      !Number.isInteger(step) ||
      step <= 0 ||
      step > maxMinutes ||
      step <= previous
    ) {
      throw new RangeError(
        `${fieldName} must contain strictly increasing whole minutes from 1 through 1439.`,
      );
    }
    previous = step;
  }
}

export function validateSchedulerSettings(settings: unknown): SchedulerSettingsV1 {
  if (
    typeof settings !== "object" ||
    settings === null ||
    Array.isArray(settings)
  ) {
    throw new TypeError("Scheduler settings must be an object.");
  }
  const value = settings as Record<string, unknown>;
  const supportedKeys = new Set<string>(
    SCHEDULER_CONTROLS.filter(({ deprecated }) => !deprecated).map(
      ({ key }) => key,
    ),
  );
  if (
    Object.keys(value).some((key) => !supportedKeys.has(key)) ||
    [...supportedKeys].some((key) => !(key in value))
  ) {
    throw new TypeError("Scheduler settings contain unsupported properties.");
  }

  const retention = control("requestedRetention");
  if (
    typeof value["requestedRetention"] !== "number" ||
    !Number.isFinite(value["requestedRetention"]) ||
    value["requestedRetention"] < retention.min ||
    value["requestedRetention"] > retention.max
  ) {
    throw new RangeError("Requested retention is outside the manifest bounds.");
  }

  const maximumInterval = control("maximumIntervalDays");
  if (
    !Number.isInteger(value["maximumIntervalDays"]) ||
    (value["maximumIntervalDays"] as number) < maximumInterval.min ||
    (value["maximumIntervalDays"] as number) > maximumInterval.max
  ) {
    throw new RangeError("Maximum interval days are outside the manifest bounds.");
  }

  if (
    typeof value["enableFuzz"] !== "boolean" ||
    typeof value["enableShortTerm"] !== "boolean"
  ) {
    throw new TypeError("Scheduler feature flags must be boolean values.");
  }

  validateSteps(
    value["learningStepsMinutes"],
    "Learning steps",
    control("learningStepsMinutes").maxMinutes,
  );
  validateSteps(
    value["relearningStepsMinutes"],
    "Relearning steps",
    control("relearningStepsMinutes").maxMinutes,
  );

  return {
    requestedRetention: value["requestedRetention"],
    maximumIntervalDays: value["maximumIntervalDays"] as number,
    enableFuzz: value["enableFuzz"],
    enableShortTerm: value["enableShortTerm"],
    learningStepsMinutes: [...value["learningStepsMinutes"]],
    relearningStepsMinutes: [...value["relearningStepsMinutes"]],
  };
}

export function toUpstreamStepStrings(
  steps: number[],
): UpstreamStepString[] {
  validateSteps(steps, "Scheduler steps", 1_439);

  return steps.map(
    (minutes): UpstreamStepString =>
      minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`,
  );
}
