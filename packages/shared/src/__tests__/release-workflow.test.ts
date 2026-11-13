import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/release.yml"), "utf-8");

function jobBlock(name: string): string {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  expect(start, `Job ${name} fehlt`).toBeGreaterThan(0);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe("Release-Workflow mit SBOM, Provenance und Sigstore (#265)", () => {
  it("veröffentlicht nur bei Versions-Tags; workflow_dispatch ist ein Probelauf", () => {
    expect(workflow).toContain('tags: ["v*.*.*"]');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s+(pull_request|pull_request_target|schedule):/m);
    expect(jobBlock("publish")).toContain(
      "if: ${{ github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') }}"
    );
  });

  it("vergibt Schreibrechte nur dem Veröffentlichungs-Job hinter dem Environment release", () => {
    expect(workflow).toMatch(/^permissions:\n\s+contents: read/m);
    const build = jobBlock("build");
    expect(build).toContain("contents: read");
    expect(build).not.toMatch(/:\s*write\b/);

    const publish = jobBlock("publish");
    expect(publish).toMatch(/environment:\n\s+name: release/);
    expect(publish).toContain("contents: write");
    expect(publish).toContain("id-token: write");
    expect(publish).toContain("attestations: write");
    expect(publish).toContain("needs: build");
  });

  it("prüft Tag gegen package.json und testet vor dem Packen", () => {
    const build = jobBlock("build");
    expect(build).toContain("passt nicht zur Version");
    expect(build.indexOf("pnpm test:coverage")).toBeLessThan(
      build.indexOf("Release-Dateien packen")
    );
    expect(build).toContain("persist-credentials: false");
  });

  it("erzeugt CycloneDX-SBOM, Changelog aus Commits und Prüfsummen", () => {
    const build = jobBlock("build");
    expect(build).toContain("anchore/sbom-action@");
    expect(build).toContain("format: cyclonedx-json");
    expect(build).toContain("git log --no-merges");
    expect(build).toContain("git describe --tags --abbrev=0 HEAD^");
    expect(build).toContain("SHA256SUMS.txt");
  });

  it("attestiert Provenance und SBOM, signiert keyless mit Sigstore und erstellt das Release", () => {
    const publish = jobBlock("publish");
    const steps = [
      "actions/attest-build-provenance@",
      "actions/attest-sbom@",
      "sigstore/cosign-installer@",
      "cosign sign-blob --yes --bundle",
      "gh release create"
    ].map((s) => publish.indexOf(s));
    expect(steps.every((i) => i > 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(publish).toContain("--verify-tag");
  });
});
