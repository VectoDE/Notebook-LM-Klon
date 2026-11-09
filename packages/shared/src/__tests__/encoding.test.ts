import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
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
  ".cff",
  ".toml"
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

  it("enforces strict zero-emoji policy across all repository files (Decision #109)", () => {
    const files = collectTextFiles(REPO_ROOT);
    const emojiRegex = /\p{Extended_Pictographic}/gu;
    const emojiViolations: string[] = [];

    for (const filePath of files) {
      const relPath = relative(REPO_ROOT, filePath);
      const content = readFileSync(filePath, "utf-8");
      const matches = content.match(emojiRegex);
      if (matches && matches.length > 0) {
        const uniqueEmojis = [...new Set(matches)].join(" ");
        emojiViolations.push(`${relPath}: contains forbidden emoji(s): ${uniqueEmojis}`);
      }
    }

    expect(emojiViolations).toEqual([]);
  });

  it("enforces theme-adaptive <picture> Light & Dark Mode SVG embedding across README.md, docs/ and wiki (Decision #110)", () => {
    const markdownFiles = collectTextFiles(REPO_ROOT).filter((f) => f.endsWith(".md"));
    const emojiRegex = /\p{Extended_Pictographic}/gu;

    for (const mdPath of markdownFiles) {
      const relMd = relative(REPO_ROOT, mdPath);
      const content = readFileSync(mdPath, "utf-8");

      // Disallow raw ![alt](...assets/*.svg) markdown embeds; must use <picture> with light & dark sources
      const rawMarkdownSvgMatch = content.match(/!\[[^\]]*\]\([^)]*assets\/[^)]+\.svg\)/);
      expect(
        rawMarkdownSvgMatch,
        `${relMd} uses raw Markdown image syntax instead of theme-adaptive <picture>`
      ).toBeNull();

      const pictureBlocks = [...content.matchAll(/<picture>([\s\S]*?)<\/picture>/g)];
      for (const match of pictureBlocks) {
        const block = match[1] ?? "";
        const darkMatch = block.match(
          /<source[^>]*media="\(prefers-color-scheme:\s*dark\)"[^>]*srcset="([^"]+)"/
        );
        const lightMatch = block.match(
          /<source[^>]*media="\(prefers-color-scheme:\s*light\)"[^>]*srcset="([^"]+)"/
        );
        const imgMatch = block.match(/<img[^>]*src="([^"]+)"/);

        expect(darkMatch, `${relMd} <picture> missing dark source`).not.toBeNull();
        expect(lightMatch, `${relMd} <picture> missing light source`).not.toBeNull();
        expect(imgMatch, `${relMd} <picture> missing fallback img`).not.toBeNull();

        const darkSrc = darkMatch?.[1] ?? "";
        const lightSrc = lightMatch?.[1] ?? "";
        expect(darkSrc.endsWith("-dark.svg"), `${relMd}: ${darkSrc} must end with -dark.svg`).toBe(
          true
        );
        expect(
          lightSrc.endsWith("-light.svg"),
          `${relMd}: ${lightSrc} must end with -light.svg`
        ).toBe(true);

        // Resolve paths (for docs/wiki/*, ./assets/* maps to docs/assets/*)
        const baseDir = relMd.replace(/\\/g, "/").startsWith("docs/wiki/")
          ? join(REPO_ROOT, "docs")
          : dirname(mdPath);

        for (const svgRel of [darkSrc, lightSrc]) {
          const resolvedSvg = resolve(baseDir, svgRel);
          expect(existsSync(resolvedSvg), `Missing SVG referenced in ${relMd}: ${svgRel}`).toBe(
            true
          );
          const svgText = readFileSync(resolvedSvg, "utf-8");
          expect(svgText).toContain("<svg");
          expect(svgText).toContain("prefers-color-scheme: dark");
          expect(svgText.match(emojiRegex)).toBeNull();
        }
      }
    }
  });
});
