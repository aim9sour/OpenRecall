import {
  ApiErrorSchema,
  CardItemParamsSchema,
  CardStatisticsQuerySchema,
  CardStatisticsSchema,
  StatisticsQuerySchema,
  StudyStatisticsSchema,
  UuidSchema,
  type CardItemParams,
  type CardStatisticsQuery,
  type StatisticsQuery,
} from "@openrecall/contracts";
import type {
  CardStatisticsRepository,
  StatisticsRepository,
  StudyStatistics,
} from "@openrecall/database";
import type { StudyDayConfig } from "@openrecall/domain";
import type { FastifyInstance, FastifyReply } from "fastify";
import { Type } from "typebox";

const SectionParamsSchema = Type.Object(
  { sectionId: UuidSchema },
  { additionalProperties: false },
);

interface SectionParams {
  readonly sectionId: string;
}

function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? date
    : null;
}

function validateRange(
  query: StatisticsQuery,
  nowMs: number,
): boolean {
  const from =
    query.fromStudyDay === undefined
      ? null
      : parseDay(query.fromStudyDay);
  const to =
    query.toStudyDay === undefined ? null : parseDay(query.toStudyDay);
  if (
    (query.fromStudyDay !== undefined && from === null) ||
    (query.toStudyDay !== undefined && to === null)
  ) {
    return false;
  }
  const effectiveTo = to ?? new Date(nowMs);
  if (from !== null) {
    if (effectiveTo.getTime() <= from.getTime()) return false;
    const fiveYearsLater = new Date(from);
    fiveYearsLater.setUTCFullYear(fiveYearsLater.getUTCFullYear() + 5);
    if (effectiveTo.getTime() > fiveYearsLater.getTime()) return false;
  }
  return true;
}

function withMetrics(statistics: StudyStatistics) {
  return {
    ...statistics,
    metrics: [
      {
        labelKey: "statistics.metric.reviewEvents",
        value: statistics.summary.reviewEvents,
      },
      {
        labelKey: "statistics.metric.uniqueItems",
        value: statistics.summary.uniqueItems,
      },
      {
        labelKey: "statistics.metric.actualRecall",
        value: statistics.summary.actualRecall,
      },
      {
        labelKey: "statistics.metric.predictedRetrievability",
        value: statistics.summary.meanPredictedRetrievability,
      },
      {
        labelKey: "statistics.metric.studyDurationMs",
        value: statistics.summary.studyDurationMs,
      },
    ],
  };
}

function rangeError(reply: FastifyReply) {
  return reply.code(400).send({
    code: "STATISTICS_RANGE_INVALID",
    messageKey: "statistics.rangeInvalid",
  });
}

export function registerStatisticsRoutes(
  server: FastifyInstance,
  options: {
    readonly statistics: StatisticsRepository;
    readonly cards: CardStatisticsRepository;
    readonly nowMs: () => number;
    readonly studyDay: () => StudyDayConfig;
  },
): void {
  server.get<{ Querystring: StatisticsQuery }>(
    "/api/v1/statistics",
    {
      schema: {
        querystring: StatisticsQuerySchema,
        response: {
          200: StudyStatisticsSchema,
          400: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const nowMs = options.nowMs();
      if (!validateRange(request.query, nowMs)) return rangeError(reply);
      try {
        return reply.code(200).send(
          withMetrics(
            options.statistics.getGlobalStatistics(
              {
                fromStudyDay: request.query.fromStudyDay ?? null,
                toStudyDay: request.query.toStudyDay ?? null,
              },
              nowMs,
              options.studyDay(),
            ),
          ),
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "STATISTICS_STUDY_DAY_INVALID"
        ) {
          return rangeError(reply);
        }
        throw error;
      }
    },
  );

  server.get<{
    Params: SectionParams;
    Querystring: StatisticsQuery;
  }>(
    "/api/v1/sections/:sectionId/statistics",
    {
      schema: {
        params: SectionParamsSchema,
        querystring: StatisticsQuerySchema,
        response: {
          200: StudyStatisticsSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const nowMs = options.nowMs();
      if (!validateRange(request.query, nowMs)) return rangeError(reply);
      const result = options.statistics.getSectionStatistics(
        request.params.sectionId,
        {
          fromStudyDay: request.query.fromStudyDay ?? null,
          toStudyDay: request.query.toStudyDay ?? null,
        },
        nowMs,
        options.studyDay(),
      );
      return result === null
        ? reply.code(404).send({
            code: "SECTION_NOT_FOUND",
            messageKey: "error.sectionNotFound",
          })
        : reply.code(200).send(withMetrics(result));
    },
  );

  server.get<{
    Params: CardItemParams;
    Querystring: CardStatisticsQuery;
  }>(
    "/api/v1/cards/:itemId/statistics",
    {
      schema: {
        params: CardItemParamsSchema,
        querystring: CardStatisticsQuerySchema,
        response: {
          200: CardStatisticsSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = options.cards.getCardStatistics(
          request.params.itemId,
          options.nowMs(),
          request.query.cursor ?? null,
          request.query.limit ?? 25,
        );
        return result === null
          ? reply.code(404).send({
              code: "CARD_NOT_FOUND",
              messageKey: "card.notFound",
            })
          : reply.code(200).send(result);
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "CARD_HISTORY_CURSOR_INVALID" ||
            error.message === "CARD_HISTORY_LIMIT_INVALID")
        ) {
          return reply.code(400).send({
            code: error.message,
            messageKey: "error.validation",
          });
        }
        throw error;
      }
    },
  );
}
