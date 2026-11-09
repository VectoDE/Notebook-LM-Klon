import type { DeploymentProfile } from "@notebook-lm/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { resolveAppConfig } from "../config.js";
import { buildSafeFts5MatchQuery } from "../fts5-probe.js";

describe("Property-Based & Fuzz Testing – Worker FTS5 Sanitizer & Config (fast-check, Decision #107)", () => {
  it("fuzzes buildSafeFts5MatchQuery against arbitrary punctuation, SQL injection, and FTS5 operators", () => {
    fc.assert(
      fc.property(fc.string(), (arbitraryInput) => {
        const sanitized = buildSafeFts5MatchQuery(arbitraryInput);
        expect(sanitized).not.toMatch(/[*:^()-]/);
        if (sanitized.length > 0) {
          const tokens = sanitized.split(" ");
          for (const token of tokens) {
            expect(token.startsWith('"')).toBe(true);
            expect(token.endsWith('"')).toBe(true);
            expect(token.length).toBeGreaterThanOrEqual(3);
          }
        }
      }),
      { numRuns: 250 }
    );
  });

  it("ensures resolveAppConfig safely falls back to demo quotas for any arbitrary profile string", () => {
    fc.assert(
      fc.property(fc.string(), (rawProfile) => {
        const config = resolveAppConfig({ APP_PROFILE: rawProfile as DeploymentProfile });
        if (rawProfile === "full") {
          expect(config.profile).toBe("full");
          expect(config.quotas.maxNotebooksPerUser).toBe(100);
        } else {
          expect(config.profile).toBe("demo");
          expect(config.quotas.maxNotebooksPerUser).toBe(3);
        }
      }),
      { numRuns: 100 }
    );
  });
});
