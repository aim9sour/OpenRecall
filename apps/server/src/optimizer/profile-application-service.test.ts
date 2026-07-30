import type {
  BackupService,
  ProfileApplicationCapture,
  ProfileApplicationRecord,
  StoredParameterProfile,
} from "@openrecall/database";
import type {
  ReplayItemHistory,
  ReplayProfile,
  ReplaySchedulerState,
} from "@openrecall/domain";
import { describe, expect, it, vi } from "vitest";
import { MaintenanceMode } from "../durability/maintenance-mode.js";
import {
  ProfileApplicationService,
  type ProfileApplicationRepositoryApi,
} from "./profile-application-service.js";

const weights = Array.from({ length: 21 }, (_, index) => index + 0.1);
const target: StoredParameterProfile = {
  id: "target-profile",
  scopeType: "global",
  sectionId: null,
  algorithmId: "FSRS-6",
  algorithmVersion: "6.0",
  adapterVersion: 1,
  weights,
  eligibleExampleCount: 500,
  reviewCutoffMs: 100,
  status: "candidate",
  createdAtMs: 200,
  packageVersion: "0.5.0",
  metricLogLoss: 0.2,
  metricRmseBins: 0.1,
};
const previous: StoredParameterProfile = {
  ...target,
  id: "old-profile",
  status: "active",
  createdAtMs: 0,
  packageVersion: null,
  metricLogLoss: null,
  metricRmseBins: null,
};

function state(dueAtMs: number, revision = 0): ReplaySchedulerState {
  return {
    schemaVersion: 1,
    dueAtMs,
    memoryState: revision === 0 ? "new" : "review",
    stepIndex: null,
    stability: revision,
    difficulty: revision,
    elapsedDaysAtLastReview: revision,
    scheduledDays: revision,
    lastReviewAtMs: revision === 0 ? null : 100,
    repetitions: revision,
    lapses: 0,
    revision,
  };
}

function capture(): ProfileApplicationCapture {
  return {
    target,
    previous,
    currentReviewCutoffMs: 100,
    items: [
      {
        learningItemId: "earlier",
        sectionId: "section-a",
        createdAtMs: 0,
        expectedRevision: 0,
        oldState: state(2 * 86_400_000),
        history: {
          learningItemId: "earlier",
          createdAtMs: 0,
          logs: [],
        },
      },
      {
        learningItemId: "unchanged",
        sectionId: "section-a",
        createdAtMs: 0,
        expectedRevision: 0,
        oldState: state(3 * 86_400_000),
        history: {
          learningItemId: "unchanged",
          createdAtMs: 0,
          logs: [],
        },
      },
      {
        learningItemId: "later",
        sectionId: "section-a",
        createdAtMs: 0,
        expectedRevision: 0,
        oldState: state(4 * 86_400_000),
        history: {
          learningItemId: "later",
          createdAtMs: 0,
          logs: [],
        },
      },
    ],
  };
}

function dependencies() {
  const captured = capture();
  const application: ProfileApplicationRecord = {
    id: "00000000-0000-4000-8000-000000000001",
    profileId: target.id,
    previousProfileId: previous.id,
    scopeType: "global",
    sectionId: null,
    sourceReviewCutoffMs: 100,
    backupFilename: "openrecall-automatic-10-test.sqlite3",
    appliedAtMs: 10,
    affectedItemCount: 3,
  };
  const repository: ProfileApplicationRepositoryApi = {
    capture: vi.fn(() => captured),
    listProfiles: vi.fn(() => [target, previous]),
    apply: vi.fn(() => application),
  };
  const backup: BackupService = {
    createSnapshot: vi.fn(async () => ({
      kind: "automatic" as const,
      filename: application.backupFilename,
      path: "C:\\backups\\snapshot.sqlite3",
      createdAtMs: 10,
    })),
    validateSnapshot: vi.fn(async () => ({
      userVersion: 5,
      createdAtMs: 10,
    })),
  };
  const replay = vi.fn(
    (
      history: ReplayItemHistory,
      _profile: ReplayProfile,
    ): ReplaySchedulerState => {
      const dueByItem: Record<string, number> = {
        earlier: 1 * 86_400_000,
        unchanged: 3 * 86_400_000,
        later: 5 * 86_400_000,
      };
      return state(dueByItem[history.learningItemId] ?? 0);
    },
  );
  const rearmDue = vi.fn();
  return {
    repository,
    backup,
    replay,
    rearmDue,
    application,
  };
}

describe("ProfileApplicationService", () => {
  it("previews due shifts and two complete 30-day workloads without writing", () => {
    const deps = dependencies();
    const service = new ProfileApplicationService({
      ...deps,
      nowMs: () => 0,
    });

    const preview = service.preview(target.id);

    expect(preview).toMatchObject({
      profile: {
        id: target.id,
        packageVersion: "0.5.0",
        metricLogLoss: 0.2,
      },
      previousProfile: { id: previous.id },
      affectedItemCount: 3,
      reviewCount: 0,
      sourceMatches: true,
      revisionToken: expect.stringMatching(/^[0-9a-f]{64}$/),
      dueShift: { earlier: 1, later: 1, unchanged: 1 },
    });
    expect(preview.oldWorkload).toHaveLength(30);
    expect(preview.newWorkload).toHaveLength(30);
    expect(preview.oldWorkload[2]?.count).toBe(1);
    expect(preview.newWorkload[1]?.count).toBe(1);
    expect(deps.repository.apply).not.toHaveBeenCalled();
    expect(deps.backup.createSnapshot).not.toHaveBeenCalled();
  });

  it("requires the preview token and a validated snapshot before applying and rearming due work", async () => {
    const deps = dependencies();
    const service = new ProfileApplicationService({
      ...deps,
      nowMs: () => 10,
    });
    const preview = service.preview(target.id);

    await expect(
      service.apply(target.id, "0".repeat(64)),
    ).rejects.toThrow("PROFILE_APPLICATION_STALE");
    expect(deps.backup.createSnapshot).not.toHaveBeenCalled();

    await expect(
      service.apply(target.id, preview.revisionToken),
    ).resolves.toEqual(deps.application);
    expect(deps.backup.createSnapshot).toHaveBeenCalledWith(
      "automatic",
      "profile-application",
      expect.any(AbortSignal),
    );
    expect(deps.backup.validateSnapshot).toHaveBeenCalled();
    expect(deps.repository.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        backupFilename: deps.application.backupFilename,
        rebuiltStates: expect.arrayContaining([
          expect.objectContaining({ learningItemId: "earlier" }),
        ]),
      }),
    );
    expect(deps.rearmDue).toHaveBeenCalledOnce();
  });

  it("leaves the repository untouched on backup or replay failure and rejects concurrent maintenance", async () => {
    const backupFailure = dependencies();
    vi.mocked(backupFailure.backup.createSnapshot).mockRejectedValueOnce(
      new Error("BACKUP_QUICK_CHECK_FAILED"),
    );
    const first = new ProfileApplicationService({
      ...backupFailure,
      nowMs: () => 10,
    });
    const token = first.preview(target.id).revisionToken;
    await expect(first.apply(target.id, token)).rejects.toThrow(
      "BACKUP_QUICK_CHECK_FAILED",
    );
    expect(backupFailure.repository.apply).not.toHaveBeenCalled();

    const validationFailure = dependencies();
    vi.mocked(
      validationFailure.backup.validateSnapshot,
    ).mockRejectedValueOnce(new Error("BACKUP_QUICK_CHECK_FAILED"));
    const validating = new ProfileApplicationService({
      ...validationFailure,
      nowMs: () => 10,
    });
    const validationToken = validating.preview(target.id).revisionToken;
    await expect(
      validating.apply(target.id, validationToken),
    ).rejects.toThrow("BACKUP_QUICK_CHECK_FAILED");
    expect(validationFailure.repository.apply).not.toHaveBeenCalled();

    const replayFailure = dependencies();
    const second = new ProfileApplicationService({
      ...replayFailure,
      nowMs: () => 10,
    });
    const replayToken = second.preview(target.id).revisionToken;
    replayFailure.replay.mockImplementationOnce(() => {
      throw new Error("REPLAY_HISTORY_CORRUPT");
    });
    await expect(
      second.apply(target.id, replayToken),
    ).rejects.toThrow("REPLAY_HISTORY_CORRUPT");
    expect(replayFailure.repository.apply).not.toHaveBeenCalled();

    const concurrent = dependencies();
    let release: (() => void) | undefined;
    vi.mocked(concurrent.backup.createSnapshot).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              kind: "automatic",
              filename: concurrent.application.backupFilename,
              path: "snapshot.sqlite3",
              createdAtMs: 10,
            });
        }),
    );
    const third = new ProfileApplicationService({
      ...concurrent,
      nowMs: () => 10,
    });
    const thirdToken = third.preview(target.id).revisionToken;
    const applying = third.apply(target.id, thirdToken);
    await Promise.resolve();
    await expect(
      third.apply(target.id, thirdToken),
    ).rejects.toThrow("PROFILE_APPLICATION_BUSY");
    release?.();
    await applying;
  });

  it("uses the identical guarded path for rollback targets", async () => {
    const deps = dependencies();
    const rollbackTarget = { ...target, status: "superseded" as const };
    vi.mocked(deps.repository.capture).mockReturnValue({
      ...capture(),
      target: rollbackTarget,
    });
    const service = new ProfileApplicationService({
      ...deps,
      nowMs: () => 10,
    });
    const preview = service.preview(rollbackTarget.id);

    await service.rollback(
      rollbackTarget.id,
      preview.revisionToken,
    );
    expect(deps.repository.apply).toHaveBeenCalledOnce();
    expect(deps.backup.createSnapshot).toHaveBeenCalledOnce();
  });

  it("shares the application maintenance lease with database restore", async () => {
    const deps = dependencies();
    const maintenance = new MaintenanceMode();
    const service = new ProfileApplicationService({
      ...deps,
      maintenance,
      nowMs: () => 10,
    });
    const preview = service.preview(target.id);
    const restoreLease = maintenance.acquire(maintenance.revision);

    try {
      await expect(
        service.apply(target.id, preview.revisionToken),
      ).rejects.toThrow("PROFILE_APPLICATION_BUSY");
      expect(deps.backup.createSnapshot).not.toHaveBeenCalled();
    } finally {
      restoreLease.release();
    }

    await expect(
      service.apply(target.id, preview.revisionToken),
    ).resolves.toEqual(deps.application);
    expect(maintenance.active).toBe(false);
    expect(maintenance.revision).toBe(1);
  });
});
