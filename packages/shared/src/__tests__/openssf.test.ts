import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../../..");

const ALLOWED_ROOT_FILES = new Set([
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  "biome.json",
  "vitest.config.ts",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".dockerignore",
  "docker-compose.yml",
  ".git"
]);

const GITHUB_GOVERNANCE_AND_CONFIG_FILES = [
  ".github/SECURITY.md",
  ".github/SUPPORT.md",
  ".github/CONTRIBUTING.md",
  ".github/CODE_OF_CONDUCT.md",
  ".github/CITATION.cff",
  ".github/CODEOWNERS",
  ".github/FUNDING.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/ISSUE_TEMPLATE/security_vulnerability.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/dependabot.yml",
  ".github/renovate.json",
  ".github/release.yml",
  ".github/gitleaks.toml"
];

describe("OpenSSF Scorecard, Governance & Clean Root Structure (#59, #60, #61, #108)", () => {
  it("verifies scorecard.yml permissions, SARIF upload, and docs/openssf.md (#59)", () => {
    const scorecardPath = join(REPO_ROOT, ".github/workflows/scorecard.yml");
    expect(existsSync(scorecardPath)).toBe(true);
    const scorecard = readFileSync(scorecardPath, "utf-8");

    expect(scorecard).toContain("permissions: read-all");
    expect(scorecard).toContain("security-events: write");
    expect(scorecard).toContain("id-token: write");
    expect(scorecard).toContain("ossf/scorecard-action@f49aabe0b5af0936a0987cfb85d86b75731b0186");
    expect(scorecard).toContain("results.sarif");

    const openssfDocPath = join(REPO_ROOT, "docs/openssf.md");
    expect(existsSync(openssfDocPath)).toBe(true);
    const openssfDoc = readFileSync(openssfDocPath, "utf-8");
    expect(openssfDoc).toContain("RelationNotes");
    expect(openssfDoc).toContain("Token-Permissions");
    expect(openssfDoc).toContain("Pinned-Dependencies");
    expect(openssfDoc).toContain("100 % Abdeckung");
  });

  it("verifies presence and required sections of LICENSE and .github/* governance files (#60, #108)", () => {
    const license = readFileSync(join(REPO_ROOT, "LICENSE"), "utf-8");
    expect(license).toContain("Apache License");
    expect(license).toContain("Version 2.0, January 2004");

    const security = readFileSync(join(REPO_ROOT, ".github/SECURITY.md"), "utf-8");
    expect(security).toContain("Coordinated Vulnerability Disclosure");
    expect(security).toContain("security/advisories/new");
    expect(security).toContain("AES-256-GCM");

    const contributing = readFileSync(join(REPO_ROOT, ".github/CONTRIBUTING.md"), "utf-8");
    expect(contributing).toContain("Conventional Commits");
    expect(contributing).toContain("100 % Coverage-Gate");
    expect(contributing).toContain("UTF-8");

    for (const relPath of GITHUB_GOVERNANCE_AND_CONFIG_FILES) {
      expect(existsSync(join(REPO_ROOT, relPath)), `Missing ${relPath}`).toBe(true);
    }

    expect(existsSync(join(REPO_ROOT, ".editorconfig"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "CHANGELOG.md"))).toBe(true);
  });

  it("verifies PR template, CODEOWNERS, Agency README.md, and clean root directory (#61, #87, #108)", () => {
    const prTemplate = readFileSync(join(REPO_ROOT, ".github/PULL_REQUEST_TEMPLATE.md"), "utf-8");
    expect(prTemplate).toContain("100 % Testabdeckung");
    expect(prTemplate).toContain("WCAG 2.2 Level AAA");
    expect(prTemplate).toContain("UTF-8");
    expect(prTemplate).toContain("Keine KI-Kennzeichnung");

    const codeowners = readFileSync(join(REPO_ROOT, ".github/CODEOWNERS"), "utf-8");
    expect(codeowners).toContain("* @VectoDE");

    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf-8");
    expect(readme).toContain("RelationNotes");
    expect(readme).toContain("NotebookLM & RelationFlow Knowledge Studio");
    expect(readme).toContain("docs/assets/hero-banner-dark.svg");
    expect(readme).toContain("docs/assets/hero-banner-light.svg");
    expect(readme).toContain(".github/SECURITY.md");
    expect(readme).toContain(".github/CONTRIBUTING.md");

    // Enforce clean root directory (Decision #108): no stray governance or tool configs in root
    const rootEntries = readdirSync(REPO_ROOT);
    const rootFiles = rootEntries.filter((entry) => statSync(join(REPO_ROOT, entry)).isFile());
    for (const file of rootFiles) {
      expect(
        ALLOWED_ROOT_FILES.has(file),
        `Unexpected file '${file}' in repository root (Decision #108 requires .github/ placement)`
      ).toBe(true);
    }
  });
});
