import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLOR_MODES,
  CONTRAST_RULES,
  DESIGN_TOKENS,
  MIN_RATIO,
  THEMES,
  TOKEN_CSS_NAMES,
  TYPOGRAPHY,
  auditContrast,
  buildThemeCss,
  colorSchemeFor,
  contrastRatio,
  parseHex,
  relativeLuminance,
  tokensToCssDeclarations
} from "../design-tokens.js";

const css = readFileSync(resolve(import.meta.dirname, "../themes.css"), "utf8");
const combos = THEMES.flatMap((theme) => COLOR_MODES.map((mode) => [theme, mode] as const));

describe("Kontrastberechnung nach WCAG 2.x", () => {
  it("liefert die bekannten Referenzwerte", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    // Vorgaben aus den Design-Richtungen
    expect(contrastRatio("#1E40AF", "#FFFFFF")).toBeCloseTo(8.72, 2);
    expect(contrastRatio("#2563EB", "#FFFFFF")).toBeCloseTo(5.17, 2);
    expect(contrastRatio("#FFFFFF", "#1E40AF")).toBeCloseTo(8.72, 2);
  });

  it("berechnet die relative Leuchtdichte im linearen und Potenzbereich", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 10);
    expect(relativeLuminance("#0A0A0A")).toBeCloseTo((10 / 255 / 12.92) * 1, 10);
  });

  it("parst #RRGGBB und lehnt andere Formate ab", () => {
    expect(parseHex("#1e40af")).toEqual([0x1e, 0x40, 0xaf]);
    expect(() => parseHex("#fff")).toThrow("Ungültige Farbe");
    expect(() => parseHex("rgb(0,0,0)")).toThrow("Ungültige Farbe");
  });
});

describe("Design-Tokens: Vollständigkeit", () => {
  it("definiert 4 Designs x 3 Modi mit allen Tokens als #RRGGBB", () => {
    expect(THEMES).toEqual(["pure", "immersive-cinema", "editorial-calm", "fusion"]);
    expect(COLOR_MODES).toEqual(["light", "dark", "aaa-contrast"]);
    for (const [theme, mode] of combos) {
      const tokens = DESIGN_TOKENS[theme][mode];
      expect(Object.keys(tokens).sort()).toEqual(Object.keys(TOKEN_CSS_NAMES).sort());
      for (const value of Object.values(tokens)) {
        expect(value).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it("nutzt #2563EB nie als Text- oder Buttonfarbe im hellen Modus", () => {
    for (const theme of THEMES) {
      const light = DESIGN_TOKENS[theme].light;
      expect(light.primary).not.toBe("#2563EB");
      expect(light.accent).not.toBe("#2563EB");
      expect(light.brand).toBe("#2563EB");
    }
    // Pure und Fusion: Text und Buttons #1E40AF (8,72:1)
    expect(DESIGN_TOKENS.pure.light.primary).toBe("#1E40AF");
    expect(DESIGN_TOKENS.fusion.light.accent).toBe("#1E40AF");
  });

  it("unterscheidet Hell und Dunkel je Design deutlich (Grundfläche)", () => {
    for (const theme of THEMES) {
      expect(colorSchemeFor(theme, "light")).toBe("light");
      expect(colorSchemeFor(theme, "dark")).toBe("dark");
      expect(relativeLuminance(DESIGN_TOKENS[theme].dark.canvas)).toBeLessThan(0.02);
      expect(relativeLuminance(DESIGN_TOKENS[theme].dark.panel)).toBeLessThan(0.05);
    }
  });

  it("weist jedem Design Schriften zu (Serif für Editorial und Fusion-Titel)", () => {
    expect(TYPOGRAPHY["editorial-calm"].body).toContain("Source Serif 4");
    expect(TYPOGRAPHY.fusion.headings).toContain("Source Serif 4");
    expect(TYPOGRAPHY.pure.body).toContain("Inter");
    expect(TYPOGRAPHY["immersive-cinema"].ui).toContain("Inter");
  });
});

describe.each(combos)("Kontrast %s / %s (WCAG 2.2 AAA)", (theme, mode) => {
  const results = auditContrast(theme, mode);

  it("prüft jede Regel auf jeder zulässigen Fläche", () => {
    const expected = CONTRAST_RULES.reduce((sum, r) => sum + r.backgrounds.length, 0);
    expect(results).toHaveLength(expected);
  });

  it.each(results.map((r) => [r.foreground, r.background, r.kind, r] as const))(
    "%s auf %s (%s)",
    (_fg, _bg, kind, result) => {
      expect(result.ratio).toBeGreaterThanOrEqual(MIN_RATIO[kind]);
      expect(result.passes).toBe(true);
    }
  );
});

describe("auditContrast meldet Verstöße", () => {
  it("markiert ein Paar unter der Schwelle als nicht bestanden", () => {
    const tokens = DESIGN_TOKENS.pure.light as { textMuted: string };
    const original = tokens.textMuted;
    tokens.textMuted = "#94A3B8";
    try {
      const failing = auditContrast("pure", "light").filter((r) => !r.passes);
      expect(failing.map((r) => r.foreground)).toContain("textMuted");
    } finally {
      tokens.textMuted = original;
    }
  });
});

describe("themes.css ist synchron zu design-tokens.ts", () => {
  const normalize = (s: string) => s.replace(/\s+/g, "").toLowerCase();

  it("enthält den erzeugten Tokenblock unverändert", () => {
    const start = css.indexOf("/* @tokens:start */") + "/* @tokens:start */".length;
    const end = css.indexOf("/* @tokens:end */");
    expect(start).toBeGreaterThan(20);
    expect(normalize(css.slice(start, end))).toBe(normalize(buildThemeCss()));
  });

  it.each(combos)("hat einen Block für %s / %s mit allen Deklarationen", (theme, mode) => {
    const selector = `html[data-design="${theme}"][data-color-mode="${mode}"]`;
    const at = css.indexOf(selector);
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at, css.indexOf("}", at));
    for (const decl of tokensToCssDeclarations(theme, mode)) {
      expect(normalize(block)).toContain(normalize(decl));
    }
  });

  it("verwendet nur das Attribut data-design (nicht data-theme)", () => {
    expect(css).not.toContain("data-theme");
  });
});
