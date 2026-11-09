import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github/workflows");

describe("GitHub Actions Security & SHA-Pinning Policy (#4, #56)", () => {
  it("enforces 40-char commit SHA pinning on all external actions and minimal permissions", () => {
    expect(existsSync(WORKFLOWS_DIR)).toBe(true);
    const workflowFiles = readdirSync(WORKFLOWS_DIR).filter(
      (f) => f.endsWith(".yml") || f.endsWith(".yaml")
    );
    expect(workflowFiles.length).toBeGreaterThanOrEqual(2);

    const usesRegex = /^\s*-?\s*uses:\s*([^\s#]+)/gm;
    const shaPinnedRegex = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(\/[a-zA-Z0-9_.-]+)?@[0-9a-f]{40}$/;

    for (const file of workflowFiles) {
      const content = readFileSync(join(WORKFLOWS_DIR, file), "utf-8");

      // Must declare explicit top-level permissions
      expect(content, `${file} must declare permissions`).toContain("permissions:");
      expect(content, `${file} must not use write-all`).not.toContain("write-all");

      const matches = [...content.matchAll(usesRegex)];
      for (const match of matches) {
        const actionRef = match[1] ?? "";
        expect(
          shaPinnedRegex.test(actionRef),
          `Unpinned GitHub Action in ${file}: '${actionRef}' (must be 40-char commit SHA)`
        ).toBe(true);
      }
    }

    const codeql = readFileSync(join(WORKFLOWS_DIR, "codeql.yml"), "utf-8");
    expect(codeql).toContain("javascript-typescript");
    expect(codeql).toContain("github/codeql-action/init@");
    expect(codeql).toContain("github/codeql-action/analyze@");
  });

  it("validates .github/renovate.json configuration for pinned dependencies and GitHub Action SHA digests (#58, #108)", () => {
    const renovatePath = join(REPO_ROOT, ".github/renovate.json");
    expect(existsSync(renovatePath)).toBe(true);
    expect(existsSync(join(REPO_ROOT, "renovate.json"))).toBe(false);
    const renovate = JSON.parse(readFileSync(renovatePath, "utf-8")) as {
      extends: string[];
      rangeStrategy: string;
      packageRules: { matchManagers?: string[]; pinDigests?: boolean }[];
    };

    expect(renovate.extends).toContain("helpers:pinGitHubActionDigests");
    expect(renovate.rangeStrategy).toBe("pin");
    expect(
      renovate.packageRules.some(
        (rule) => rule.matchManagers?.includes("github-actions") && rule.pinDigests === true
      )
    ).toBe(true);
  });
});
