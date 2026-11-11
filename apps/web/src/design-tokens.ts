/**
 * Farb-Tokens der vier Design-Richtungen (Pure, Immersive Cinema, Editorial Calm, Fusion)
 * in den drei Farbmodi Hell, Dunkel und AAA-Hochkontrast.
 *
 * Einzige Quelle für alle Farbwerte: themes.css spiegelt diese Tabelle 1:1
 * (per Test abgesichert), die Kontrast-Tests rechnen direkt mit diesen Werten.
 *
 * Grundregeln (Design-Richtungen 2026-11-11):
 * - Text, Links, Buttons und Fokus nutzen #1E40AF (8,72:1 auf Weiß) bzw. eine
 *   hellere AAA-Stufe auf dunklem Grund. #2563EB nur für Flächen und Grafik.
 * - Jede Textfarbe erreicht auf jeder Fläche, auf der sie stehen kann, mindestens 7:1
 *   (WCAG 2.2 SC 1.4.6, AAA). Rahmen, Fokus und Grafik mindestens 3:1 (SC 1.4.11).
 */

export type DesignTheme = "pure" | "immersive-cinema" | "editorial-calm" | "fusion";
export type ColorMode = "light" | "dark" | "aaa-contrast";

export const THEMES: readonly DesignTheme[] = [
  "pure",
  "immersive-cinema",
  "editorial-calm",
  "fusion"
] as const;

export const COLOR_MODES: readonly ColorMode[] = ["light", "dark", "aaa-contrast"] as const;

export interface ColorTokens {
  /** Grundfläche hinter den Panels */
  readonly canvas: string;
  /** Panels, Karten, Kopfzeile */
  readonly panel: string;
  /** Abgesetzte Flächen in Panels (Chips, Eingaben, Kartenrückseiten) */
  readonly surfaceVariant: string;
  /** Rahmen von Bedienelementen (mindestens 3:1) */
  readonly border: string;
  /** Trennlinien ohne Funktion (dekorativ) */
  readonly divider: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  /** Links, aktive Reiter, Akzent-Text */
  readonly primary: string;
  /** Fläche von Haupt-Buttons */
  readonly accent: string;
  readonly accentHover: string;
  /** Text auf accent und accentHover */
  readonly accentText: string;
  /** Markenfarbe als Fläche/Grafik (#2563EB bzw. AAA-taugliche Grafikstufe) */
  readonly brand: string;
  readonly focusRing: string;
  /** Hinterlegung für markierte Zitatstellen */
  readonly highlight: string;
  readonly error: string;
  readonly errorSurface: string;
  readonly success: string;
  readonly successSurface: string;
  /** Dunkle Bühne für Audio, Video und Graph */
  readonly stageBg: string;
  readonly stageText: string;
  readonly stageMuted: string;
  readonly stageAccent: string;
  /** Logo: Kachel und zweiter Wortteil "Notes" */
  readonly logoTile: string;
  readonly logoAccent: string;
}

export interface TypographyTokens {
  readonly body: string;
  readonly headings: string;
  readonly ui: string;
}

const SANS = '"Inter Variable", "Inter", system-ui, sans-serif';
const SERIF = '"Source Serif 4 Variable", "Source Serif 4", Georgia, serif';
export const FONT_MONO = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace';

export const TYPOGRAPHY: Record<DesignTheme, TypographyTokens> = {
  pure: { body: SANS, headings: SANS, ui: SANS },
  "immersive-cinema": { body: SANS, headings: SANS, ui: SANS },
  "editorial-calm": { body: SERIF, headings: SERIF, ui: SANS },
  fusion: { body: SANS, headings: SERIF, ui: SANS }
};

export const DESIGN_TOKENS: Record<DesignTheme, Record<ColorMode, ColorTokens>> = {
  pure: {
    light: {
      canvas: "#F8FAFC",
      panel: "#FFFFFF",
      surfaceVariant: "#F1F5F9",
      border: "#64748B",
      divider: "#E2E8F0",
      textPrimary: "#0F172A",
      textSecondary: "#334155",
      textMuted: "#334155",
      primary: "#1E40AF",
      accent: "#1E40AF",
      accentHover: "#1E3A8A",
      accentText: "#FFFFFF",
      brand: "#2563EB",
      focusRing: "#1E40AF",
      highlight: "#DBEAFE",
      error: "#991B1B",
      errorSurface: "#FEF2F2",
      success: "#14532D",
      successSurface: "#F0FDF4",
      stageBg: "#0F172A",
      stageText: "#F8FAFC",
      stageMuted: "#CBD5E1",
      stageAccent: "#93C5FD",
      logoTile: "#2563EB",
      logoAccent: "#2563EB"
    },
    dark: {
      canvas: "#111318",
      panel: "#1B1E25",
      surfaceVariant: "#252932",
      border: "#94A3B8",
      divider: "#2F3540",
      textPrimary: "#F1F5F9",
      textSecondary: "#D7DEE8",
      textMuted: "#CBD5E1",
      primary: "#BFDBFE",
      accent: "#BFDBFE",
      accentHover: "#DBEAFE",
      accentText: "#111318",
      brand: "#3B82F6",
      focusRing: "#BFDBFE",
      highlight: "#1E3A8A",
      error: "#FECACA",
      errorSurface: "#3B1219",
      success: "#BBF7D0",
      successSurface: "#0F2A1C",
      stageBg: "#0B0D12",
      stageText: "#F8FAFC",
      stageMuted: "#CBD5E1",
      stageAccent: "#93C5FD",
      logoTile: "#2563EB",
      logoAccent: "#93C5FD"
    },
    "aaa-contrast": {
      canvas: "#FFFFFF",
      panel: "#FFFFFF",
      surfaceVariant: "#F1F5F9",
      border: "#0F172A",
      divider: "#334155",
      textPrimary: "#000000",
      textSecondary: "#0F172A",
      textMuted: "#1E293B",
      primary: "#1E3A8A",
      accent: "#1E3A8A",
      accentHover: "#0F172A",
      accentText: "#FFFFFF",
      brand: "#1E40AF",
      focusRing: "#000000",
      highlight: "#FEF08A",
      error: "#7F1D1D",
      errorSurface: "#FFFFFF",
      success: "#14532D",
      successSurface: "#FFFFFF",
      stageBg: "#000000",
      stageText: "#FFFFFF",
      stageMuted: "#F1F5F9",
      stageAccent: "#BFDBFE",
      logoTile: "#1E3A8A",
      logoAccent: "#1E3A8A"
    }
  },
  "immersive-cinema": {
    light: {
      canvas: "#E8ECF6",
      panel: "#FFFFFF",
      surfaceVariant: "#F1F4FA",
      border: "#5B6478",
      divider: "#D5DBE8",
      textPrimary: "#0B1020",
      textSecondary: "#283044",
      textMuted: "#3A4358",
      primary: "#1E40AF",
      accent: "#1E40AF",
      accentHover: "#1E3A8A",
      accentText: "#FFFFFF",
      brand: "#2563EB",
      focusRing: "#1E40AF",
      highlight: "#DBEAFE",
      error: "#991B1B",
      errorSurface: "#FEF2F2",
      success: "#14532D",
      successSurface: "#F0FDF4",
      stageBg: "#0B1020",
      stageText: "#F1F5F9",
      stageMuted: "#CBD5E1",
      stageAccent: "#67E8F9",
      logoTile: "#2563EB",
      logoAccent: "#2563EB"
    },
    dark: {
      canvas: "#0B1020",
      panel: "#151B30",
      surfaceVariant: "#1D2540",
      border: "#94A3B8",
      divider: "#28314F",
      textPrimary: "#F1F5F9",
      textSecondary: "#CBD5E1",
      textMuted: "#CBD5E1",
      primary: "#93C5FD",
      accent: "#93C5FD",
      accentHover: "#BFDBFE",
      accentText: "#0B1020",
      brand: "#3B82F6",
      focusRing: "#67E8F9",
      highlight: "#1E3A8A",
      error: "#FCA5A5",
      errorSurface: "#2A1020",
      success: "#86EFAC",
      successSurface: "#0C2420",
      stageBg: "#05070F",
      stageText: "#F1F5F9",
      stageMuted: "#CBD5E1",
      stageAccent: "#67E8F9",
      logoTile: "#2563EB",
      logoAccent: "#93C5FD"
    },
    "aaa-contrast": {
      canvas: "#05070F",
      panel: "#0B1020",
      surfaceVariant: "#151B30",
      border: "#E2E8F0",
      divider: "#94A3B8",
      textPrimary: "#FFFFFF",
      textSecondary: "#F1F5F9",
      textMuted: "#E2E8F0",
      primary: "#A5F3FC",
      accent: "#A5F3FC",
      accentHover: "#FFFFFF",
      accentText: "#05070F",
      brand: "#60A5FA",
      focusRing: "#A5F3FC",
      highlight: "#164E63",
      error: "#FECACA",
      errorSurface: "#0B1020",
      success: "#BBF7D0",
      successSurface: "#0B1020",
      stageBg: "#000000",
      stageText: "#FFFFFF",
      stageMuted: "#F1F5F9",
      stageAccent: "#A5F3FC",
      logoTile: "#2563EB",
      logoAccent: "#A5F3FC"
    }
  },
  "editorial-calm": {
    light: {
      canvas: "#FAF8F3",
      panel: "#FFFDF8",
      surfaceVariant: "#EFEBE0",
      border: "#6B645D",
      divider: "#DDD6C8",
      textPrimary: "#1C1917",
      textSecondary: "#44403C",
      textMuted: "#44403C",
      primary: "#1E3A8A",
      accent: "#1E3A8A",
      accentHover: "#172554",
      accentText: "#FAF8F3",
      brand: "#2563EB",
      focusRing: "#1E3A8A",
      highlight: "#FDE7C7",
      error: "#7F1D1D",
      errorSurface: "#FDF2F2",
      success: "#14532D",
      successSurface: "#F0F7EE",
      stageBg: "#1C1917",
      stageText: "#FAF8F3",
      stageMuted: "#D6D3D1",
      stageAccent: "#FDBA74",
      logoTile: "#2563EB",
      logoAccent: "#2563EB"
    },
    dark: {
      canvas: "#1C1917",
      panel: "#26221F",
      surfaceVariant: "#312C28",
      border: "#A8A29E",
      divider: "#3D3732",
      textPrimary: "#FAF8F3",
      textSecondary: "#E7E5E4",
      textMuted: "#D6D3D1",
      primary: "#BFDBFE",
      accent: "#BFDBFE",
      accentHover: "#DBEAFE",
      accentText: "#1C1917",
      brand: "#3B82F6",
      focusRing: "#FDBA74",
      highlight: "#5B3A1A",
      error: "#FECACA",
      errorSurface: "#3A1A18",
      success: "#BBF7D0",
      successSurface: "#1A2A1C",
      stageBg: "#0F0D0C",
      stageText: "#FAF8F3",
      stageMuted: "#D6D3D1",
      stageAccent: "#FDBA74",
      logoTile: "#2563EB",
      logoAccent: "#93C5FD"
    },
    "aaa-contrast": {
      canvas: "#FFFDF7",
      panel: "#FFFFFF",
      surfaceVariant: "#F5F0E6",
      border: "#1C1917",
      divider: "#44403C",
      textPrimary: "#000000",
      textSecondary: "#1C1917",
      textMuted: "#292524",
      primary: "#172554",
      accent: "#172554",
      accentHover: "#000000",
      accentText: "#FFFFFF",
      brand: "#1E40AF",
      focusRing: "#000000",
      highlight: "#FEF08A",
      error: "#7F1D1D",
      errorSurface: "#FFFFFF",
      success: "#14532D",
      successSurface: "#FFFFFF",
      stageBg: "#000000",
      stageText: "#FFFFFF",
      stageMuted: "#F5F5F4",
      stageAccent: "#FED7AA",
      logoTile: "#172554",
      logoAccent: "#172554"
    }
  },
  fusion: {
    light: {
      canvas: "#F8FAFC",
      panel: "#FFFFFF",
      surfaceVariant: "#F1F5F9",
      border: "#64748B",
      divider: "#E2E8F0",
      textPrimary: "#0F172A",
      textSecondary: "#334155",
      textMuted: "#334155",
      primary: "#1E40AF",
      accent: "#1E40AF",
      accentHover: "#1E3A8A",
      accentText: "#FFFFFF",
      brand: "#2563EB",
      focusRing: "#1E40AF",
      highlight: "#FDE7C7",
      error: "#991B1B",
      errorSurface: "#FEF2F2",
      success: "#14532D",
      successSurface: "#F0FDF4",
      stageBg: "#0F172A",
      stageText: "#F8FAFC",
      stageMuted: "#CBD5E1",
      stageAccent: "#7DD3FC",
      logoTile: "#2563EB",
      logoAccent: "#2563EB"
    },
    dark: {
      canvas: "#0F172A",
      panel: "#1E293B",
      surfaceVariant: "#273449",
      border: "#94A3B8",
      divider: "#334155",
      textPrimary: "#F8FAFC",
      textSecondary: "#E2E8F0",
      textMuted: "#CBD5E1",
      primary: "#BAE6FD",
      accent: "#7DD3FC",
      accentHover: "#BAE6FD",
      accentText: "#0F172A",
      brand: "#3B82F6",
      focusRing: "#7DD3FC",
      highlight: "#7C2D12",
      error: "#FECACA",
      errorSurface: "#3B1A24",
      success: "#BBF7D0",
      successSurface: "#13302A",
      stageBg: "#020617",
      stageText: "#F8FAFC",
      stageMuted: "#CBD5E1",
      stageAccent: "#7DD3FC",
      logoTile: "#3B82F6",
      logoAccent: "#7DD3FC"
    },
    "aaa-contrast": {
      canvas: "#000000",
      panel: "#0A0A0A",
      surfaceVariant: "#171717",
      border: "#FFFFFF",
      divider: "#A3A3A3",
      textPrimary: "#FFFFFF",
      textSecondary: "#F5F5F5",
      textMuted: "#E5E5E5",
      primary: "#FDE047",
      accent: "#FDE047",
      accentHover: "#FFFFFF",
      accentText: "#000000",
      brand: "#60A5FA",
      focusRing: "#FDE047",
      highlight: "#713F12",
      error: "#FECACA",
      errorSurface: "#0A0A0A",
      success: "#BBF7D0",
      successSurface: "#0A0A0A",
      stageBg: "#000000",
      stageText: "#FFFFFF",
      stageMuted: "#F5F5F5",
      stageAccent: "#FDE047",
      logoTile: "#2563EB",
      logoAccent: "#FDE047"
    }
  }
};

/** CSS-Variablenname je Token (Präfix --rn-color-). */
export const TOKEN_CSS_NAMES: Record<keyof ColorTokens, string> = {
  canvas: "--rn-color-canvas",
  panel: "--rn-color-panel",
  surfaceVariant: "--rn-color-surface-variant",
  border: "--rn-color-border",
  divider: "--rn-color-panel-border",
  textPrimary: "--rn-color-text-primary",
  textSecondary: "--rn-color-text-secondary",
  textMuted: "--rn-color-text-muted",
  primary: "--rn-color-primary",
  accent: "--rn-color-accent",
  accentHover: "--rn-color-accent-hover",
  accentText: "--rn-color-accent-text",
  brand: "--rn-color-brand",
  focusRing: "--rn-color-focus-ring",
  highlight: "--rn-color-highlight",
  error: "--rn-color-error",
  errorSurface: "--rn-color-error-surface",
  success: "--rn-color-success",
  successSurface: "--rn-color-success-surface",
  stageBg: "--rn-color-stage-bg",
  stageText: "--rn-color-stage-text",
  stageMuted: "--rn-color-stage-muted",
  stageAccent: "--rn-color-stage-accent",
  logoTile: "--rn-color-logo-tile",
  logoAccent: "--rn-color-logo-accent"
};

/** Parst #RRGGBB in [r, g, b] (0–255). */
export function parseHex(hex: string): readonly [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match?.[1]) {
    throw new Error(`Ungültige Farbe: ${hex} (erwartet #RRGGBB)`);
  }
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative Leuchtdichte nach WCAG 2.x. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Kontrastverhältnis nach WCAG 2.x, z. B. 8.72 für #1E40AF auf #FFFFFF. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastKind = "text" | "ui";

export interface ContrastRule {
  readonly foreground: keyof ColorTokens;
  readonly backgrounds: readonly (keyof ColorTokens)[];
  readonly kind: ContrastKind;
}

const TEXT_SURFACES: readonly (keyof ColorTokens)[] = ["canvas", "panel", "surfaceVariant"];

/**
 * Welche Vordergrund-Tokens auf welchen Flächen stehen dürfen.
 * text: mindestens 7:1 (AAA, SC 1.4.6); ui: mindestens 3:1 (SC 1.4.11).
 */
export const CONTRAST_RULES: readonly ContrastRule[] = [
  { foreground: "textPrimary", backgrounds: [...TEXT_SURFACES, "highlight"], kind: "text" },
  { foreground: "textSecondary", backgrounds: TEXT_SURFACES, kind: "text" },
  { foreground: "textMuted", backgrounds: TEXT_SURFACES, kind: "text" },
  { foreground: "primary", backgrounds: TEXT_SURFACES, kind: "text" },
  { foreground: "accentText", backgrounds: ["accent", "accentHover"], kind: "text" },
  { foreground: "error", backgrounds: [...TEXT_SURFACES, "errorSurface"], kind: "text" },
  { foreground: "success", backgrounds: [...TEXT_SURFACES, "successSurface"], kind: "text" },
  { foreground: "stageText", backgrounds: ["stageBg"], kind: "text" },
  { foreground: "stageMuted", backgrounds: ["stageBg"], kind: "text" },
  { foreground: "stageAccent", backgrounds: ["stageBg"], kind: "text" },
  { foreground: "border", backgrounds: TEXT_SURFACES, kind: "ui" },
  { foreground: "focusRing", backgrounds: TEXT_SURFACES, kind: "ui" },
  { foreground: "brand", backgrounds: ["canvas", "panel"], kind: "ui" },
  { foreground: "accent", backgrounds: ["canvas", "panel"], kind: "ui" },
  { foreground: "logoTile", backgrounds: ["panel"], kind: "ui" },
  { foreground: "logoAccent", backgrounds: ["panel"], kind: "ui" }
];

export const MIN_RATIO: Record<ContrastKind, number> = { text: 7, ui: 3 };

export interface ContrastResult {
  readonly theme: DesignTheme;
  readonly mode: ColorMode;
  readonly foreground: keyof ColorTokens;
  readonly background: keyof ColorTokens;
  readonly kind: ContrastKind;
  readonly ratio: number;
  readonly passes: boolean;
}

/** Berechnet alle Kontrastpaare für eine Design-/Modus-Kombination. */
export function auditContrast(theme: DesignTheme, mode: ColorMode): ContrastResult[] {
  const tokens = DESIGN_TOKENS[theme][mode];
  return CONTRAST_RULES.flatMap((rule) =>
    rule.backgrounds.map((background) => {
      const ratio = contrastRatio(tokens[rule.foreground], tokens[background]);
      return {
        theme,
        mode,
        foreground: rule.foreground,
        background,
        kind: rule.kind,
        ratio,
        passes: ratio >= MIN_RATIO[rule.kind]
      };
    })
  );
}

/** CSS-Deklarationen (ohne Selektor) für eine Kombination, für themes.css und Tests. */
export function tokensToCssDeclarations(theme: DesignTheme, mode: ColorMode): string[] {
  const tokens = DESIGN_TOKENS[theme][mode];
  return (Object.keys(TOKEN_CSS_NAMES) as (keyof ColorTokens)[]).map(
    (key) => `${TOKEN_CSS_NAMES[key]}: ${tokens[key].toLowerCase()};`
  );
}

function cssBlock(
  selectors: readonly string[],
  declarations: readonly string[],
  indent = ""
): string {
  const body = declarations.map((d) => `${indent}  ${d}`).join("\n");
  return `${indent}${selectors.join(`,\n${indent}`)} {\n${body}\n${indent}}\n`;
}

/** color-scheme passend zur Grundfläche (steuert Scrollleisten und native Steuerelemente). */
export function colorSchemeFor(theme: DesignTheme, mode: ColorMode): "light" | "dark" {
  return relativeLuminance(DESIGN_TOKENS[theme][mode].canvas) < 0.5 ? "dark" : "light";
}

function selectorFor(theme: DesignTheme, mode: ColorMode): string {
  return `html[data-design="${theme}"][data-color-mode="${mode}"]`;
}

function modeDeclarations(theme: DesignTheme, mode: ColorMode): string[] {
  return [`color-scheme: ${colorSchemeFor(theme, mode)};`, ...tokensToCssDeclarations(theme, mode)];
}

function typographyDeclarations(theme: DesignTheme): string[] {
  const t = TYPOGRAPHY[theme];
  return [
    `--rn-font-family-body: ${t.body};`,
    `--rn-font-family-headings: ${t.headings};`,
    `--rn-font-family-ui: ${t.ui};`
  ];
}

/**
 * Erzeugt alle Farb- und Schriftblöcke für themes.css.
 * Ohne gesetzte Attribute (vor dem ersten Rendern) gilt Fusion, Farbmodus nach System.
 */
export function buildThemeCss(): string {
  const blocks: string[] = [
    cssBlock([":root", 'html[data-design="fusion"]'], typographyDeclarations("fusion")),
    cssBlock([":root"], modeDeclarations("fusion", "light")),
    `@media (prefers-color-scheme: dark) {\n${cssBlock(
      [":root:not([data-color-mode])"],
      modeDeclarations("fusion", "dark"),
      "  "
    )}}\n`,
    `@media (prefers-contrast: more) {\n${cssBlock(
      [":root:not([data-color-mode])"],
      modeDeclarations("fusion", "aaa-contrast"),
      "  "
    )}}\n`
  ];
  for (const theme of THEMES) {
    if (theme !== "fusion") {
      blocks.push(cssBlock([`html[data-design="${theme}"]`], typographyDeclarations(theme)));
    }
    for (const mode of COLOR_MODES) {
      blocks.push(cssBlock([selectorFor(theme, mode)], modeDeclarations(theme, mode)));
    }
  }
  return blocks.join("\n");
}
