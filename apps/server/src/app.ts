import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  CardImportRepository,
  CardRepository,
  CardStatisticsRepository,
  createBackupService,
  type BackupService,
  ProfileApplicationRepository,
  RatingTransaction,
  ReviewQueueRepository,
  ReviewSessionRepository,
  SectionRepository,
  SettingsRepository,
  StatisticsRepository,
} from "@openrecall/database";
import type { StudyDayConfig } from "@openrecall/domain";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  LogController,
} from "fastify";
import { loadConfig, type ServerConfig } from "./config.js";
import { DueWakeService } from "./review/due-wake-service.js";
import { ReviewEvents } from "./review/review-events.js";
import {
  OptimizerRunService,
  type OptimizerRunServiceApi,
} from "./optimizer/optimizer-run-service.js";
import {
  ProfileApplicationService,
  type ProfileApplicationServiceApi,
} from "./optimizer/profile-application-service.js";
import { registerBootstrapRoute } from "./routes/bootstrap.js";
import { registerBackupRoutes } from "./routes/backup.js";
import { registerCardRoutes } from "./routes/cards.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerImportRoutes } from "./routes/import.js";
import { registerOptimizerRoutes } from "./routes/optimizer.js";
import { registerReviewRoutes } from "./routes/review.js";
import { registerSectionRoutes } from "./routes/sections.js";
import { registerStatisticsRoutes } from "./routes/statistics.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerSecurity } from "./security.js";

const PROCESS_CSRF_TOKEN = randomBytes(32).toString("base64url");

export interface BuildServerOptions {
  readonly config?: ServerConfig;
  readonly database?: ConstructorParameters<typeof SectionRepository>[0];
  readonly nowMs?: () => number;
  readonly optimizerService?: OptimizerRunServiceApi;
  readonly backupService?: BackupService;
  readonly profileApplicationService?: ProfileApplicationServiceApi;
  readonly onDueWakeReady?: (
    wake: Pick<DueWakeService, "rearm">,
  ) => void;
  readonly reviewEvents?: ReviewEvents;
  readonly sseHeartbeatIntervalMs?: number;
  readonly studyDay?: StudyDayConfig;
}

function validationPath(error: {
  readonly instancePath?: string;
  readonly params?: Record<string, unknown>;
}): string {
  if (error.instancePath !== undefined && error.instancePath !== "") {
    return error.instancePath;
  }

  const missingProperty = error.params?.["missingProperty"];
  return typeof missingProperty === "string" ? `/${missingProperty}` : "/";
}

function registerErrorHandler(server: FastifyInstance): void {
  server.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({
      code: "NOT_FOUND",
      messageKey: "error.notFound",
    }),
  );

  server.setErrorHandler((error: FastifyError, _request, reply) => {
    if (Array.isArray(error.validation)) {
      return reply.code(400).send({
        code: "VALIDATION_ERROR",
        messageKey: "error.validation",
        fieldErrors: error.validation.map((validationError) => ({
          path: validationPath(validationError),
          messageKey: "error.field.invalid",
        })),
      });
    }

    const statusCode =
      error.statusCode !== undefined &&
      error.statusCode >= 400 &&
      error.statusCode < 500
        ? error.statusCode
        : 500;

    return reply.code(statusCode).send({
      code: statusCode === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
      messageKey:
        statusCode === 404 ? "error.notFound" : "error.internal",
    });
  });
}

export async function buildServer(
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const server = Fastify({
    bodyLimit: 5 * 1_024 * 1_024,
    logController: new LogController({ disableRequestLogging: true }),
    logger: false,
  }).withTypeProvider<TypeBoxTypeProvider>();
  const reviewEvents = options.reviewEvents ?? new ReviewEvents();

  registerSecurity(server, config, PROCESS_CSRF_TOKEN);
  registerErrorHandler(server);
  registerEventRoutes(server, {
    events: reviewEvents,
    heartbeatIntervalMs: options.sseHeartbeatIntervalMs,
    publicOrigin: config.publicOrigin,
  });
  registerBootstrapRoute(server, {
    csrfToken: PROCESS_CSRF_TOKEN,
    locale: config.locale,
  });
  if (options.database !== undefined) {
    const repository = new SectionRepository(options.database);
    const settings = new SettingsRepository(options.database);
    const optimizer =
      options.optimizerService ??
      new OptimizerRunService(options.database, {
        nowMs: options.nowMs ?? Date.now,
      });
    const queue = new ReviewQueueRepository(options.database);
    const sessions = new ReviewSessionRepository(options.database);
    const studyDay = (): StudyDayConfig =>
      options.studyDay ?? {
        timeZone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        boundaryMinutes: 240,
      };
    const ratings = new RatingTransaction(options.database, {
      resolveSettings(sectionId) {
        const effective = settings.resolveEffective(sectionId);
        return {
          studyDay: studyDay(),
          settings: effective.settings,
        };
      },
    });
    const dueWake = new DueWakeService(queue, reviewEvents, {
      now: options.nowMs ?? Date.now,
      setTimer(callback, delayMs) {
        return setTimeout(callback, delayMs);
      },
      clearTimer(timer) {
        clearTimeout(timer as ReturnType<typeof setTimeout>);
      },
    });
    const backups =
      options.backupService ??
      createBackupService({
        db: options.database,
        snapshotDirectory: join(config.dataDirectory, "backups"),
        nowMs: options.nowMs ?? Date.now,
      });
    const profiles =
      options.profileApplicationService ??
      new ProfileApplicationService({
        repository: new ProfileApplicationRepository(options.database),
        backup: backups,
        nowMs: options.nowMs ?? Date.now,
        rearmDue: () => dueWake.rearm(),
      });
    options.onDueWakeReady?.(dueWake);
    registerSectionRoutes(server, {
      repository,
      nowMs: options.nowMs ?? Date.now,
    });
    registerBackupRoutes(server, { backups });
    registerCardRoutes(server, {
      cards: new CardRepository(options.database),
      sections: repository,
      nowMs: options.nowMs ?? Date.now,
    });
    registerStatisticsRoutes(server, {
      statistics: new StatisticsRepository(options.database),
      cards: new CardStatisticsRepository(options.database),
      nowMs: options.nowMs ?? Date.now,
      studyDay,
    });
    registerSettingsRoutes(server, {
      settings,
      sections: repository,
      nowMs: options.nowMs ?? Date.now,
    });
    registerOptimizerRoutes(server, {
      optimizer,
      profiles,
      sections: repository,
      nowMs: options.nowMs ?? Date.now,
    });
    registerImportRoutes(server, {
      cards: new CardImportRepository(options.database),
      sections: repository,
      nowMs: options.nowMs ?? Date.now,
    });
    registerReviewRoutes(server, {
      events: reviewEvents,
      nowMs: options.nowMs ?? Date.now,
      queue,
      ratings,
      sessions,
      wake: dueWake,
    });
    server.addHook("onReady", async () => {
      dueWake.start();
    });
    server.addHook("preClose", async () => {
      dueWake.stop();
      reviewEvents.closeAll();
      optimizer.dispose();
      await optimizer.whenIdle();
    });
    server.addHook("onClose", async () => {
      if (options.database?.open === true) {
        options.database.close();
      }
    });
  } else {
    server.addHook("preClose", async () => {
      reviewEvents.closeAll();
    });
  }

  await server.ready();
  return server;
}
