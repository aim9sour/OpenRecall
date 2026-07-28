import type { SchedulerSettingsV1 } from "./types.js";

export type UpstreamStepString = `${number}m` | `${number}h`;

function validateSteps(steps: number[], fieldName: string): void {
  if (!Array.isArray(steps)) {
    throw new TypeError(`${fieldName} must be an array.`);
  }

  let previous = 0;
  for (const step of steps) {
    if (
      !Number.isInteger(step) ||
      step <= 0 ||
      step >= 1440 ||
      step <= previous
    ) {
      throw new RangeError(
        `${fieldName} must contain strictly increasing whole minutes from 1 through 1439.`,
      );
    }
    previous = step;
  }
}

export function validateSchedulerSettings(
  settings: SchedulerSettingsV1,
): SchedulerSettingsV1 {
  if (
    !Number.isFinite(settings.requestedRetention) ||
    settings.requestedRetention <= 0 ||
    settings.requestedRetention > 1
  ) {
    throw new RangeError("Requested retention must be in the range (0, 1].");
  }

  if (
    !Number.isInteger(settings.maximumIntervalDays) ||
    settings.maximumIntervalDays <= 0
  ) {
    throw new RangeError("Maximum interval days must be a positive integer.");
  }

  if (
    typeof settings.enableFuzz !== "boolean" ||
    typeof settings.enableShortTerm !== "boolean"
  ) {
    throw new TypeError("Scheduler feature flags must be boolean values.");
  }

  validateSteps(settings.learningStepsMinutes, "Learning steps");
  validateSteps(settings.relearningStepsMinutes, "Relearning steps");

  return {
    ...settings,
    learningStepsMinutes: [...settings.learningStepsMinutes],
    relearningStepsMinutes: [...settings.relearningStepsMinutes],
  };
}

export function toUpstreamStepStrings(
  steps: number[],
): UpstreamStepString[] {
  validateSteps(steps, "Scheduler steps");

  return steps.map(
    (minutes): UpstreamStepString =>
      minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`,
  );
}
