import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../../..");

describe("OpenSSF Scorecard Workflow & Documentation (#59)", () => {
  it("verifies scorecard.yml permissions, SARIF upload, and docs/openssf.md", () => {
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
  });

  it("verifies presence and required sections of LICENSE, SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SUPPORT.md & CITATION.cff (#60)", () => {
    const license = readFileSync(join(REPO_ROOT, "LICENSE"), "utf-8");
    expect(license).toContain("Apache License");
    expect(license).toContain("Version 2.0, January 2004");

    const security = readFileSync(join(REPO_ROOT, "SECURITY.md"), "utf-8");
    expect(security).toContain("Coordinated Vulnerability Disclosure");
    expect(security).toContain("security/advisories/new");
    expect(security).toContain("AES-256-GCM");

    const contributing = readFileSync(join(REPO_ROOT, "CONTRIBUTING.md"), "utf-8");
    expect(contributing).toContain("Conventional Commits");
    expect(contributing).toContain("100 % Coverage-Gate");
    expect(contributing).toContain("UTF-8");

    expect(existsSync(join(REPO_ROOT, "CODE_OF_CONDUCT.md"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "SUPPORT.md"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "CITATION.cff"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, ".editorconfig"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "CHANGELOG.md"))).toBe(true);
  });
});
