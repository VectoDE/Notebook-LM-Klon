import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { inspectTextEncoding } from "../encoding.js";

const REPO_ROOT = join(import.meta.dirname, "../../../..");

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".wrangler",
  ".turbo",
  "playwright-report",
  "test-results"
]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".md",
  ".yaml",
  ".yml",
  ".html",
  ".css",
  ".svg",
  ".sql",
  ".txt",
  ".vtt",
  ".webmanifest",
  ".cff"
]);

const TEXT_FILENAMES = new Set([
  ".gitattributes",
  ".gitignore",
  ".editorconfig",
  "LICENSE",
  "CODEOWNERS"
]);

function collectTextFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) {
      continue;
    }
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...collectTextFiles(fullPath));
    } else if (stat.isFile()) {
      const ext = extname(entry).toLowerCase();
      if (TEXT_EXTENSIONS.has(ext) || TEXT_FILENAMES.has(entry)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

describe("UTF-8 & Anti-Mojibake Repository Guard", () => {
  it("detects UTF-8 BOM, replacement characters (U+FFFD), and double-encoded UTF-8 sequences", () => {
    const clean = Buffer.from("Größe, Äpfel, Überprüfung, Straße – 100 % gültig", "utf-8");
    expect(inspectTextEncoding(clean)).toEqual({
      valid: true,
      hasBom: false,
      hasReplacementChar: false,
      mojibakeMatches: []
    });

    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), clean]);
    expect(inspectTextEncoding(withBom).hasBom).toBe(true);
    expect(inspectTextEncoding(withBom).valid).toBe(false);

    const withReplacement = Buffer.from("Fehlerhaftes Zeichen: \uFFFD", "utf-8");
    expect(inspectTextEncoding(withReplacement).hasReplacementChar).toBe(true);
    expect(inspectTextEncoding(withReplacement).valid).toBe(false);

    // Construct a classic Latin-1 / Windows-1252 misinterpreted UTF-8 string via codepoints
    const mojibakeSample = Buffer.from(
      `Gr${String.fromCharCode(0xc3, 0xb6)}${String.fromCharCode(0xc3, 0x9f)}e`,
      "utf-8"
    );
    const mojibakeResult = inspectTextEncoding(mojibakeSample);
    expect(mojibakeResult.valid).toBe(false);
    expect(mojibakeResult.mojibakeMatches.length).toBeGreaterThan(0);

    // Invalid raw UTF-8 byte sequence (lone continuation byte 0x80)
    const invalidRawUtf8 = Buffer.from([0x61, 0x80, 0x62]);
    expect(inspectTextEncoding(invalidRawUtf8).valid).toBe(false);
  });

  it("verifies all tracked text files in the repository are strict UTF-8 without BOM or Mojibake", () => {
    const files = collectTextFiles(REPO_ROOT);
    expect(files.length).toBeGreaterThan(5);

    const violations: string[] = [];
    for (const filePath of files) {
      const relPath = relative(REPO_ROOT, filePath);
      const bytes = readFileSync(filePath);
      const report = inspectTextEncoding(bytes);
      if (!report.valid) {
        violations.push(
          `${relPath}: BOM=${String(report.hasBom)}, U+FFFD=${String(report.hasReplacementChar)}, Mojibake=${report.mojibakeMatches.join(", ")}`
        );
      }
    }

    expect(violations).toEqual([]);
  });
});
