import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../../..");

/**
 * Öffentliche Inhalte bleiben sachlich: keine Bewerbungsbezüge, keine Aussagen
 * im Namen fremder Firmen und kein Link auf das nicht existierende Repository
 * `VectoDE/RelationFlow`.
 */
const SCAN_ROOTS = ["README.md", "CHANGELOG.md", ".github", "docs", "apps", "packages"];
const EXTENSIONS = [".md", ".svg", ".json", ".ts", ".tsx", ".sql", ".yml", ".yaml", ".html"];
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".wrangler"]);
const SELF = "packages/shared/src/__tests__/neutral-public-content.test.ts";

function collect(path: string, out: string[]): void {
  const absolute = join(REPO_ROOT, path);
  const info = statSync(absolute, { throwIfNoEntry: false });
  if (!info) return;
  if (info.isDirectory()) {
    for (const entry of readdirSync(absolute)) {
      if (SKIP_DIRS.has(entry)) continue;
      collect(join(path, entry), out);
    }
    return;
  }
  if (EXTENSIONS.some((ext) => absolute.endsWith(ext))) out.push(absolute);
}

const files: string[] = [];
for (const root of SCAN_ROOTS) collect(root, files);

function offenders(pattern: RegExp): string[] {
  return files
    .map((file) => relative(REPO_ROOT, file).replaceAll("\\", "/"))
    .filter((file) => file !== SELF)
    .filter((file) => pattern.test(readFileSync(join(REPO_ROOT, file), "utf-8")));
}

describe("Öffentliche Inhalte ohne Bewerbungsbezug", () => {
  it("scannt eine nennenswerte Zahl von Dateien", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("nennt keine Firma, bei der sich der Autor bewirbt", () => {
    expect(offenders(/everlast/i)).toEqual([]);
  });

  it("enthält keinen Bewerbungskontext", () => {
    expect(offenders(/bewerbung|junior[- ]entwickler/i)).toEqual([]);
  });

  it("verlinkt kein nicht existierendes RelationFlow-Repository", () => {
    expect(offenders(/github\.com\/VectoDE\/RelationFlow/i)).toEqual([]);
  });
});
