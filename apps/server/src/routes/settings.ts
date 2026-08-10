import {
  AppearancePreferencesMutationSchema,
  AppearancePreferencesSchema,
  ApiErrorSchema,
  OptimizerSettingsMutationSchema,
  OptimizerSettingsResetSchema,
  OptimizerSettingsViewSchema,
  OptimizerTechnicalInfoSchema,
  SchedulerSettingsMutationSchema,
  SchedulerSettingsResetSchema,
  SettingsQuerySchema,
  SettingsViewSchema,
  UuidSchema,
  type SchedulerSettingsMutation,
  type SchedulerSettingsReset,
  type SettingsQuery,
  type SettingsView,
  type AppearancePreferencesMutation,
  type OptimizerSettingsMutation,
  type OptimizerSettingsReset,
} from "@openrecall/contracts";
import {
  CURRENT_DEFAULT_SCHEDULER_SETTINGS,
  CURRENT_SCHEDULER_SETTINGS_MANIFEST,
  validateCurrentSchedulerSettings,
  type SectionRepository,
  type SettingsRepository,
  type OptimizerSettingsRepository,
} from "@openrecall/database";
import type { OptimizerRunServiceApi } from "../optimizer/optimizer-run-service.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import { Type } from "typebox";

const IncomingSchedulerSettingsMutationSchema = {
  ...SchedulerSettingsMutationSchema,
  properties: {
    ...SchedulerSettingsMutationSchema.properties,
    settings: {
      ...SchedulerSettingsMutationSchema.properties.settings,
      additionalProperties: true,
    },
  },
} as typeof SchedulerSettingsMutationSchema;

const SectionParamsSchema = Type.Object(
  { sectionId: UuidSchema },
  { additionalProperties: false },
);

interface SectionParams {
  readonly sectionId: string;
}

function manifest() {
  return CURRENT_SCHEDULER_SETTINGS_MANIFEST;
}

function settingsError(reply: FastifyReply, error: unknown) {
  if (error instanceof Error && error.message === "SETTINGS_EDIT_CONFLICT") {
    return reply.code(409).send({
      code: "SETTINGS_EDIT_CONFLICT",
      messageKey: "settings.editConflict",
    });
  }
  throw error;
}

export function registerSettingsRoutes(
  server: FastifyInstance,
  options: {
    readonly settings: SettingsRepository;
    readonly optimizerSettings: OptimizerSettingsRepository;
    readonly optimizer: OptimizerRunServiceApi;
    readonly sections: SectionRepository;
    readonly nowMs: () => number;
  },
): void {
  const buildView = (sectionId: string | null): SettingsView => {
    const resolution = options.settings.getResolutionInput(
      sectionId ?? "__global_settings_scope__",
    );
    const savedOverride =
      sectionId === null
        ? resolution.globalSettings
        : resolution.sectionSettings;
    const effective = options.settings.resolveEffective(
      sectionId ?? "__global_settings_scope__",
    );
    return {
      manifest: manifest(),
      defaults: CURRENT_DEFAULT_SCHEDULER_SETTINGS,
      selectedScope: {
        scopeType: sectionId === null ? "global" : "section",
        sectionId,
      },
      savedOverride,
      effective: {
        settings: effective.settings,
        settingsSource: effective.settingsSource,
        parameterSource: effective.parameterSource,
      },
    };
  };

  const ensureSection = (
    sectionId: string,
    reply: FastifyReply,
  ): boolean => {
    if (options.sections.getSection(sectionId, options.nowMs()) !== undefined) {
      return true;
    }
    void reply.code(404).send({
      code: "SECTION_NOT_FOUND",
      messageKey: "error.sectionNotFound",
    });
    return false;
  };

  const optimizerView = (sectionId: string | null) =>
    options.optimizerSettings.getView(sectionId);

  const optimizerWriteError = (reply: FastifyReply, error: unknown) => {
    if (error instanceof Error && error.message === "SETTINGS_EDIT_CONFLICT") {
      return settingsError(reply, error);
    }
    if (error instanceof TypeError || error instanceof RangeError ||
        (error instanceof Error && error.message === "OPTIMIZER_TRAINING_SETTINGS_INVALID")) {
      return reply.code(400).send({
        code: "VALIDATION_ERROR",
        messageKey: "error.validation",
        fieldErrors: [{ path: "/settings", messageKey: "error.field.invalid" }],
      });
    }
    throw error;
  };

  server.get(
    "/api/v1/settings/appearance",
    {
      schema: {
        response: {
          200: AppearancePreferencesSchema,
        },
      },
    },
    async (_request, reply) =>
      reply
        .code(200)
        .send(options.settings.getAppearancePreferences()),
  );

  server.put<{ Body: AppearancePreferencesMutation }>(
    "/api/v1/settings/appearance",
    {
      schema: {
        body: AppearancePreferencesMutationSchema,
        response: {
          200: AppearancePreferencesSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const saved = options.settings.saveAppearancePreferences({
          ...request.body,
          nowMs: options.nowMs(),
        });
        return reply.code(200).send(saved);
      } catch (error) {
        return settingsError(reply, error);
      }
    },
  );

  server.get<{ Querystring: SettingsQuery }>(
    "/api/v1/settings",
    {
      schema: {
        querystring: SettingsQuerySchema,
        response: {
          200: SettingsViewSchema,
          404: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const sectionId = request.query.sectionId ?? null;
      if (sectionId !== null && !ensureSection(sectionId, reply)) return;
      return reply.code(200).send(buildView(sectionId));
    },
  );

  server.put<{ Body: SchedulerSettingsMutation }>(
    "/api/v1/settings/scheduler/global",
    {
      schema: {
        body: IncomingSchedulerSettingsMutationSchema,
        response: {
          200: SettingsViewSchema,
          400: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.body.expectedUpdatedAtMs === undefined) {
        return reply.code(409).send({
          code: "SETTINGS_EDIT_CONFLICT",
          messageKey: "settings.editConflict",
        });
      }
      let settings;
      try {
        settings = validateCurrentSchedulerSettings(request.body.settings);
        options.settings.saveGlobalSettings({
          expectedUpdatedAtMs: request.body.expectedUpdatedAtMs,
          adapterVersion: CURRENT_SCHEDULER_SETTINGS_MANIFEST.adapterVersion,
          settings,
          nowMs: options.nowMs(),
        });
      } catch (error) {
        if (error instanceof TypeError || error instanceof RangeError) {
          return reply.code(400).send({
            code: "VALIDATION_ERROR",
            messageKey: "error.validation",
            fieldErrors: [
              { path: "/settings", messageKey: "error.field.invalid" },
            ],
          });
        }
        return settingsError(reply, error);
      }
      return reply.code(200).send(buildView(null));
    },
  );

  server.put<{
    Params: SectionParams;
    Body: SchedulerSettingsMutation;
  }>(
    "/api/v1/settings/scheduler/sections/:sectionId",
    {
      schema: {
        params: SectionParamsSchema,
        body: IncomingSchedulerSettingsMutationSchema,
        response: {
          200: SettingsViewSchema,
          400: ApiErrorSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!ensureSection(request.params.sectionId, reply)) return;
      try {
        const settings = validateCurrentSchedulerSettings(
          request.body.settings,
        );
        options.settings.saveSectionSettings({
          sectionId: request.params.sectionId,
          expectedUpdatedAtMs: request.body.expectedUpdatedAtMs ?? null,
          adapterVersion: CURRENT_SCHEDULER_SETTINGS_MANIFEST.adapterVersion,
          settings,
          nowMs: options.nowMs(),
        });
      } catch (error) {
        if (error instanceof TypeError || error instanceof RangeError) {
          return reply.code(400).send({
            code: "VALIDATION_ERROR",
            messageKey: "error.validation",
            fieldErrors: [
              { path: "/settings", messageKey: "error.field.invalid" },
            ],
          });
        }
        return settingsError(reply, error);
      }
      return reply.code(200).send(buildView(request.params.sectionId));
    },
  );

  server.delete<{
    Params: SectionParams;
    Body: SchedulerSettingsReset;
  }>(
    "/api/v1/settings/scheduler/sections/:sectionId",
    {
      schema: {
        params: SectionParamsSchema,
        body: SchedulerSettingsResetSchema,
        response: {
          200: SettingsViewSchema,
          404: ApiErrorSchema,
          409: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!ensureSection(request.params.sectionId, reply)) return;
      try {
        options.settings.deleteSectionSettings({
          sectionId: request.params.sectionId,
          expectedUpdatedAtMs: request.body.expectedUpdatedAtMs,
        });
      } catch (error) {
        return settingsError(reply, error);
      }
      return reply.code(200).send(buildView(request.params.sectionId));
    },
  );

  server.get<{ Querystring: SettingsQuery }>(
    "/api/v1/settings/optimizer",
    {
      schema: {
        querystring: SettingsQuerySchema,
        response: { 200: OptimizerSettingsViewSchema, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const sectionId = request.query.sectionId ?? null;
      if (sectionId !== null && !ensureSection(sectionId, reply)) return;
      return reply.code(200).send(optimizerView(sectionId));
    },
  );

  server.put<{ Body: OptimizerSettingsMutation }>(
    "/api/v1/settings/optimizer/global",
    {
      schema: {
        body: OptimizerSettingsMutationSchema,
        response: { 200: OptimizerSettingsViewSchema, 400: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      if (request.body.expectedUpdatedAtMs === undefined) {
        return reply.code(409).send({ code: "SETTINGS_EDIT_CONFLICT", messageKey: "settings.editConflict" });
      }
      try {
        options.optimizerSettings.saveGlobal({
          expectedUpdatedAtMs: request.body.expectedUpdatedAtMs,
          settings: request.body.settings,
          nowMs: options.nowMs(),
        });
        return reply.code(200).send(optimizerView(null));
      } catch (error) {
        return optimizerWriteError(reply, error);
      }
    },
  );

  server.put<{ Params: SectionParams; Body: OptimizerSettingsMutation }>(
    "/api/v1/settings/optimizer/sections/:sectionId",
    {
      schema: {
        params: SectionParamsSchema,
        body: OptimizerSettingsMutationSchema,
        response: { 200: OptimizerSettingsViewSchema, 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      if (!ensureSection(request.params.sectionId, reply)) return;
      try {
        options.optimizerSettings.saveSection({
          sectionId: request.params.sectionId,
          expectedUpdatedAtMs: request.body.expectedUpdatedAtMs ?? null,
          settings: request.body.settings,
          nowMs: options.nowMs(),
        });
        return reply.code(200).send(optimizerView(request.params.sectionId));
      } catch (error) {
        return optimizerWriteError(reply, error);
      }
    },
  );

  server.delete<{ Params: SectionParams; Body: OptimizerSettingsReset }>(
    "/api/v1/settings/optimizer/sections/:sectionId",
    {
      schema: {
        params: SectionParamsSchema,
        body: OptimizerSettingsResetSchema,
        response: { 200: OptimizerSettingsViewSchema, 404: ApiErrorSchema, 409: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      if (!ensureSection(request.params.sectionId, reply)) return;
      try {
        options.optimizerSettings.deleteSection({
          sectionId: request.params.sectionId,
          expectedUpdatedAtMs: request.body.expectedUpdatedAtMs,
        });
        return reply.code(200).send(optimizerView(request.params.sectionId));
      } catch (error) {
        return optimizerWriteError(reply, error);
      }
    },
  );

  server.get<{ Querystring: SettingsQuery }>(
    "/api/v1/settings/technical",
    {
      schema: {
        querystring: SettingsQuerySchema,
        response: { 200: OptimizerTechnicalInfoSchema, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const sectionId = request.query.sectionId ?? null;
      if (sectionId !== null && !ensureSection(sectionId, reply)) return;
      const scope = sectionId === null
        ? { scopeType: "global" as const, sectionId: null }
        : { scopeType: "section" as const, sectionId };
      if (options.optimizer.getTechnicalInfo === undefined) {
        throw new Error("OPTIMIZER_TECHNICAL_INFO_UNAVAILABLE");
      }
      return reply.code(200).send(options.optimizer.getTechnicalInfo(scope));
    },
  );
}
