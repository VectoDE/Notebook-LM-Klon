import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/lighthouse.yml"), "utf-8");

type Assertion = [string, { maxNumericValue: number; aggregationMethod: string }];
interface LhciConfig {
  ci: {
    collect: {
      startServerCommand: string;
      url: string[];
      numberOfRuns: number;
      settings: Record<string, string>;
    };
    assert: { assertions: Record<string, Assertion> };
    upload: { target: string; outputDir: string };
  };
}

function config(profile: "mobile" | "desktop"): LhciConfig {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, `apps/web/lighthouse/lighthouserc.${profile}.json`), "utf-8")
  ) as LhciConfig;
}

describe("Lighthouse-CI für Core Web Vitals (#257)", () => {
  for (const profile of ["mobile", "desktop"] as const) {
    it(`setzt die Budgets als harte Fehler (${profile})`, () => {
      const { assertions } = config(profile).ci.assert;
      expect(assertions["largest-contentful-paint"]).toEqual([
        "error",
        { maxNumericValue: 2500, aggregationMethod: "median" }
      ]);
      expect(assertions["total-blocking-time"]?.[0]).toBe("error");
      expect(assertions["total-blocking-time"]?.[1].maxNumericValue).toBe(200);
      expect(assertions["cumulative-layout-shift"]?.[0]).toBe("error");
      expect(assertions["cumulative-layout-shift"]?.[1].maxNumericValue).toBe(0.1);
      expect(assertions["resource-summary:script:size"]?.[0]).toBe("error");
    });

    it(`misst nur lokal und speichert Reports im Dateisystem (${profile})`, () => {
      const { collect, upload } = config(profile).ci;
      expect(collect.startServerCommand).toContain("vite preview --host 127.0.0.1");
      expect(collect.url.every((u) => u.startsWith("http://127.0.0.1:"))).toBe(true);
      expect(collect.numberOfRuns).toBeGreaterThanOrEqual(3);
      expect(upload).toEqual({ target: "filesystem", outputDir: `.lighthouseci/${profile}` });
    });
  }

  it("misst mobil gedrosselt und Desktop", () => {
    expect(config("mobile").ci.collect.settings.formFactor).toBe("mobile");
    expect(config("mobile").ci.collect.settings.throttlingMethod).toBe("simulate");
    expect(config("desktop").ci.collect.settings.preset).toBe("desktop");
    expect(workflow).toContain("profile: [mobile, desktop]");
  });

  it("nutzt eine feste LHCI-Version, minimale Rechte und keinen externen Report-Speicher", () => {
    expect(workflow).toMatch(/npx --yes @lhci\/cli@\d+\.\d+\.\d+ autorun/);
    expect(workflow).not.toContain("temporary-public-storage");
    expect(workflow).not.toMatch(/:\s*write\b/);
    expect(workflow).toContain("actions/upload-artifact@");
    expect(workflow).toContain("pull_request:");
  });
});
