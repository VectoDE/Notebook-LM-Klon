import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../../..");

/** Returns the text of one job below `jobs:` in ci.yml. */
function jobBlock(content: string, job: string): string {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line === `  ${job}:`);
  expect(start, `Job '${job}' missing`).toBeGreaterThanOrEqual(0);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}[A-Za-z_][\w-]*:/.test(line));
  return [lines[start] ?? "", ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

describe("ci.yml: Worker dry-run job without Cloudflare credentials (#146)", () => {
  const ci = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf-8");

  it("bundles the Worker with --dry-run and reports size and bindings", () => {
    const job = jobBlock(ci, "worker-dry-run");
    expect(job).toContain("wrangler deploy --dry-run --outdir");
    expect(job).toContain("GITHUB_STEP_SUMMARY");
    expect(job).not.toContain("CLOUDFLARE_API_TOKEN");
    expect(job).not.toContain("secrets.");
  });

  it("pins every action to a commit SHA", () => {
    const job = jobBlock(ci, "worker-dry-run");
    const refs = [...job.matchAll(/uses:\s*([^\s#]+)/g)].map((m) => m[1] ?? "");
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toMatch(/@[0-9a-f]{40}$/);
  });
});
