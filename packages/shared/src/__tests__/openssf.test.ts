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
});
