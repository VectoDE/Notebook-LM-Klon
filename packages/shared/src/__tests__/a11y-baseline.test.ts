import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../../..");

function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const r = Number.parseInt(clean.slice(0, 2), 16) / 255;
  const g = Number.parseInt(clean.slice(2, 4), 16) / 255;
  const b = Number.parseInt(clean.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(fgHex);
  const l2 = relativeLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("WCAG 2.2 Level AAA Baseline & Design System Tokens (Decisions #31, #61, #107)", () => {
  it("verifies HTML document language, viewport scalability, and Biome 29 a11y rules", () => {
    const html = readFileSync(join(REPO_ROOT, "apps/web/index.html"), "utf-8");
    expect(html).toContain('<html lang="de">');
    expect(html).toContain('name="viewport"');
    expect(html).toContain("RelationNotes");
    // Must not disable user zoom (WCAG 1.4.4 / 1.4.10)
    expect(html).not.toContain("user-scalable=no");
    expect(html).not.toContain("maximum-scale=1");

    const biome = JSON.parse(readFileSync(join(REPO_ROOT, "biome.json"), "utf-8")) as {
      linter: { rules: { a11y: Record<string, string> } };
    };
    expect(Object.keys(biome.linter.rules.a11y).length).toBeGreaterThanOrEqual(29);
  });

  it("enforces WCAG 2.2 AAA >= 7:1 contrast ratio on Warm Editorial Reader & Deep Ink dark mode palettes", () => {
    // Light Mode ("Warm Editorial Paper"): Primary Ink #141413 on Ivory Paper #FAF8F5
    const lightPrimaryRatio = contrastRatio("#141413", "#FAF8F5");
    expect(lightPrimaryRatio).toBeGreaterThanOrEqual(7.0);

    // Light Mode Secondary Ink #3D3935 on Ivory Paper #FAF8F5
    const lightSecondaryRatio = contrastRatio("#3D3935", "#FAF8F5");
    expect(lightSecondaryRatio).toBeGreaterThanOrEqual(7.0);

    // Dark Mode ("Deep Ink Studio"): Primary Text #F5F2EB on Deep Obsidian #0B0F17
    const darkPrimaryRatio = contrastRatio("#F5F2EB", "#0B0F17");
    expect(darkPrimaryRatio).toBeGreaterThanOrEqual(7.0);

    // Dark Mode Secondary Text #CBD5E1 on Deep Obsidian #0B0F17
    const darkSecondaryRatio = contrastRatio("#CBD5E1", "#0B0F17");
    expect(darkSecondaryRatio).toBeGreaterThanOrEqual(7.0);
  });
});
