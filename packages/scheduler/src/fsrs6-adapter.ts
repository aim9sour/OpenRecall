import {
  fromSchedulerDate,
  studyDayDelta,
  toSchedulerDate,
} from "@openrecall/domain";
import {
  createEmptyCard,
  default_w,
  fsrs,
  generatorParameters,
  Rating as UpstreamRating,
  State as UpstreamState,
  type Card as UpstreamCard,
  type Grade as UpstreamGrade,
} from "ts-fsrs";
import {
  toUpstreamStepStrings,
  validateSchedulerSettings,
} from "./validate-settings.js";
import type {
  MemoryState,
  Rating,
  RatingOutcome,
  ScheduleContext,
  SchedulerStateV1,
} from "./types.js";

const upstreamRatingByStableRating: Record<Rating, UpstreamGrade> = {
  1: UpstreamRating.Again,
  2: UpstreamRating.Hard,
  3: UpstreamRating.Good,
  4: UpstreamRating.Easy,
};

export const upstreamDefaultWeightsForCompatibilityTest = default_w;

function toUpstreamState(memoryState: MemoryState): UpstreamState {
  switch (memoryState) {
    case "new":
      return UpstreamState.New;
    case "learning":
      return UpstreamState.Learning;
    case "review":
      return UpstreamState.Review;
    case "relearning":
      return UpstreamState.Relearning;
  }
}

function fromUpstreamState(state: UpstreamState): MemoryState {
  switch (state) {
    case UpstreamState.New:
      return "new";
    case UpstreamState.Learning:
      return "learning";
    case UpstreamState.Review:
      return "review";
    case UpstreamState.Relearning:
      return "relearning";
  }
}

function validateWeights(weights: readonly number[]): number[] {
  if (
    weights.length !== 21 ||
    weights.some((weight) => !Number.isFinite(weight))
  ) {
    throw new RangeError("FSRS-6 requires exactly 21 finite weights.");
  }

  return [...weights];
}

function createScheduler(context: ScheduleContext) {
  const settings = validateSchedulerSettings(context.settings);
  const parameters = generatorParameters({
    request_retention: settings.requestedRetention,
    maximum_interval: settings.maximumIntervalDays,
    w: validateWeights(context.weights),
    enable_fuzz: settings.enableFuzz,
    enable_short_term: settings.enableShortTerm,
    learning_steps: toUpstreamStepStrings(settings.learningStepsMinutes),
    relearning_steps: toUpstreamStepStrings(settings.relearningStepsMinutes),
  });

  return fsrs(parameters);
}

function toUpstreamCard(
  state: SchedulerStateV1,
  context: ScheduleContext,
): UpstreamCard {
  const card = createEmptyCard(toSchedulerDate(state.dueAtMs, context.studyDay));
  card.due = toSchedulerDate(state.dueAtMs, context.studyDay);
  card.stability = state.stability;
  card.difficulty = state.difficulty;
  card.elapsed_days = state.elapsedDaysAtLastReview;
  card.scheduled_days = state.scheduledDays;
  card.learning_steps = state.stepIndex ?? 0;
  card.reps = state.repetitions;
  card.lapses = state.lapses;
  card.state = toUpstreamState(state.memoryState);

  if (state.lastReviewAtMs !== null) {
    card.last_review = toSchedulerDate(
      state.lastReviewAtMs,
      context.studyDay,
    );
  }

  return card;
}

function fromUpstreamCard(
  card: UpstreamCard,
  context: ScheduleContext,
  revision: number,
): SchedulerStateV1 {
  const memoryState = fromUpstreamState(card.state);

  return {
    schemaVersion: 1,
    dueAtMs: fromSchedulerDate(card.due, context.studyDay),
    memoryState,
    stepIndex:
      memoryState === "learning" || memoryState === "relearning"
        ? card.learning_steps
        : null,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDaysAtLastReview: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    lastReviewAtMs: card.last_review
      ? fromSchedulerDate(card.last_review, context.studyDay)
      : null,
    repetitions: card.reps,
    lapses: card.lapses,
    revision,
  };
}

function outcomeFromCard(
  card: UpstreamCard,
  rating: Rating,
  retrievabilityBefore: number | null,
  previousRevision: number,
  context: ScheduleContext,
): RatingOutcome {
  const state = fromUpstreamCard(card, context, previousRevision + 1);

  return {
    rating,
    state,
    dueAtMs: state.dueAtMs,
    retrievabilityBefore,
  };
}

export function createInitialState(nowMs: number): SchedulerStateV1 {
  if (!Number.isSafeInteger(nowMs)) {
    throw new RangeError("Initial time must be safe epoch milliseconds.");
  }

  return {
    schemaVersion: 1,
    dueAtMs: nowMs,
    memoryState: "new",
    stepIndex: null,
    stability: 0,
    difficulty: 0,
    elapsedDaysAtLastReview: 0,
    scheduledDays: 0,
    lastReviewAtMs: null,
    repetitions: 0,
    lapses: 0,
    revision: 0,
  };
}

export function getRetrievability(
  state: SchedulerStateV1,
  nowMs: number,
  context: ScheduleContext,
): number | null {
  if (state.memoryState === "new") {
    return null;
  }

  if (state.lastReviewAtMs === null || state.stability <= 0) {
    throw new RangeError(
      "A scheduled memory state requires a last review and positive stability.",
    );
  }

  const scheduler = createScheduler(context);
  const elapsedStudyDays = studyDayDelta(
    state.lastReviewAtMs,
    nowMs,
    context.studyDay,
  );

  return scheduler.forgetting_curve(
    elapsedStudyDays,
    Number(state.stability.toFixed(8)),
  );
}

export function previewRatings(
  state: SchedulerStateV1,
  context: ScheduleContext,
): Record<Rating, RatingOutcome> {
  const scheduler = createScheduler(context);
  const card = toUpstreamCard(state, context);
  const now = toSchedulerDate(context.nowMs, context.studyDay);
  const retrievabilityBefore = getRetrievability(
    state,
    context.nowMs,
    context,
  );
  const preview = scheduler.repeat(card, now);

  return {
    1: outcomeFromCard(
      preview[UpstreamRating.Again].card,
      1,
      retrievabilityBefore,
      state.revision,
      context,
    ),
    2: outcomeFromCard(
      preview[UpstreamRating.Hard].card,
      2,
      retrievabilityBefore,
      state.revision,
      context,
    ),
    3: outcomeFromCard(
      preview[UpstreamRating.Good].card,
      3,
      retrievabilityBefore,
      state.revision,
      context,
    ),
    4: outcomeFromCard(
      preview[UpstreamRating.Easy].card,
      4,
      retrievabilityBefore,
      state.revision,
      context,
    ),
  };
}

export function applyRating(
  state: SchedulerStateV1,
  rating: Rating,
  context: ScheduleContext,
): RatingOutcome {
  const scheduler = createScheduler(context);
  const card = toUpstreamCard(state, context);
  const now = toSchedulerDate(context.nowMs, context.studyDay);
  const retrievabilityBefore = getRetrievability(
    state,
    context.nowMs,
    context,
  );
  const result = scheduler.next(
    card,
    now,
    upstreamRatingByStableRating[rating],
  );

  return outcomeFromCard(
    result.card,
    rating,
    retrievabilityBefore,
    state.revision,
    context,
  );
}
