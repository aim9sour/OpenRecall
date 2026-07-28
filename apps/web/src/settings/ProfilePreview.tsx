import type {
  OptimizerProfileApplication,
  OptimizerProfilePreview as ProfilePreviewData,
  ProfileWorkloadPoint,
} from "@openrecall/contracts";
import { useState } from "react";
import type { ApiClient } from "../api/client.js";
import { useI18n } from "../app/I18nProvider.js";

function WorkloadTable({
  caption,
  points,
}: {
  readonly caption: string;
  readonly points: readonly ProfileWorkloadPoint[];
}) {
  const { t } = useI18n();
  return (
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{t("optimizer.preview.day")}</th>
          <th scope="col">{t("optimizer.preview.cards")}</th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => (
          <tr key={point.dayOffset}>
            <th scope="row">
              {t("optimizer.preview.dayOffset", {
                day: point.dayOffset + 1,
              })}
            </th>
            <td>{point.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ProfilePreview({
  action = "apply",
  api,
  profileId,
}: {
  readonly action?: "apply" | "rollback";
  readonly api: ApiClient;
  readonly profileId: string;
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<ProfilePreviewData | null>(
    null,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [applied, setApplied] =
    useState<OptimizerProfileApplication | null>(null);

  const loadPreview = async () => {
    setBusy(true);
    setError("");
    try {
      const next = await api.post<ProfilePreviewData>(
        `/api/v1/optimizer/profiles/${encodeURIComponent(profileId)}/preview`,
        {},
      );
      setPreview(next);
      setConfirmed(false);
      setApplied(null);
    } catch {
      setError(t("optimizer.preview.loadError"));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (
      preview === null ||
      !confirmed ||
      !preview.sourceMatches ||
      applied !== null
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.post<OptimizerProfileApplication>(
        `/api/v1/optimizer/profiles/${encodeURIComponent(profileId)}/${action}`,
        { revisionToken: preview.revisionToken },
      );
      setApplied(result);
      setAnnouncement(
        action === "apply"
          ? t("optimizer.preview.applied")
          : t("optimizer.preview.restored"),
      );
    } catch {
      setError(t("optimizer.preview.applyError"));
    } finally {
      setBusy(false);
    }
  };

  if (preview === null) {
    return (
      <div className="profile-preview">
        <button
          disabled={busy}
          onClick={() => void loadPreview()}
          type="button"
        >
          {busy
            ? t("optimizer.preview.loading")
            : action === "apply"
              ? t("optimizer.preview.open")
              : t("optimizer.preview.openRollback")}
        </button>
        {error !== "" && <p role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <section
      aria-labelledby={`profile-preview-${profileId}`}
      className="profile-preview panel"
    >
      <h3 id={`profile-preview-${profileId}`}>
        {t("optimizer.preview.title")}
      </h3>

      <dl className="statistics">
        <div>
          <dt>{t("optimizer.preview.scope")}</dt>
          <dd>
            {t(`optimizer.preview.scope.${preview.profile.scopeType}`)}
          </dd>
        </div>
        <div>
          <dt>{t("optimizer.preview.affectedCards")}</dt>
          <dd>{preview.affectedItemCount}</dd>
        </div>
        <div>
          <dt>{t("optimizer.preview.reviewCount")}</dt>
          <dd>{preview.reviewCount}</dd>
        </div>
        <div>
          <dt>{t("optimizer.preview.oldSource")}</dt>
          <dd>{preview.previousProfile.id}</dd>
        </div>
        <div>
          <dt>{t("optimizer.preview.newSource")}</dt>
          <dd>{preview.profile.id}</dd>
        </div>
        <div>
          <dt>{t("optimizer.preview.oldVersion")}</dt>
          <dd>{preview.previousProfile.algorithmVersion}</dd>
        </div>
        <div>
          <dt>{t("optimizer.preview.newVersion")}</dt>
          <dd>{preview.profile.algorithmVersion}</dd>
        </div>
        <div>
          <dt>{t("settings.adapterVersion")}</dt>
          <dd>{preview.profile.adapterVersion}</dd>
        </div>
        <div>
          <dt>{t("optimizer.preview.packageVersion")}</dt>
          <dd>
            {preview.profile.packageVersion ??
              t("statistics.notAvailable")}
          </dd>
        </div>
        <div>
          <dt>{t("optimizer.eligibleExamples")}</dt>
          <dd>{preview.profile.eligibleExampleCount}</dd>
        </div>
        <div>
          <dt>{t("optimizer.logLoss")}</dt>
          <dd>
            {preview.profile.metricLogLoss ??
              t("statistics.notAvailable")}
          </dd>
        </div>
        <div>
          <dt>{t("optimizer.rmseBins")}</dt>
          <dd>
            {preview.profile.metricRmseBins ??
              t("statistics.notAvailable")}
          </dd>
        </div>
      </dl>

      <h4>{t("optimizer.preview.dueShifts")}</h4>
      <dl className="statistics">
        <div>
          <dt>{t("optimizer.preview.earlier")}</dt>
          <dd>{preview.dueShift.earlier}</dd>
        </div>
        <div>
          <dt>{t("optimizer.preview.later")}</dt>
          <dd>{preview.dueShift.later}</dd>
        </div>
        <div>
          <dt>{t("optimizer.preview.unchanged")}</dt>
          <dd>{preview.dueShift.unchanged}</dd>
        </div>
      </dl>

      <div className="table-scroll">
        <WorkloadTable
          caption={t("optimizer.preview.oldWorkload")}
          points={preview.oldWorkload}
        />
      </div>
      <div className="table-scroll">
        <WorkloadTable
          caption={t("optimizer.preview.newWorkload")}
          points={preview.newWorkload}
        />
      </div>

      {!preview.sourceMatches && (
        <p role="alert">{t("optimizer.preview.stale")}</p>
      )}

      <div className="field">
        <input
          checked={confirmed}
          disabled={!preview.sourceMatches || applied !== null}
          id={`profile-confirm-${profileId}`}
          onChange={(event) => setConfirmed(event.currentTarget.checked)}
          type="checkbox"
        />
        <label htmlFor={`profile-confirm-${profileId}`}>
          {t("optimizer.preview.confirm")}
        </label>
      </div>
      <button
        disabled={
          !confirmed ||
          !preview.sourceMatches ||
          busy ||
          applied !== null
        }
        onClick={() => void commit()}
        type="button"
      >
        {busy
          ? t("optimizer.preview.applying")
          : action === "apply"
            ? t("optimizer.preview.apply")
            : t("optimizer.preview.restore")}
      </button>

      {error !== "" && <p role="alert">{error}</p>}
      <p aria-live="polite" role="status">
        {announcement}
      </p>
    </section>
  );
}
