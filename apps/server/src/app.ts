import { randomBytes } from "node:crypto";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  CardImportRepository,
  CardRepository,
  CardStatisticsRepository,
  createBackupService,
  openDatabase,
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
  type FastifyInstance,
  LogController,
} from "fastify";
import { loadConfig, type ServerConfig } from "./config.js";
import { MaintenanceMode } from "./durability/maintenance-mode.js";
import { RestoreService } from "./durability/restore-service.js";
import { registerHealthRoute } from "./health.js";
import {
  registerContentFreeErrorHandler,
  registerContentFreeLogging,
  type ContentFreeLogSink,
} from "./logging.js";
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
import {
  registerRestoreRoutes,
  type RestoreServiceApi,
} from "./routes/restore.js";
import { registerSectionRoutes } from "./routes/sections.js";
import { registerStatisticsRoutes } from "./routes/statistics.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerSecurityHeaders } from "./production/security-headers.js";
import {
  registerProductionNotFoundHandler,
  registerStaticClient,
} from "./production/static-client.js";
import { registerSecurity } from "./security.js";

const PROCESS_CSRF_TOKEN = randomBytes(32).toString("base64url");
const optimizerRecoveryByServer = new WeakMap<
  FastifyInstance,
  () => void
>();

export function recoverInterruptedOptimizerRuns(
  server: FastifyInstance,
): void {
  optimizerRecoveryByServer.get(server)?.();
}

export interface BuildServerOptions {
  readonly config?: ServerConfig;
  readonly database?: ConstructorParameters<typeof SectionRepository>[0];
  readonly nowMs?: () => number;
  readonly optimizerService?: OptimizerRunServiceApi;
  readonly backupService?: BackupService;
  readonly profileApplicationService?: ProfileApplicationServiceApi;
  readonly restoreService?: RestoreServiceApi;
  readonly restoreMaxUploadBytes?: number;
  readonly maintenanceMode?: MaintenanceMode;
  readonly onDueWakeReady?: (
    wake: Pick<DueWakeService, "rearm">,
  ) => void;
  readonly reviewEvents?: ReviewEvents;
  readonly sseHeartbeatIntervalMs?: number;
  readonly studyDay?: StudyDayConfig;
  readonly staticClientRoot?: string;
  readonly logSink?: ContentFreeLogSink;
}

function dynamicService<T extends object>(
  current: () => T,
): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const implementation = current();
      const value = Reflect.get(
        implementation,
        property,
        implementation,
      ) as unknown;
      return typeof value === "function"
        ? value.bind(implementation)
        : value;
    },
  });
}

export async function buildServer(
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const server = Fastify({
    bodyLimit: 5 * 1_024 * 1_024,
    forceCloseConnections: false,
    logController: new LogController({ disableRequestLogging: true }),
    logger: false,
  }).withTypeProvider<TypeBoxTypeProvider>();
  const reviewEvents = options.reviewEvents ?? new ReviewEvents();
  const maintenance = options.maintenanceMode ?? new MaintenanceMode();
  let healthDatabase = options.database;

  await registerSecurityHeaders(server);
  registerContentFreeLogging(server, {
    sink: options.logSink ?? (() => undefined),
    ...(options.nowMs === undefined
      ? {}
      : { nowMs: options.nowMs }),
  });
  registerSecurity(server, config, PROCESS_CSRF_TOKEN, maintenance);
  await server.register(multipart);
  if (options.staticClientRoot !== undefined) {
    await registerStaticClient(server, options.staticClientRoot);
  }
  registerProductionNotFoundHandler(server, options.staticClientRoot);
  registerContentFreeErrorHandler(server);
  registerEventRoutes(server, {
    events: reviewEvents,
    heartbeatIntervalMs: options.sseHeartbeatIntervalMs,
    publicOrigin: config.publicOrigin,
  });
  registerBootstrapRoute(server, {
    csrfToken: PROCESS_CSRF_TOKEN,
    databaseRevision: () => maintenance.revision,
    locale: config.locale,
  });
  registerHealthRoute(server, maintenance, () => healthDatabase);
  if (options.database !== undefined) {
    type ApplicationDatabase = ConstructorParameters<
      typeof SectionRepository
    >[0];
    let database: ApplicationDatabase = options.database;
    let repositoryImplementation!: SectionRepository;
    let settingsImplementation!: SettingsRepository;
    let optimizerImplementation!: OptimizerRunServiceApi;
    let queueImplementation!: ReviewQueueRepository;
    let sessionsImplementation!: ReviewSessionRepository;
    let ratingsImplementation!: RatingTransaction;
    let cardsImplementation!: CardRepository;
    let cardImportImplementation!: CardImportRepository;
    let statisticsImplementation!: StatisticsRepository;
    let cardStatisticsImplementation!: CardStatisticsRepository;
    let backupImplementation!: BackupService;
    let profileImplementation!: ProfileApplicationServiceApi;
    let dueWake!: DueWakeService;

    const repository = dynamicService(
      () => repositoryImplementation,
    );
    const settings = dynamicService(() => settingsImplementation);
    const optimizer = dynamicService(
      () => optimizerImplementation,
    );
    const queue = dynamicService(() => queueImplementation);
    const sessions = dynamicService(() => sessionsImplementation);
    const ratings = dynamicService(() => ratingsImplementation);
    const cards = dynamicService(() => cardsImplementation);
    const cardImport = dynamicService(
      () => cardImportImplementation,
    );
    const statistics = dynamicService(
      () => statisticsImplementation,
    );
    const cardStatistics = dynamicService(
      () => cardStatisticsImplementation,
    );
    const backups = dynamicService(() => backupImplementation);
    const profiles = dynamicService(
      () => profileImplementation,
    );
    const studyDay = (): StudyDayConfig =>
      options.studyDay ?? {
        timeZone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        boundaryMinutes: 240,
      };

    const rebuildServices = (): void => {
      repositoryImplementation = new SectionRepository(database);
      settingsImplementation = new SettingsRepository(database);
      optimizerImplementation =
        options.optimizerService ??
        new OptimizerRunService(database, {
          nowMs: options.nowMs ?? Date.now,
        });
      queueImplementation = new ReviewQueueRepository(database);
      sessionsImplementation = new ReviewSessionRepository(database);
      ratingsImplementation = new RatingTransaction(database, {
        resolveSettings(sectionId) {
          const effective = settings.resolveEffective(sectionId);
          return {
            studyDay: studyDay(),
            settings: effective.settings,
          };
        },
      });
      cardsImplementation = new CardRepository(database);
      cardImportImplementation = new CardImportRepository(database);
      statisticsImplementation = new StatisticsRepository(database);
      cardStatisticsImplementation =
        new CardStatisticsRepository(database);
      backupImplementation =
        options.backupService ??
        createBackupService({
          db: database,
          snapshotDirectory: join(
            config.dataDirectory,
            "backups",
          ),
          nowMs: options.nowMs ?? Date.now,
        });
      profileImplementation =
        options.profileApplicationService ??
        new ProfileApplicationService({
          repository: new ProfileApplicationRepository(database),
          backup: backups,
          nowMs: options.nowMs ?? Date.now,
          rearmDue: () => dueWake.rearm(),
          maintenance,
        });
    };

    rebuildServices();
    optimizerRecoveryByServer.set(server, () => {
      optimizerImplementation.recoverInterruptedRuns?.();
    });
    dueWake = new DueWakeService(queue, reviewEvents, {
      now: options.nowMs ?? Date.now,
      setTimer(callback, delayMs) {
        return setTimeout(callback, delayMs);
      },
      clearTimer(timer) {
        clearTimeout(timer as ReturnType<typeof setTimeout>);
      },
    });
    options.onDueWakeReady?.(dueWake);
    registerSectionRoutes(server, {
      repository,
      nowMs: options.nowMs ?? Date.now,
    });
    registerBackupRoutes(server, { backups });
    const restore =
      options.restoreService ??
      new RestoreService({
        liveDatabasePath: database.name,
        workingDirectory: join(
          config.dataDirectory,
          "restore-work",
        ),
        maintenance,
        backups,
        lifecycle: {
          async stop() {
            dueWake.stop();
            reviewEvents.closeAll();
            optimizerImplementation.dispose();
            await optimizerImplementation.whenIdle();
            if (database.open) database.close();
          },
          async open(databasePath) {
            const reopened = openDatabase(databasePath);
            database = reopened;
            healthDatabase = reopened;
            try {
              rebuildServices();
              recoverInterruptedOptimizerRuns(server);
              dueWake.start();
            } catch (error) {
              if (reopened.open) reopened.close();
              throw error;
            }
          },
        },
      });
    registerRestoreRoutes(server, {
      restore,
      uploadDirectory: join(
        config.dataDirectory,
        "restore-uploads",
      ),
      ...(options.restoreMaxUploadBytes === undefined
        ? {}
        : {
            maxUploadBytes: options.restoreMaxUploadBytes,
          }),
    });
    registerCardRoutes(server, {
      cards,
      sections: repository,
      nowMs: options.nowMs ?? Date.now,
    });
    registerStatisticsRoutes(server, {
      statistics,
      cards: cardStatistics,
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
      cards: cardImport,
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
      reviewEvents.closeAll();
    });
    let stopDatabaseServicesPromise: Promise<void> | undefined;
    const stopDatabaseServices = (): Promise<void> => {
      stopDatabaseServicesPromise ??= (async () => {
        dueWake.stop();
        optimizerImplementation.dispose();
        await optimizerImplementation.whenIdle();
      })();
      return stopDatabaseServicesPromise;
    };
    server.addHook("onClose", async () => {
      await stopDatabaseServices();
      if (database.open) {
        try {
          database.pragma("wal_checkpoint(PASSIVE)");
        } finally {
          database.close();
        }
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
