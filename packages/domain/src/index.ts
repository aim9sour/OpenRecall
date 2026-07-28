export { containsMarkup } from "./import/detect-markup.js";
export {
  duplicateKey,
  normalizedDuplicateText,
  normalizeText,
} from "./import/normalize.js";
export {
  validateImportJson,
  type AcceptedImportItem,
  type AcceptedPresentation,
  type DuplicateKeySet,
  type ValidatedImportPreview,
} from "./import/validate-import.js";
export {
  fromSchedulerDate,
  studyDayDelta,
  toSchedulerDate,
} from "./time/scheduler-clock.js";
export type { StudyDayConfig } from "./time/types.js";
export {
  cryptoRandomIndex,
  selectPresentation,
  type PresentationCandidate,
  type PresentationId,
  type RandomIndex,
} from "./rotation/select-presentation.js";
