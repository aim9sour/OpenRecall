import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateImportJson } from "../../packages/domain/src/index.js";

const root = new URL("../../", import.meta.url);
const workspaceManifests = [
  "package.json",
  "apps/server/package.json",
  "apps/web/package.json",
  "packages/contracts/package.json",
  "packages/database/package.json",
  "packages/domain/package.json",
  "packages/i18n/package.json",
  "packages/optimizer/package.json",
  "packages/scheduler/package.json",
  "packages/test-support/package.json",
] as const;

async function text(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

describe("repository documentation", () => {
  it("provides reciprocal, complete English and Arabic entry points", async () => {
    const [english, arabic] = await Promise.all([
      text("README.md"),
      text("README.ar.md"),
    ]);

    expect(english).toContain("[العربية](README.ar.md)");
    expect(arabic).toContain("[English](README.md)");
    for (const readme of [english, arabic]) {
      expect(readme).toContain("pnpm install --frozen-lockfile");
      expect(readme).toContain("pnpm build");
      expect(readme).toContain("pnpm start");
      expect(readme).toContain("http://127.0.0.1:3210");
      expect(readme).toMatch(/Chrome/u);
      expect(readme).toMatch(/NVDA/u);
      expect(readme).toMatch(/SQLite/u);
      expect(readme).toContain("examples/cards.valid.json");
      expect(readme).toContain("FSRS-6");
      expect(readme).toContain("ts-fsrs@5.4.1");
      expect(readme).toContain("CONTRIBUTING.md");
      expect(readme).toContain("SECURITY.md");
      expect(readme).toContain("docs/decisions/licensing.md");
      expect(readme).toMatch(/(?:local.only|محلي)/iu);
      expect(readme).toMatch(/(?:privacy|الخصوصية)/iu);
      expect(readme).toMatch(/(?:backup|نسخ احتياطي)/iu);
      expect(readme).toMatch(/(?:known v1|حدود الإصدار الأول)/iu);
    }
  });

  it("states the algorithm boundary and publishes the selected Apache identity", async () => {
    const paths = [
      "README.md",
      "README.ar.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "CHANGELOG.md",
      "docs/architecture/overview.md",
      "docs/architecture/database-schema.md",
      "docs/import/format.md",
      "docs/decisions/licensing.md",
    ];
    const documents = await Promise.all(paths.map(text));
    const combined = documents.join("\n");

    expect(combined).toMatch(/FSRS-7[\s\S]{0,160}(?:unsupported|غير مدعوم)/iu);
    expect(combined).not.toMatch(
      /(?:supports?|implements?|يشغّل|يدعم)\s+FSRS-7/iu,
    );
    expect(await text("docs/decisions/licensing.md")).toMatch(
      /Apache License 2\.0/iu,
    );
    await expect(
      access(new URL("LICENSE", root), constants.F_OK),
    ).resolves.toBeUndefined();
    expect(await text("NOTICE")).toContain(
      "Copyright 2026 Abdullah Mansour",
    );
    expect(await text("THIRD_PARTY_NOTICES.md")).toContain("Node.js");

    for (const manifestPath of workspaceManifests) {
      const manifest = JSON.parse(await text(manifestPath)) as {
        license?: string;
        version?: string;
      };
      expect(manifest, manifestPath).toMatchObject({
        license: "Apache-2.0",
        version: "1.0.0",
      });
    }
  });

  it("records the reviewed dependency-license and asset boundary", async () => {
    const [decision, review] = await Promise.all([
      text("docs/decisions/licensing.md"),
      text("docs/releases/dependency-license-review.md"),
    ]);

    expect(decision).toContain("dependency-license-review.md");
    expect(review).toContain("pnpm release:licenses");
    expect(review).toContain("Production dependency scope");
    expect(review).toContain("Apache-2.0 AND LGPL-3.0-or-later");
    expect(review).toContain("@img/sharp-libvips-linux-*");
    expect(review).toContain("MPL-2.0");
    expect(review).toContain("CC-BY-4.0");
    expect(review).toContain("apps/web/assets/icon-source.svg");
    expect(review).toMatch(/does not relicense|لا يعيد ترخيص/iu);
  });

  it("documents contribution, disclosure, architecture, and translation gates", async () => {
    const [contributing, security, architecture, schema] =
      await Promise.all([
        text("CONTRIBUTING.md"),
        text("SECURITY.md"),
        text("docs/architecture/overview.md"),
        text("docs/architecture/database-schema.md"),
      ]);

    expect(contributing).toMatch(/translation/iu);
    expect(contributing).toMatch(/RTL/iu);
    expect(contributing).toMatch(/NVDA/iu);
    expect(contributing).toMatch(/adapter/iu);
    expect(security).toMatch(
      /GitHub[\s\S]{0,100}private vulnerability reporting/iu,
    );
    expect(security).not.toMatch(
      /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u,
    );
    for (const packageName of [
      "contracts",
      "i18n",
      "scheduler",
      "optimizer",
      "domain",
      "database",
      "server",
      "web",
    ]) {
      expect(architecture).toContain(packageName);
    }
    expect(schema).toMatch(/migration/iu);
    expect(schema).toMatch(/backup/iu);
    expect(schema).toMatch(/application_id/iu);
    expect(schema).toMatch(/user_version/iu);
  });

  it("provides safe public community and support routes", async () => {
    const [conduct, support, issueConfig, security, ...issueForms] =
      await Promise.all([
        text("CODE_OF_CONDUCT.md"),
        text("SUPPORT.md"),
        text(".github/ISSUE_TEMPLATE/config.yml"),
        text("SECURITY.md"),
        text(".github/ISSUE_TEMPLATE/bug.yml"),
        text(".github/ISSUE_TEMPLATE/accessibility.yml"),
        text(".github/ISSUE_TEMPLATE/feature.yml"),
      ]);

    expect(conduct).toContain("Contributor Covenant 3.0");
    expect(support).toContain("GitHub Discussions");
    expect(issueConfig).toContain("blank_issues_enabled: false");
    expect(security).toContain("v1.x");
    for (const issueForm of issueForms) {
      expect(issueForm).toMatch(/SQLite/iu);
      expect(issueForm).toMatch(/private|sensitive|خاص|حساس/iu);
    }
  });
});

describe("documented JSON examples", () => {
  it("accepts the valid example as shared-state cards with variants", async () => {
    const valid = JSON.parse(
      await text("examples/cards.valid.json"),
    ) as unknown;
    const preview = validateImportJson(valid, new Set());

    expect(preview).toMatchObject({
      total: 2,
      valid: 2,
      duplicate: 0,
      invalid: 0,
    });
    expect(preview.acceptedItems[0]?.variants.length).toBeGreaterThan(
      0,
    );
  });

  it("reports the exact invalid paths promised by the import guide", async () => {
    const [invalidSource, guide] = await Promise.all([
      text("examples/cards.invalid.json"),
      text("docs/import/format.md"),
    ]);
    const preview = validateImportJson(
      JSON.parse(invalidSource) as unknown,
      new Set(),
    );
    const paths = preview.rows.flatMap((row) => [
      ...row.issues.map((issue) => issue.path),
      ...row.warnings.map((warning) => warning.path),
    ]);

    expect(paths).toEqual([
      "cards[0].back",
      "cards[1].variants[0].back",
      "cards[1].extra",
    ]);
    for (const path of paths) expect(guide).toContain(path);
  });
});
