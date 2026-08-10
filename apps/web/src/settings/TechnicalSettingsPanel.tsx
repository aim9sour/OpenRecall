import type { OptimizerTechnicalInfo } from "@openrecall/contracts";
import { useI18n } from "../app/I18nProvider.js";

export function TechnicalSettingsPanel({ info }: { readonly info: OptimizerTechnicalInfo }) {
  const { t } = useI18n();
  const values = [
    [t("settings.package"), `${info.manifest.upstreamPackage}@${info.manifest.upstreamVersion}`],
    [t("settings.algorithm"), `${info.manifest.fsrsCoreVersion} / ${info.manifest.algorithmVersion}`],
    [t("settings.adapterVersion"), info.manifest.adapterVersion],
    [t("settings.optimizer.schemaVersion"), info.manifest.schemaVersion],
    [t("settings.parameterSource"), t(`settings.source.${info.parameterSource.kind}`)],
    [t("settings.optimizer.seed"), info.officialTrainingConfig.seed],
    [t("settings.optimizer.learningRate"), info.officialTrainingConfig.learningRate],
    [t("settings.optimizer.gamma"), info.officialTrainingConfig.gamma],
    [t("optimizer.eligibleExamples"), info.activeProfile.eligibleExampleCount],
    [t("settings.optimizer.reviewCutoff"), info.activeProfile.reviewCutoffMs ?? t("statistics.notAvailable")],
    [t("settings.optimizer.profileCreated"), info.activeProfile.createdAtMs ?? t("statistics.notAvailable")],
    [t("optimizer.logLoss"), info.activeProfile.metricLogLoss ?? t("statistics.notAvailable")],
    [t("optimizer.rmseBins"), info.activeProfile.metricRmseBins ?? t("statistics.notAvailable")],
  ] as const;
  return <dl className="settings-version-list">{values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}
