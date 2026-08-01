import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

const productionApprovedLicenses = new Set([
  "(MIT OR CC0-1.0)",
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
]);

const reviewedAllScopeLicenses = new Set([
  ...productionApprovedLicenses,
  "Apache-2.0 AND LGPL-3.0-or-later",
  "CC-BY-4.0",
  "LGPL-3.0-or-later",
  "MPL-2.0",
]);

function sortedKeys(report) {
  return Object.keys(report).sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

export function validateDependencyLicenseReports(
  productionReport,
  allScopeReport,
) {
  for (const license of sortedKeys(allScopeReport)) {
    if (!reviewedAllScopeLicenses.has(license)) {
      throw new Error(`DEPENDENCY_LICENSE_UNREVIEWED:${license}`);
    }
  }

  for (const license of sortedKeys(productionReport)) {
    if (!productionApprovedLicenses.has(license)) {
      throw new Error(
        `PRODUCTION_DEPENDENCY_LICENSE_NOT_APPROVED:${license}`,
      );
    }
  }

  return {
    allCategories: sortedKeys(allScopeReport),
    allEntries: Object.values(allScopeReport).reduce(
      (total, entries) => total + entries.length,
      0,
    ),
    productionCategories: sortedKeys(productionReport),
    productionEntries: Object.values(productionReport).reduce(
      (total, entries) => total + entries.length,
      0,
    ),
  };
}

function pnpmInvocation(licenseArguments) {
  const pnpmCli = process.env["npm_execpath"];
  if (pnpmCli) {
    return {
      arguments: [pnpmCli, "licenses", "list", ...licenseArguments, "--json"],
      command: process.execPath,
    };
  }

  return {
    arguments: ["licenses", "list", ...licenseArguments, "--json"],
    command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  };
}

function readLicenseReport(licenseArguments) {
  const invocation = pnpmInvocation(licenseArguments);
  const result = spawnSync(invocation.command, invocation.arguments, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `PNPM_LICENSE_REPORT_FAILED:${result.status ?? "unknown"}\n${result.stderr}`,
    );
  }

  return JSON.parse(result.stdout);
}

export function checkInstalledDependencyLicenses() {
  const productionReport = readLicenseReport(["--prod"]);
  const allScopeReport = readLicenseReport([]);
  return validateDependencyLicenseReports(productionReport, allScopeReport);
}

function isDirectExecution() {
  return process.argv[1] !== undefined &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
  try {
    const summary = checkInstalledDependencyLicenses();
    process.stdout.write(
      `OPENRECALL_DEPENDENCY_LICENSES_OK production_entries=${summary.productionEntries} all_entries=${summary.allEntries}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
