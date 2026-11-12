import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLOR_MODES,
  CONTRAST_RULES,
  DEFAULT_THEME,
  DESIGN_TOKENS,
  MIN_RATIO,
  MIXED_SURFACES,
  SCALE,
  THEMES,
  TOKEN_CSS_NAMES,
  TYPOGRAPHY,
  auditContrast,
  auditMixedSurfaces,
  buildThemeCss,
  colorSchemeFor,
  contrastMatrix,
  contrastRatio,
  mixSrgb,
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

  it("Editorial Calm nutzt Everlast-Blau: #2563EB nur als Fläche, Text #1E40AF", () => {
    const light = DESIGN_TOKENS["editorial-calm"].light;
    expect(light.brand).toBe("#2563EB");
    expect(light.logoTile).toBe("#2563EB");
    expect(light.primary).toBe("#1E40AF");
    expect(light.accent).toBe("#1E40AF");
    expect(light.focusRing).toBe("#1E40AF");
    for (const theme of THEMES) {
      for (const mode of COLOR_MODES) {
        const t = DESIGN_TOKENS[theme][mode];
        // #2563EB erreicht auf Weiß nur 5,17:1 und ist daher nie Textfarbe
        for (const key of ["textPrimary", "textSecondary", "textMuted", "primary"] as const) {
          expect(t[key]).not.toBe("#2563EB");
        }
      }
    }
  });

  it("gibt jedem Design eine eigene Farbwelt (Zuordnung 2026-11-12)", () => {
    for (const mode of COLOR_MODES) {
      for (const key of ["primary", "brand", "logoTile"] as const) {
        const values = THEMES.map((theme) => DESIGN_TOKENS[theme][mode][key]);
        expect(new Set(values).size).toBe(THEMES.length);
      }
    }
    // Fusion übernimmt nicht mehr die Palette von Pure
    for (const mode of COLOR_MODES) {
      expect(DESIGN_TOKENS.fusion[mode]).not.toEqual(DESIGN_TOKENS.pure[mode]);
      expect(DESIGN_TOKENS.fusion[mode].canvas).not.toBe(DESIGN_TOKENS.pure[mode].canvas);
    }
    // Pure verwendet weder Everlast- noch Google-Blauwerte
    const foreignBlues = ["#1A73E8", "#0B57D0", "#4285F4", "#1967D2", "#2563EB", "#1E40AF"];
    for (const mode of COLOR_MODES) {
      const values = Object.values(DESIGN_TOKENS.pure[mode]);
      for (const blue of foreignBlues) {
        expect(values).not.toContain(blue);
      }
    }
  });

  it("unterscheidet Hell und Dunkel je Design deutlich (Grundfläche)", () => {
    for (const theme of THEMES) {
      expect(colorSchemeFor(theme, "light")).toBe("light");
      expect(colorSchemeFor(theme, "dark")).toBe("dark");
      expect(relativeLuminance(DESIGN_TOKENS[theme].dark.canvas)).toBeLessThan(0.02);
      expect(relativeLuminance(DESIGN_TOKENS[theme].dark.panel)).toBeLessThan(0.05);
    }
  });

  it("gibt jedem Design eine eigene Schrift (Zuordnung Design-Umbau)", () => {
    expect(TYPOGRAPHY.pure.body).toMatch(/^"Inter Variable"/);
    expect(TYPOGRAPHY["editorial-calm"].headings).toMatch(/^"Source Serif 4 Variable"/);
    expect(TYPOGRAPHY["immersive-cinema"].body).toMatch(/^"Space Grotesk Variable"/);
    expect(TYPOGRAPHY.fusion.body).toMatch(/^"Geist Variable"/);
    const primaries = THEMES.map((t) => TYPOGRAPHY[t].headings.split(",")[0]);
    expect(new Set(primaries).size).toBe(THEMES.length);
  });

  it("setzt Serif nur für Überschriften, Fließtext und Bedienung ohne Serifen (Issue #328)", () => {
    for (const theme of THEMES) {
      expect(TYPOGRAPHY[theme].body, theme).not.toMatch(/Serif 4|Georgia|, serif$/);
      expect(TYPOGRAPHY[theme].ui, theme).not.toMatch(/Serif 4|Georgia|, serif$/);
    }
    expect(TYPOGRAPHY["editorial-calm"].body).toMatch(/^"Inter Variable"/);
  });

  it("Fließtext 16 px, Karten 12 px in allen Designs (Issue #328)", () => {
    for (const theme of THEMES) {
      expect(SCALE[theme].textBase, theme).toBe(1);
      expect(SCALE[theme].radiusMd, theme).toBe(12);
      expect(SCALE[theme].radiusLg, theme).toBe(12);
      // Spalten sind Karten (12 px); Editorial setzt bündige Spalten mit Trennlinien (0)
      expect([0, 12], theme).toContain(SCALE[theme].radiusPanel);
    }
    expect(SCALE["editorial-calm"].radiusPanel).toBe(0);
    const css = buildThemeCss();
    expect(css).not.toContain("--rn-text-base: 1.0625rem;");
    expect(css).toContain("--rn-radius-md: 12px;");
  });

  it("startet mit Pure, ohne Attribute gilt Pure mit Farbmodus nach System (Issue #328)", () => {
    expect(DEFAULT_THEME).toBe("pure");
    const generated = buildThemeCss();
    expect(generated.startsWith(':root,\nhtml[data-design="pure"]')).toBe(true);
    // Ohne Attribut: Pure Hell, bei dunklem System Pure Dunkel
    const rootBlock = generated.slice(generated.indexOf(":root {"));
    expect(rootBlock).toContain(tokensToCssDeclarations("pure", "light")[0]);
    const darkBlock = generated.slice(generated.indexOf("@media (prefers-color-scheme: dark)"));
    expect(darkBlock).toContain(tokensToCssDeclarations("pure", "dark")[0]);
  });

  it("hat eine eigene Feldfläche: Weiß im Hellen, tiefer als das Panel im Dunkeln", () => {
    for (const theme of THEMES) {
      expect(DESIGN_TOKENS[theme].light.field, theme).toBe("#FFFFFF");
      const dark = DESIGN_TOKENS[theme].dark;
      expect(relativeLuminance(dark.field), theme).toBeLessThan(relativeLuminance(dark.panel));
      for (const mode of COLOR_MODES) {
        const t = DESIGN_TOKENS[theme][mode];
        expect(contrastRatio(t.border, t.field), `${theme}/${mode}`).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(t.focusRing, t.field), `${theme}/${mode}`).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(t.textPrimary, t.field), `${theme}/${mode}`).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it("Fokusring in der Markenfarbe des Designs (Issue #328)", () => {
    for (const theme of THEMES) {
      for (const mode of COLOR_MODES) {
        const t = DESIGN_TOKENS[theme][mode];
        // Ring ist die Akzent- bzw. Textakzentfarbe des Designs, nie neutrales Schwarz/Weiß
        expect([t.primary, t.accent], `${theme}/${mode}`).toContain(t.focusRing);
        expect(["#000000", "#FFFFFF"], `${theme}/${mode}`).not.toContain(t.focusRing);
      }
    }
  });

  it("legt Skala, Abstände (4-px-Raster), Radien und Bewegung je Design fest", () => {
    for (const theme of THEMES) {
      const c = SCALE[theme];
      expect(c.textBase).toBeGreaterThanOrEqual(1);
      expect(c.textSmall).toBeGreaterThanOrEqual(0.875);
      expect(c.textH3).toBeGreaterThan(c.textBase);
      expect(c.textH2).toBeGreaterThan(c.textH3);
      // Zwischenstufe liegt echt zwischen h3 und h2 (Issue #315)
      expect(c.textLead).toBeGreaterThan(c.textH3);
      expect(c.textLead).toBeLessThan(c.textH2);
      for (const px of [c.gapWorkspace, c.padPanel, c.padHeaderY, c.padHeaderX]) {
        expect(px % 4).toBe(0);
      }
      expect(c.radiusSm).toBeLessThanOrEqual(c.radiusMd);
      expect(c.radiusMd).toBeLessThanOrEqual(c.radiusLg);
      expect(c.enterMs).toBeLessThanOrEqual(300); // UI-Übergänge höchstens 300 ms (Issue #315)
      expect(c.transitionMs).toBeLessThanOrEqual(300);
    }
    // Die Designs unterscheiden sich wirklich (nicht nur Farbe)
    const fingerprints = THEMES.map((t) => {
      const c = SCALE[t];
      return [c.textH2, c.radiusPanel, c.gapWorkspace, c.trackingHeading, c.ease].join("|");
    });
    expect(new Set(fingerprints).size).toBe(THEMES.length);
    const css = buildThemeCss();
    expect(css).toContain("--rn-radius-panel: 0px;");
    expect(css).toContain("--rn-text-base: 1rem;");
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

describe("Kontrastmatrix 4 Designs x 3 Modi (Issue #328)", () => {
  const matrix = contrastMatrix();

  it("deckt alle 12 Kombinationen ab", () => {
    expect(matrix).toHaveLength(12);
    expect(new Set(matrix.map((m) => `${m.theme}/${m.mode}`)).size).toBe(12);
  });

  it.each(matrix.map((m) => [m.theme, m.mode, m] as const))(
    "%s / %s: Text AAA (7:1), UI und Fokus mindestens 3:1",
    (_theme, _mode, m) => {
      expect(m.text).toBeGreaterThanOrEqual(7);
      expect(m.ui).toBeGreaterThanOrEqual(3);
      expect(m.focus).toBeGreaterThanOrEqual(3);
      expect(m.focus).toBeGreaterThanOrEqual(m.ui);
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

describe("Getönte Dekorflächen (workspace.css)", () => {
  const workspaceCss = readFileSync(resolve(import.meta.dirname, "../workspace.css"), "utf8");

  it("mischt wie CSS color-mix in sRGB", () => {
    expect(mixSrgb("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixSrgb("#ff0000", "#0000ff", 1)).toBe("#ff0000");
    expect(mixSrgb("#ff0000", "#0000ff", 0)).toBe("#0000ff");
  });

  it("hält auf jeder Mischfläche Text 7:1 und Symbole 3:1 (Hell und Dunkel)", () => {
    const results = auditMixedSurfaces();
    expect(results.length).toBeGreaterThan(30);
    const failures = results
      .filter((r) => !r.passes)
      .map((r) => `${r.theme}/${r.mode} ${r.surface} ${r.foreground}: ${r.ratio.toFixed(2)}`);
    expect(failures).toEqual([]);
    for (const r of results) expect(r.ratio).toBeGreaterThanOrEqual(MIN_RATIO[r.kind]);
  });

  it("prüft genau die Mischungen, die workspace.css verwendet", () => {
    for (const surface of MIXED_SURFACES) {
      const [a, b, share] = surface.mix;
      if (a === b) {
        expect(workspaceCss, surface.name).toContain(`var(${TOKEN_CSS_NAMES[a]})`);
        continue;
      }
      const declaration = `color-mix(in srgb, var(${TOKEN_CSS_NAMES[a]}) ${Math.round(share * 100)}%, var(${TOKEN_CSS_NAMES[b]}))`;
      expect(workspaceCss, surface.name).toContain(declaration);
    }
  });
});
