import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf-8");

describe("Node-Betrieb: Image, Compose, CI und Doku (#330, #338)", () => {
  const dockerfile = read("apps/worker/Dockerfile");

  it("pins the Node 26 LTS base image by digest and ships build output only", () => {
    expect(dockerfile).toMatch(/^FROM node:26\.\d+\.\d+-alpine@sha256:[0-9a-f]{64} AS base$/m);
    const runner = dockerfile.slice(dockerfile.indexOf("AS runner"));
    const copies = [...runner.matchAll(/^COPY --from=build \S+ (\S+) /gm)].map((m) => m[1]);
    expect(copies).toEqual([
      "/app/apps/worker/dist",
      "/app/apps/worker/migrations",
      "/app/apps/web/dist"
    ]);
    expect(runner).not.toMatch(/node_modules|tsx|pnpm|corepack/);
    expect(runner).toContain('CMD ["node", "apps/worker/dist/node-server.js"]');
    expect(runner).toMatch(/^HEALTHCHECK .*--start-interval/m);
    expect(runner).toMatch(/\/api\/v1\/health/);
    expect(runner).toMatch(/^USER node$/m);
  });

  it("takes VITE_TURNSTILE_SITE_KEY as build argument before the web build", () => {
    const arg = dockerfile.indexOf('ARG VITE_TURNSTILE_SITE_KEY=""');
    expect(arg).toBeGreaterThan(0);
    expect(arg).toBeLessThan(dockerfile.indexOf("pnpm --filter @notebook-lm/web build"));
  });

  it("documents both Turnstile variables in docker-compose.yml with marked test keys", () => {
    const compose = read("docker-compose.yml");
    expect(compose).toMatch(/args:\s+#[^\n]*\n(\s+#[^\n]*\n)*\s+VITE_TURNSTILE_SITE_KEY:/);
    expect(compose).toContain("TURNSTILE_SECRET_KEY: ${TURNSTILE_SECRET_KEY:-}");
    expect(compose).toContain("TEST ONLY: 1x00000000000000000000AA");
    expect(compose).toContain("TEST ONLY: 1x0000000000000000000000000000000AA");
  });

  it("runs container, runtime-parity and Node E2E jobs in CI", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("bash .github/scripts/verify-node-container.sh");
    expect(ci).toMatch(/runtime: \[workers, node\]/);
    expect(ci).toContain("bash .github/scripts/runtime-parity.sh");
    expect(ci).toContain("test:e2e:node");
    const container = read(".github/scripts/verify-node-container.sh");
    expect(container).toContain('[ "${code}" = "201" ]');
    expect(container).toContain('[ "${code}" = "503" ]');
    expect(container).toContain("TURNSTILE_NOT_CONFIGURED");
    expect(read(".github/scripts/runtime-parity.sh")).toContain("wrangler dev --local");
  });

  it("documents operation in German and English, including the Turnstile deviation", () => {
    const readme = read("README.md");
    for (const heading of [
      "## Betrieb mit Node.js und Docker",
      "## Running with Node.js and Docker (English)"
    ]) {
      expect(readme).toContain(heading);
    }
    for (const text of [
      "### Sichern",
      "### Aktualisieren",
      "### Backup",
      "### Update",
      "Abweichung von „vollständig unabhängig von Cloudflare“",
      'Deviation from "fully independent of Cloudflare"',
      "VITE_TURNSTILE_SITE_KEY",
      "TURNSTILE_SECRET_KEY",
      "nur für Entwicklung und Tests",
      "for development and tests only"
    ]) {
      expect(readme).toContain(text);
    }
  });
});
