import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/deploy.yml"), "utf-8");

describe("Deploy-Workflow mit manueller Freigabe (#264)", () => {
  it("startet nur von Hand und nie durch Push, PR oder Zeitplan", () => {
    const trigger = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("\npermissions:"));
    expect(trigger).toContain("workflow_dispatch:");
    expect(trigger).not.toMatch(/^\s+(push|pull_request|pull_request_target|schedule):/m);
  });

  it("läuft im Environment production (Pflicht-Freigabe) mit minimalen Rechten", () => {
    expect(workflow).toMatch(/environment:\n\s+name: production/);
    expect(workflow).toMatch(/^permissions:\n\s+contents: read/m);
    expect(workflow).not.toMatch(/:\s*write\b/);
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("persist-credentials: false");
  });

  it("liest Zugangsdaten nur aus Environment-Secrets und bricht ohne Konfiguration ab", () => {
    expect(workflow).toContain("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}");
    expect(workflow).toContain("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}");
    expect(workflow).toContain("DEPLOY_URL: ${{ vars.DEPLOY_URL }}");
    expect(workflow).toContain("Platzhalter-database_id");
    expect(workflow).toContain('"database_id": "00000000-0000-0000-0000-000000000001"');
  });

  it("baut, migriert D1, deployt und prüft danach per Smoke-Check in dieser Reihenfolge", () => {
    const order = [
      "pnpm install --frozen-lockfile",
      "pnpm test",
      "pnpm --filter @notebook-lm/web build",
      "wrangler d1 migrations apply notebook-lm-db --remote",
      "wrangler deploy",
      'tsx src/smoke-check.ts "$DEPLOY_URL"'
    ].map((cmd) => workflow.indexOf(cmd));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(workflow).toContain("if: ${{ inputs.run_migrations }}");
  });
});
