import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf-8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__" || entry === "assets") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(md|yml|yaml|json|txt|cff)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("README.md: Kapitel, Links und Offenlegung (#149)", () => {
  const readme = read("README.md");
  const headings = [...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1] ?? "");

  it("contains every required chapter", () => {
    const required = [
      "Systemarchitektur auf einen Blick",
      "Schnellstart",
      "Die vier Designs",
      "Die sechs Studio-Werkzeuge",
      "Sicherheit, Barrierefreiheit & DSGVO",
      "Ehrlicher KI-Einsatz",
      "Andocken an RelationFlow",
      "API-Referenz (OpenAPI 3.1)"
    ];
    for (const title of required) {
      expect(
        headings.some((h) => h.startsWith(title)),
        `Kapitel fehlt: ${title}`
      ).toBe(true);
    }
    expect(readme).toContain("```mermaid");
  });

  it("names all four designs and all six studio tools", () => {
    for (const name of ["Pure NotebookLM", "Immersive Cinema", "Editorial Calm", "Fusion"]) {
      expect(readme).toContain(name);
    }
    for (const tool of [
      "Audio-Overview",
      "Video-Overview",
      "Mindmap",
      "Lernkarten",
      "Quiz",
      "Briefing"
    ]) {
      expect(readme).toContain(`**${tool}**`);
    }
  });

  it("only links to files and anchors that exist", () => {
    const targets = [
      ...[...readme.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1] ?? ""),
      ...[...readme.matchAll(/(?:src|srcset|href)="([^"]+)"/g)].map((m) => m[1] ?? "")
    ];
    const anchors = new Set(
      headings.map((h) =>
        h
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, "")
          .trim()
          .replaceAll(" ", "-")
      )
    );
    expect(targets.length).toBeGreaterThan(20);
    for (const target of targets) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      if (target.startsWith("#")) {
        expect(anchors.has(target.slice(1)), `Anker fehlt: ${target}`).toBe(true);
        continue;
      }
      const file = target.split("#")[0] ?? "";
      expect(existsSync(resolve(REPO_ROOT, file)), `Link-Ziel fehlt: ${target}`).toBe(true);
    }
  });

  it("does not claim the unbuilt RelationFlow export as implemented", () => {
    expect(readme).toContain("Noch nicht umgesetzt");
    expect(readme).not.toContain("Extrahiert typisierte Entitäten");
  });
});

describe("Repository-Text: keine KI-Co-Author-Zeilen (#149)", () => {
  it("contains no AI attribution lines in README, docs, .github or CHANGELOG", () => {
    const files = [
      join(REPO_ROOT, "README.md"),
      join(REPO_ROOT, "CHANGELOG.md"),
      ...walk(join(REPO_ROOT, "docs")),
      ...walk(join(REPO_ROOT, ".github"))
    ];
    const forbidden = [/co-authored-by:\s*claude/i, /generated with \[?claude/i, /\u{1F916}/u];
    for (const file of files) {
      const text = readFileSync(file, "utf-8");
      for (const pattern of forbidden) {
        // CONTRIBUTING and the PR template name the rule itself; only attribution lines count.
        const lines = text
          .split("\n")
          .filter((line) => pattern.test(line) && !/(verbot|nicht|keine|never|forbid)/i.test(line));
        expect(lines, `${file}: ${pattern}`).toEqual([]);
      }
    }
  }, 60_000);
});

describe("docs/openssf.md: Pflichtkapitel (#148)", () => {
  const doc = read("docs/openssf.md");

  it("has all required chapters", () => {
    for (const chapter of [
      "## 1. OpenSSF Scorecard Checks",
      "## 2. OpenSSF Best Practices (Passing)",
      "## 3. Strukturelle Einzelentwickler-Ausnahmen",
      "## 4. Release-Checkliste",
      "## 5. Offene Punkte und Inhaber-Schritte"
    ]) {
      expect(doc, `Kapitel fehlt: ${chapter}`).toContain(chapter);
    }
  });

  it("covers the Passing criteria groups and the single-maintainer exception honestly", () => {
    for (const group of [
      "Basics",
      "Change Control",
      "Reporting",
      "Quality",
      "Security",
      "Analysis"
    ]) {
      expect(doc).toContain(group);
    }
    expect(doc).toContain("Zweite Freigabe");
    expect(doc).toContain("Code-Review");
    expect(doc).toContain("Es gibt noch kein Projekt auf bestpractices.dev");
    expect(doc).not.toMatch(/openssf best practices[^\n]*passing\]/i);
  });

  it("documents the signed release flow with verification commands", () => {
    expect(doc).toContain("gh attestation verify");
    expect(doc).toContain("sha256sum -c SHA256SUMS.txt");
    expect(doc).toContain("release.yml");
    expect(doc).toContain("deploy.yml");
  });
});

describe("docs/loom-guide.md: Leitfaden und E-Mail-Entwurf (#151)", () => {
  const guide = read("docs/loom-guide.md");

  it("has a timed script that ends within ten minutes", () => {
    const ends = [...guide.matchAll(/\| \d:\d{2} – (\d):(\d{2}) \|/g)].map((m) => [
      Number(m[1]),
      Number(m[2])
    ]);
    expect(ends.length).toBeGreaterThanOrEqual(8);
    const last = ends[ends.length - 1] ?? [99, 0];
    expect(last[0] ?? 99).toBeLessThanOrEqual(9);
    for (const section of ["Audio-Overview", "Video-Overview", "Designs", "Code-Walkthrough"]) {
      expect(guide).toContain(section);
    }
  });

  it("keeps live and Loom links as marked owner steps and contains no personal data", () => {
    expect(guide).toContain("{{LIVE_URL}}");
    expect(guide).toContain("{{LOOM_URL}}");
    expect(guide).toContain("Nicht versendet");
    expect(guide).not.toContain("Albert-Schweitzer-Ring");
    expect(guide).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(guide).not.toContain("—");
  });
});
