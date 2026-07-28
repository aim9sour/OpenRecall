import { createHash, randomUUID } from "node:crypto";
import type {
  OptimizerProfile,
  OptimizerProfileApplication,
  OptimizerProfilePreview,
  ProfileWorkloadPoint,
} from "@openrecall/contracts";
import {
  currentReplayAdapter,
  type BackupService,
  type ProfileApplicationCapture,
  type ProfileApplicationRecord,
  type RebuiltSchedulerState,
  type StoredParameterProfile,
} from "@openrecall/database";
import {
  replayHistory,
  type ReplayItemHistory,
  type ReplayProfile,
  type ReplaySchedulerState,
} from "@openrecall/domain";

const DAY_MS = 86_400_000;
const FORECAST_DAYS = 30;

export interface ProfileApplicationRepositoryApi {
  capture(profileId: string): ProfileApplicationCapture;
  listProfiles(): StoredParameterProfile[];
  apply(input: {
    readonly capture: ProfileApplicationCapture;
    readonly rebuiltStates: readonly RebuiltSchedulerState[];
    readonly backupFilename: string;
    readonly applicationId: string;
    readonly appliedAtMs: number;
  }): ProfileApplicationRecord;
}

export type ProfileReplayer = (
  history: ReplayItemHistory,
  profile: ReplayProfile,
) => ReplaySchedulerState;

export interface ProfileApplicationServiceApi {
  listProfiles(): OptimizerProfile[];
  preview(profileId: string): OptimizerProfilePreview;
  apply(
    profileId: string,
    revisionToken: string,
  ): Promise<OptimizerProfileApplication>;
  rollback(
    profileId: string,
    revisionToken: string,
  ): Promise<OptimizerProfileApplication>;
}

interface ProfileApplicationServiceOptions {
  readonly repository: ProfileApplicationRepositoryApi;
  readonly backup: BackupService;
  readonly nowMs?: () => number;
  readonly replay?: ProfileReplayer;
  readonly rearmDue?: () => void;
}

function publicProfile(profile: StoredParameterProfile): OptimizerProfile {
  return {
    id: profile.id,
    scopeType: profile.scopeType,
    sectionId: profile.sectionId,
    algorithmId: profile.algorithmId,
    algorithmVersion: profile.algorithmVersion,
    adapterVersion: profile.adapterVersion,
    eligibleExampleCount: profile.eligibleExampleCount,
    reviewCutoffMs: profile.reviewCutoffMs,
    status: profile.status,
    createdAtMs: profile.createdAtMs,
    packageVersion: profile.packageVersion,
    metricLogLoss: profile.metricLogLoss,
    metricRmseBins: profile.metricRmseBins,
  };
}

function revisionToken(capture: ProfileApplicationCapture): string {
  const canonical = JSON.stringify({
    profileId: capture.target.id,
    profileStatus: capture.target.status,
    profileCreatedAtMs: capture.target.createdAtMs,
    profileReviewCutoffMs: capture.target.reviewCutoffMs,
    currentReviewCutoffMs: capture.currentReviewCutoffMs,
    items: capture.items
      .map((item) => ({
        id: item.learningItemId,
        revision: item.expectedRevision,
      }))
      .sort((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
      ),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function workload(
  dueDates: readonly number[],
  nowMs: number,
): ProfileWorkloadPoint[] {
  const counts = Array.from({ length: FORECAST_DAYS }, () => 0);
  for (const dueAtMs of dueDates) {
    const offset = Math.max(
      0,
      Math.floor((dueAtMs - nowMs) / DAY_MS),
    );
    if (offset < FORECAST_DAYS) counts[offset]! += 1;
  }
  return counts.map((count, dayOffset) => ({ dayOffset, count }));
}

function validateNow(nowMs: number): void {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("PROFILE_APPLICATION_TIME_INVALID");
  }
}

function toApplication(
  record: ProfileApplicationRecord,
): OptimizerProfileApplication {
  return { ...record };
}

export class ProfileApplicationService
  implements ProfileApplicationServiceApi
{
  readonly #repository: ProfileApplicationRepositoryApi;
  readonly #backup: BackupService;
  readonly #nowMs: () => number;
  readonly #replay: ProfileReplayer;
  readonly #rearmDue: () => void;
  #maintenance = false;

  constructor(options: ProfileApplicationServiceOptions) {
    this.#repository = options.repository;
    this.#backup = options.backup;
    this.#nowMs = options.nowMs ?? Date.now;
    this.#replay =
      options.replay ??
      ((history, profile) =>
        replayHistory(history, profile, currentReplayAdapter));
    this.#rearmDue = options.rearmDue ?? (() => undefined);
  }

  listProfiles(): OptimizerProfile[] {
    return this.#repository.listProfiles().map(publicProfile);
  }

  #rebuild(capture: ProfileApplicationCapture): RebuiltSchedulerState[] {
    return capture.items.map((item) => ({
      learningItemId: item.learningItemId,
      state: this.#replay(item.history, capture.target),
    }));
  }

  preview(profileId: string): OptimizerProfilePreview {
    const nowMs = this.#nowMs();
    validateNow(nowMs);
    const capture = this.#repository.capture(profileId);
    const rebuilt = this.#rebuild(capture);
    let earlier = 0;
    let later = 0;
    let unchanged = 0;
    const oldDueDates: number[] = [];
    const newDueDates: number[] = [];

    for (const [index, item] of capture.items.entries()) {
      const next = rebuilt[index];
      if (
        next === undefined ||
        next.learningItemId !== item.learningItemId
      ) {
        throw new Error("PROFILE_REPLAY_ORDER_INVALID");
      }
      oldDueDates.push(item.oldState.dueAtMs);
      newDueDates.push(next.state.dueAtMs);
      if (next.state.dueAtMs < item.oldState.dueAtMs) earlier += 1;
      else if (next.state.dueAtMs > item.oldState.dueAtMs) later += 1;
      else unchanged += 1;
    }

    return {
      profile: publicProfile(capture.target),
      previousProfile: publicProfile(capture.previous),
      affectedItemCount: capture.items.length,
      reviewCount: capture.items.reduce(
        (count, item) => count + item.history.logs.length,
        0,
      ),
      sourceMatches:
        capture.target.reviewCutoffMs ===
        capture.currentReviewCutoffMs,
      revisionToken: revisionToken(capture),
      dueShift: { earlier, later, unchanged },
      oldWorkload: workload(oldDueDates, nowMs),
      newWorkload: workload(newDueDates, nowMs),
    };
  }

  async apply(
    profileId: string,
    expectedRevisionToken: string,
  ): Promise<OptimizerProfileApplication> {
    if (this.#maintenance) {
      throw new Error("PROFILE_APPLICATION_BUSY");
    }
    this.#maintenance = true;
    const controller = new AbortController();
    try {
      const capture = this.#repository.capture(profileId);
      if (
        expectedRevisionToken.length !== 64 ||
        revisionToken(capture) !== expectedRevisionToken ||
        capture.target.reviewCutoffMs !==
          capture.currentReviewCutoffMs
      ) {
        throw new Error("PROFILE_APPLICATION_STALE");
      }
      const snapshot = await this.#backup.createSnapshot(
        "automatic",
        "profile-application",
        controller.signal,
      );
      await this.#backup.validateSnapshot(snapshot.path);
      const rebuiltStates = this.#rebuild(capture);
      const appliedAtMs = this.#nowMs();
      validateNow(appliedAtMs);
      const result = this.#repository.apply({
        capture,
        rebuiltStates,
        backupFilename: snapshot.filename,
        applicationId: randomUUID(),
        appliedAtMs,
      });
      this.#rearmDue();
      return toApplication(result);
    } finally {
      controller.abort();
      this.#maintenance = false;
    }
  }

  rollback(
    profileId: string,
    expectedRevisionToken: string,
  ): Promise<OptimizerProfileApplication> {
    return this.apply(profileId, expectedRevisionToken);
  }
}
