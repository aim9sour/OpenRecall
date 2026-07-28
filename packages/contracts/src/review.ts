import { Type, type Static } from "typebox";
import { EpochMillisecondsSchema, UuidSchema } from "./sections.js";

const NullableEpochMillisecondsSchema = Type.Union([
  EpochMillisecondsSchema,
  Type.Null(),
]);
const ReviewStatusSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("waiting"),
  Type.Literal("paused"),
  Type.Literal("completed"),
]);
const CardTextSchema = Type.String({
  minLength: 1,
  maxLength: 20_000,
  pattern: "\\S",
});

export const ReviewSessionParamsSchema = Type.Object(
  { id: UuidSchema },
  { additionalProperties: false },
);

export const ReviewSessionCreateSchema = Type.Object(
  { sectionId: UuidSchema },
  { additionalProperties: false },
);

export const ReviewShownSchema = Type.Object(
  {
    entryId: UuidSchema,
    presentationId: UuidSchema,
  },
  { additionalProperties: false },
);

export const ReviewRevealSchema = Type.Object(
  { entryId: UuidSchema },
  { additionalProperties: false },
);

export const ReviewRateSchema = Type.Object(
  {
    entryId: UuidSchema,
    learningItemId: UuidSchema,
    rating: Type.Union([
      Type.Literal(1),
      Type.Literal(2),
      Type.Literal(3),
      Type.Literal(4),
    ]),
    expectedStateRevision: Type.Integer({ minimum: 0 }),
    idempotencyKey: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: "\\S",
    }),
  },
  { additionalProperties: false },
);

export const SessionProgressSchema = Type.Object(
  {
    id: UuidSchema,
    sectionId: UuidSchema,
    status: ReviewStatusSchema,
    revision: Type.Integer({ minimum: 0 }),
    completedAppearances: Type.Integer({ minimum: 0 }),
    currentlyRemaining: Type.Integer({ minimum: 0 }),
    newRemaining: Type.Integer({ minimum: 0 }),
    repeatedWithinSession: Type.Integer({ minimum: 0 }),
    elapsedActiveMs: Type.Integer({ minimum: 0 }),
    newlyJoined: Type.Integer({ minimum: 0 }),
    nextDueAtMs: NullableEpochMillisecondsSchema,
    remainingSnapshotAtMs: EpochMillisecondsSchema,
  },
  { additionalProperties: false },
);

export const QuestionViewSchema = Type.Object(
  {
    entryId: UuidSchema,
    learningItemId: UuidSchema,
    presentationId: UuidSchema,
    front: CardTextSchema,
    stateRevision: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const AnswerViewSchema = Type.Object(
  {
    entryId: UuidSchema,
    learningItemId: UuidSchema,
    presentationId: UuidSchema,
    front: CardTextSchema,
    back: CardTextSchema,
    notes: Type.Union([
      Type.String({ maxLength: 20_000 }),
      Type.Null(),
    ]),
    stateRevision: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const OutcomePreviewSchema = Type.Object(
  {
    rating: Type.Union([
      Type.Literal(1),
      Type.Literal(2),
      Type.Literal(3),
      Type.Literal(4),
    ]),
    dueAtMs: EpochMillisecondsSchema,
    intervalMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const SessionSummarySchema = Type.Object(
  {
    sessionId: UuidSchema,
    sectionId: UuidSchema,
    completedAtMs: EpochMillisecondsSchema,
    reviewEvents: Type.Integer({ minimum: 0 }),
    uniqueItems: Type.Integer({ minimum: 0 }),
    repeatedWithinSession: Type.Integer({ minimum: 0 }),
    elapsedActiveMs: Type.Integer({ minimum: 0 }),
    ratingCounts: Type.Object(
      {
        again: Type.Integer({ minimum: 0 }),
        hard: Type.Integer({ minimum: 0 }),
        good: Type.Integer({ minimum: 0 }),
        easy: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const QuestionPageStateSchema = Type.Object(
  {
    kind: Type.Literal("question"),
    card: QuestionViewSchema,
    session: SessionProgressSchema,
  },
  { additionalProperties: false },
);
const AnswerPageStateSchema = Type.Object(
  {
    kind: Type.Literal("answer"),
    card: AnswerViewSchema,
    outcomes: Type.Array(OutcomePreviewSchema, {
      minItems: 4,
      maxItems: 4,
    }),
    session: SessionProgressSchema,
  },
  { additionalProperties: false },
);
const WaitingPageStateSchema = Type.Object(
  {
    kind: Type.Literal("waiting"),
    nextDueAtMs: NullableEpochMillisecondsSchema,
    session: SessionProgressSchema,
  },
  { additionalProperties: false },
);
const CompletedPageStateSchema = Type.Object(
  {
    kind: Type.Literal("completed"),
    summary: SessionSummarySchema,
  },
  { additionalProperties: false },
);

export const ReviewPageStateSchema = Type.Union([
  QuestionPageStateSchema,
  AnswerPageStateSchema,
  WaitingPageStateSchema,
  CompletedPageStateSchema,
]);

export const OpenSessionConflictSchema = Type.Object(
  {
    code: Type.Literal("OPEN_REVIEW_SESSION_EXISTS"),
    messageKey: Type.Literal("review.openSessionExists"),
    sessionId: UuidSchema,
    sectionId: UuidSchema,
  },
  { additionalProperties: false },
);

export type ReviewSessionParams = Static<
  typeof ReviewSessionParamsSchema
>;
export type ReviewSessionCreate = Static<
  typeof ReviewSessionCreateSchema
>;
export type ReviewShown = Static<typeof ReviewShownSchema>;
export type ReviewReveal = Static<typeof ReviewRevealSchema>;
export type ReviewRate = Static<typeof ReviewRateSchema>;
export type SessionProgress = Static<typeof SessionProgressSchema>;
export type QuestionView = Static<typeof QuestionViewSchema>;
export type AnswerView = Static<typeof AnswerViewSchema>;
export type OutcomePreview = Static<typeof OutcomePreviewSchema>;
export type SessionSummary = Static<typeof SessionSummarySchema>;
export type ReviewPageState = Static<typeof ReviewPageStateSchema>;
