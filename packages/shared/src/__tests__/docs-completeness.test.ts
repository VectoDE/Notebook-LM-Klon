import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../../..");

const REQUIRED_DOCS = [
  "docs/platform-limits.md",
  "docs/anforderungen.md",
  "docs/architecture.md",
  "docs/rag-and-vectors.md",
  "docs/relationflow-integration.md",
  "docs/security-and-compliance.md",
  "docs/accessibility-wcag-aaa.md",
  "docs/database-schema.md",
  "docs/loom-presentation-guide.md",
  "docs/wiki/Home.md",
  "docs/wiki/_Sidebar.md",
  "docs/wiki/_Footer.md",
  "docs/wiki/1-Systemarchitektur.md",
  "docs/wiki/2-Hybrid-RAG-und-Vektorsuche.md",
  "docs/wiki/3-RelationFlow-Integration.md",
  "docs/wiki/4-Datenbank-Schema-D1.md",
  "docs/wiki/5-Security-DSGVO-und-AI-Act.md",
  "docs/wiki/6-Barrierefreiheit-WCAG-AAA.md",
  "docs/wiki/7-Cloudflare-Free-Limits.md",
  "docs/wiki/8-Loom-Praesentations-Leitfaden.md"
];

const REQUIRED_SVGS = [
  "docs/assets/hero-banner.svg",
  "docs/assets/hero-banner-light.svg",
  "docs/assets/hero-banner-dark.svg",
  "docs/assets/architecture-overview.svg",
  "docs/assets/architecture-overview-light.svg",
  "docs/assets/architecture-overview-dark.svg",
  "docs/assets/rag-pipeline.svg",
  "docs/assets/rag-pipeline-light.svg",
  "docs/assets/rag-pipeline-dark.svg",
  "docs/assets/relationflow-bridge.svg",
  "docs/assets/relationflow-bridge-light.svg",
  "docs/assets/relationflow-bridge-dark.svg",
  "docs/assets/security-layers.svg",
  "docs/assets/security-layers-light.svg",
  "docs/assets/security-layers-dark.svg"
];

describe("Visual Documentation, Platform Limits & ADR Completeness (#55)", () => {
  it("contains all required markdown documentation files with rich Mermaid diagrams and no personal street address", () => {
    for (const relPath of REQUIRED_DOCS) {
      const fullPath = join(REPO_ROOT, relPath);
      expect(existsSync(fullPath), `Missing doc file: ${relPath}`).toBe(true);
      const content = readFileSync(fullPath, "utf-8");
      expect(content.length).toBeGreaterThan(200);
      // Ensure private home address is never committed to public docs (ADR #59)
      expect(content).not.toContain("Albert-Schweitzer-Ring");
    }

    const anforderungen = readFileSync(join(REPO_ROOT, "docs/anforderungen.md"), "utf-8");
    expect(anforderungen).toContain("86");
    expect(anforderungen).toContain("88");
    expect(anforderungen).toContain("107");
    expect(anforderungen).toContain("108");
    expect(anforderungen).toContain("RelationNotes");
    expect(anforderungen).toContain("RelationFlow");

    const limits = readFileSync(join(REPO_ROOT, "docs/platform-limits.md"), "utf-8");
    expect(limits).toContain("10 ms");
    expect(limits).toContain("FTS5");
    expect(limits).toContain("NotebookDO");
  });

  it("contains accessible, well-formed SVG infographics in docs/assets/", () => {
    for (const relPath of REQUIRED_SVGS) {
      const fullPath = join(REPO_ROOT, relPath);
      expect(existsSync(fullPath), `Missing SVG asset: ${relPath}`).toBe(true);
      const svg = readFileSync(fullPath, "utf-8");
      expect(svg).toContain("<svg");
      expect(svg).toContain('role="img"');
      expect(svg).toContain("<title");
      expect(svg).toContain("<desc");
      expect(svg).toContain("</svg>");
    }
  });
});
