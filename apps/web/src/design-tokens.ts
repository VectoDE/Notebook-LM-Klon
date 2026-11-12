/**
 * Farb-Tokens der vier Design-Richtungen (Pure, Immersive Cinema, Editorial Calm, Fusion)
 * in den drei Farbmodi Hell, Dunkel und AAA-Hochkontrast.
 *
 * Einzige Quelle für alle Farbwerte: themes.css spiegelt diese Tabelle 1:1
 * (per Test abgesichert), die Kontrast-Tests rechnen direkt mit diesen Werten.
 *
 * Zuordnung (Inhaber, 2026-11-12), jedes Design hat eine eigene Farbwelt:
 * - Pure: ruhige, helle Arbeitsfläche mit weichen Panels (Anmutung wie NotebookLM),
 *   eigene Farbe Indigo/Lavendel, keine Google-Farbwerte.
 * - Immersive Cinema: Nacht-Violett mit Fuchsia- und Cyan-Licht, eigene Bewegungssprache
 *   (siehe themes.css, abgeschaltet bei prefers-reduced-motion).
 * - Editorial Calm: Everlast/RelationFlow. Everlast-Blau #2563EB nur für Flächen und
 *   Grafik, Text, Links und Buttons #1E40AF (8,72:1 auf Weiß), Slate-Neutraltöne.
 * - Fusion: Petrol/Teal mit Bernstein, eigenständig (nicht die Palette von Pure).
 *
 * Grundregeln:
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
  /** Grund von Eingabefeldern: Weiß im Hellen, im Dunkeln eine eigene, tiefer liegende
   * Feldfläche (Issue #328). Text darauf 7:1, Rahmen und Fokusring 3:1. */
  readonly field: string;
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

const INTER = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
const SERIF = '"Source Serif 4", Georgia, "Times New Roman", serif';
const GROTESK = '"Space Grotesk", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
const GEIST = '"Geist", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
export const FONT_MONO = '"JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace';

/**
 * Eine eigene Schrift je Design (alle SIL OFL 1.1, selbst gehostet als WOFF2-Latin-Subset in
 * src/fonts mit @font-face in fonts.css, Lizenzen unter public/fonts/LICENSES):
 * - Pure: Inter, neutrale Klarheit für die Arbeitsfläche.
 * - Editorial Calm: Source Serif 4 nur für Überschriften, Fließtext und Bedienelemente in Inter
 *   (Issue #328: Serif nur für Überschriften, Fließtext Sans).
 * - Immersive Cinema: Space Grotesk, technisch-filmischer Charakter.
 * - Fusion: Geist, präzise und energisch.
 */
export const TYPOGRAPHY: Record<DesignTheme, TypographyTokens> = {
  pure: { body: INTER, headings: INTER, ui: INTER },
  "immersive-cinema": { body: GROTESK, headings: GROTESK, ui: GROTESK },
  "editorial-calm": { body: INTER, headings: SERIF, ui: INTER },
  fusion: { body: GEIST, headings: GEIST, ui: GEIST }
};

/**
 * Typografie-Skala, Abstände (4-px-Raster), Radien, Schatten und Bewegung je Design.
 * Werte in px bzw. ms; Schriftgrößen in rem (1 rem = 16 px).
 */
export interface ScaleTokens {
  /** Fließtext: 1 rem = 16 px in allen Designs (Issue #328) */
  readonly textBase: number;
  /** Kleinste Schrift (mindestens 0,875 rem) */
  readonly textSmall: number;
  /** Paneltitel (h2) */
  readonly textH2: number;
  /** Kartentitel (h3) */
  readonly textH3: number;
  /** Zwischenstufe zwischen h3 und h2, z. B. Titel der Zusammenfassung (Issue #315) */
  readonly textLead: number;
  readonly lineBody: number;
  readonly lineHeading: number;
  /** Buchstabenabstand der Überschriften in em */
  readonly trackingHeading: number;
  readonly weightHeading: number;
  /** Abstand zwischen und um die Panels (px, Vielfaches von 4) */
  readonly gapWorkspace: number;
  /** Innenabstand der Panels (px, Vielfaches von 4) */
  readonly padPanel: number;
  /** Innenabstand der Kopfzeile, vertikal / horizontal (px, Vielfaches von 4) */
  readonly padHeaderY: number;
  readonly padHeaderX: number;
  /** Kleine Flächen (Abzeichen, Kontrollkästchen) */
  readonly radiusSm: number;
  /** Karten, Eingabefelder, Menüs: 12 px in allen Designs (Issue #328) */
  readonly radiusMd: number;
  readonly radiusLg: number;
  /** Spalten: 12 px als Karte, 0 bei Editorial (bündige Spalten mit Trennlinien) */
  readonly radiusPanel: number;
  /** Dauer der Einblendung in ms und Weg in px */
  readonly enterMs: number;
  readonly enterDistance: number;
  /** Dauer von Zustandswechseln (Hover, Farbe) in ms */
  readonly transitionMs: number;
  readonly ease: string;
}

export const SCALE: Record<DesignTheme, ScaleTokens> = {
  pure: {
    textBase: 1,
    textSmall: 0.875,
    textH2: 1.25,
    textH3: 1.0625,
    textLead: 1.125,
    lineBody: 1.6,
    lineHeading: 1.25,
    trackingHeading: -0.012,
    weightHeading: 600,
    gapWorkspace: 12,
    padPanel: 20,
    padHeaderY: 12,
    padHeaderX: 20,
    radiusSm: 8,
    radiusMd: 12,
    radiusLg: 12,
    radiusPanel: 12,
    enterMs: 280,
    enterDistance: 12,
    transitionMs: 200,
    ease: "cubic-bezier(0.25, 0.1, 0.25, 1)"
  },
  "immersive-cinema": {
    textBase: 1,
    textSmall: 0.875,
    textH2: 1.375,
    textH3: 1.125,
    textLead: 1.25,
    lineBody: 1.55,
    lineHeading: 1.15,
    trackingHeading: -0.025,
    weightHeading: 600,
    gapWorkspace: 12,
    padPanel: 20,
    padHeaderY: 12,
    padHeaderX: 20,
    radiusSm: 8,
    radiusMd: 12,
    radiusLg: 12,
    radiusPanel: 12,
    enterMs: 300,
    enterDistance: 24,
    transitionMs: 280,
    ease: "cubic-bezier(0.16, 1, 0.3, 1)"
  },
  "editorial-calm": {
    textBase: 1,
    textSmall: 0.875,
    textH2: 1.5,
    textH3: 1.1875,
    textLead: 1.3125,
    lineBody: 1.7,
    lineHeading: 1.2,
    trackingHeading: -0.005,
    weightHeading: 600,
    gapWorkspace: 0,
    padPanel: 28,
    padHeaderY: 16,
    padHeaderX: 28,
    radiusSm: 6,
    radiusMd: 12,
    radiusLg: 12,
    radiusPanel: 0,
    enterMs: 280,
    enterDistance: 10,
    transitionMs: 240,
    ease: "cubic-bezier(0.4, 0, 0.2, 1)"
  },
  fusion: {
    textBase: 1,
    textSmall: 0.875,
    textH2: 1.5,
    textH3: 1.125,
    textLead: 1.3125,
    lineBody: 1.6,
    lineHeading: 1.1,
    trackingHeading: -0.03,
    weightHeading: 700,
    gapWorkspace: 8,
    padPanel: 20,
    padHeaderY: 12,
    padHeaderX: 20,
    radiusSm: 8,
    radiusMd: 12,
    radiusLg: 12,
    radiusPanel: 12,
    enterMs: 280,
    enterDistance: 16,
    transitionMs: 220,
    ease: "cubic-bezier(0.2, 0.8, 0.2, 1)"
  }
};

export const DESIGN_TOKENS: Record<DesignTheme, Record<ColorMode, ColorTokens>> = {
  pure: {
    light: {
      canvas: "#F7F7FC",
      panel: "#FFFFFF",
      surfaceVariant: "#EEEEF9",
      field: "#FFFFFF",
      border: "#5F5F7A",
      divider: "#E3E3F0",
      textPrimary: "#16162A",
      textSecondary: "#3A3A55",
      textMuted: "#3A3A55",
      primary: "#3730A3",
      accent: "#3730A3",
      accentHover: "#312E81",
      accentText: "#FFFFFF",
      brand: "#6366F1",
      focusRing: "#3730A3",
      highlight: "#E0E7FF",
      error: "#991B1B",
      errorSurface: "#FEF2F2",
      success: "#14532D",
      successSurface: "#F0FDF4",
      stageBg: "#16162A",
      stageText: "#F7F7FC",
      stageMuted: "#D4D4E8",
      stageAccent: "#C7D2FE",
      logoTile: "#4F46E5",
      logoAccent: "#4F46E5"
    },
    dark: {
      canvas: "#121220",
      panel: "#1B1B2C",
      surfaceVariant: "#26263A",
      field: "#0E0E1A",
      border: "#9A9AB8",
      divider: "#303046",
      textPrimary: "#F1F1FA",
      textSecondary: "#D9D9EA",
      textMuted: "#CACADF",
      primary: "#C7D2FE",
      accent: "#C7D2FE",
      accentHover: "#E0E7FF",
      accentText: "#121220",
      brand: "#818CF8",
      focusRing: "#C7D2FE",
      highlight: "#312E81",
      error: "#FECACA",
      errorSurface: "#3B1219",
      success: "#BBF7D0",
      successSurface: "#0F2A1C",
      stageBg: "#0B0B16",
      stageText: "#F7F7FC",
      stageMuted: "#CACADF",
      stageAccent: "#C7D2FE",
      logoTile: "#6366F1",
      logoAccent: "#C7D2FE"
    },
    "aaa-contrast": {
      canvas: "#FFFFFF",
      panel: "#FFFFFF",
      surfaceVariant: "#F1F1FA",
      field: "#FFFFFF",
      border: "#16162A",
      divider: "#3A3A55",
      textPrimary: "#000000",
      textSecondary: "#16162A",
      textMuted: "#22223A",
      primary: "#312E81",
      accent: "#312E81",
      accentHover: "#000000",
      accentText: "#FFFFFF",
      brand: "#3730A3",
      focusRing: "#312E81",
      highlight: "#FEF08A",
      error: "#7F1D1D",
      errorSurface: "#FFFFFF",
      success: "#14532D",
      successSurface: "#FFFFFF",
      stageBg: "#000000",
      stageText: "#FFFFFF",
      stageMuted: "#F1F1FA",
      stageAccent: "#C7D2FE",
      logoTile: "#312E81",
      logoAccent: "#312E81"
    }
  },
  "immersive-cinema": {
    light: {
      canvas: "#EEEAF6",
      panel: "#FFFFFF",
      surfaceVariant: "#F5F2FA",
      field: "#FFFFFF",
      border: "#5E5670",
      divider: "#DCD5E8",
      textPrimary: "#140F24",
      textSecondary: "#352D48",
      textMuted: "#3F3754",
      primary: "#701A75",
      accent: "#701A75",
      accentHover: "#4A044E",
      accentText: "#FFFFFF",
      brand: "#C026D3",
      focusRing: "#701A75",
      highlight: "#FAE8FF",
      error: "#991B1B",
      errorSurface: "#FEF2F2",
      success: "#14532D",
      successSurface: "#F0FDF4",
      stageBg: "#0D0A1A",
      stageText: "#F5F3FF",
      stageMuted: "#D8D2E8",
      stageAccent: "#67E8F9",
      logoTile: "#A21CAF",
      logoAccent: "#A21CAF"
    },
    dark: {
      canvas: "#0A0814",
      panel: "#151126",
      surfaceVariant: "#1F1934",
      field: "#07051A",
      border: "#A49CB8",
      divider: "#2B2442",
      textPrimary: "#F5F3FF",
      textSecondary: "#DDD6F0",
      textMuted: "#CFC7E4",
      primary: "#F0ABFC",
      accent: "#F0ABFC",
      accentHover: "#FAE8FF",
      accentText: "#0A0814",
      brand: "#D946EF",
      focusRing: "#F0ABFC",
      highlight: "#4A1D5C",
      error: "#FCA5A5",
      errorSurface: "#2A1020",
      success: "#86EFAC",
      successSurface: "#0C2420",
      stageBg: "#05040B",
      stageText: "#F5F3FF",
      stageMuted: "#CFC7E4",
      stageAccent: "#67E8F9",
      logoTile: "#C026D3",
      logoAccent: "#F0ABFC"
    },
    "aaa-contrast": {
      canvas: "#05040B",
      panel: "#0A0814",
      surfaceVariant: "#151126",
      field: "#000000",
      border: "#E9E5F5",
      divider: "#A49CB8",
      textPrimary: "#FFFFFF",
      textSecondary: "#F5F3FF",
      textMuted: "#E9E5F5",
      primary: "#A5F3FC",
      accent: "#A5F3FC",
      accentHover: "#FFFFFF",
      accentText: "#05040B",
      brand: "#E879F9",
      focusRing: "#A5F3FC",
      highlight: "#164E63",
      error: "#FECACA",
      errorSurface: "#0A0814",
      success: "#BBF7D0",
      successSurface: "#0A0814",
      stageBg: "#000000",
      stageText: "#FFFFFF",
      stageMuted: "#F5F3FF",
      stageAccent: "#A5F3FC",
      logoTile: "#C026D3",
      logoAccent: "#A5F3FC"
    }
  },
  "editorial-calm": {
    light: {
      canvas: "#F8FAFC",
      panel: "#FFFFFF",
      surfaceVariant: "#F1F5F9",
      field: "#FFFFFF",
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
      canvas: "#0B1220",
      panel: "#131C2E",
      surfaceVariant: "#1C2840",
      field: "#08101D",
      border: "#94A3B8",
      divider: "#273449",
      textPrimary: "#F8FAFC",
      textSecondary: "#E2E8F0",
      textMuted: "#CBD5E1",
      primary: "#BFDBFE",
      accent: "#93C5FD",
      accentHover: "#BFDBFE",
      accentText: "#0B1220",
      brand: "#3B82F6",
      focusRing: "#93C5FD",
      highlight: "#1E3A8A",
      error: "#FECACA",
      errorSurface: "#3B1219",
      success: "#BBF7D0",
      successSurface: "#0F2A1C",
      stageBg: "#050A16",
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
      field: "#FFFFFF",
      border: "#0F172A",
      divider: "#334155",
      textPrimary: "#000000",
      textSecondary: "#0F172A",
      textMuted: "#1E293B",
      /* Tiefes Petrolblau statt Indigo: im AAA-Modus von Pure unterscheidbar (Issue #335) */
      primary: "#0C4A6E",
      accent: "#0C4A6E",
      accentHover: "#082F49",
      accentText: "#FFFFFF",
      brand: "#075985",
      focusRing: "#0C4A6E",
      highlight: "#FEF08A",
      error: "#7F1D1D",
      errorSurface: "#FFFFFF",
      success: "#14532D",
      successSurface: "#FFFFFF",
      stageBg: "#000000",
      stageText: "#FFFFFF",
      stageMuted: "#F1F5F9",
      stageAccent: "#BAE6FD",
      logoTile: "#0C4A6E",
      logoAccent: "#0C4A6E"
    }
  },
  fusion: {
    light: {
      canvas: "#F4F6F2",
      panel: "#FFFFFF",
      surfaceVariant: "#EAEFE8",
      field: "#FFFFFF",
      border: "#59665F",
      divider: "#D7DED6",
      textPrimary: "#10201B",
      textSecondary: "#2E3E38",
      textMuted: "#34443E",
      primary: "#134E4A",
      accent: "#134E4A",
      accentHover: "#042F2E",
      accentText: "#FFFFFF",
      brand: "#0D9488",
      focusRing: "#134E4A",
      highlight: "#FDE68A",
      error: "#991B1B",
      errorSurface: "#FEF2F2",
      success: "#14532D",
      successSurface: "#F0FDF4",
      stageBg: "#0F1F1C",
      stageText: "#F4F6F2",
      stageMuted: "#CFDAD5",
      stageAccent: "#FCD34D",
      logoTile: "#0F766E",
      logoAccent: "#B45309"
    },
    dark: {
      canvas: "#0C1513",
      panel: "#14201D",
      surfaceVariant: "#1C2B27",
      field: "#081210",
      border: "#93A8A0",
      divider: "#26362F",
      textPrimary: "#F1F5F2",
      textSecondary: "#D6E0DB",
      textMuted: "#C8D4CE",
      primary: "#99F6E4",
      accent: "#5EEAD4",
      accentHover: "#99F6E4",
      accentText: "#0C1513",
      brand: "#14B8A6",
      focusRing: "#5EEAD4",
      highlight: "#713F12",
      error: "#FECACA",
      errorSurface: "#3B1A24",
      success: "#BBF7D0",
      successSurface: "#13302A",
      stageBg: "#050B0A",
      stageText: "#F1F5F2",
      stageMuted: "#C8D4CE",
      stageAccent: "#FCD34D",
      logoTile: "#14B8A6",
      logoAccent: "#FCD34D"
    },
    "aaa-contrast": {
      canvas: "#000000",
      panel: "#0A0A0A",
      surfaceVariant: "#171717",
      field: "#000000",
      border: "#FFFFFF",
      divider: "#A3A3A3",
      textPrimary: "#FFFFFF",
      textSecondary: "#F5F5F5",
      textMuted: "#E5E5E5",
      primary: "#FDE047",
      accent: "#FDE047",
      accentHover: "#FFFFFF",
      accentText: "#000000",
      brand: "#2DD4BF",
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
      logoTile: "#14B8A6",
      logoAccent: "#FDE047"
    }
  }
};

/** CSS-Variablenname je Token (Präfix --rn-color-). */
export const TOKEN_CSS_NAMES: Record<keyof ColorTokens, string> = {
  canvas: "--rn-color-canvas",
  panel: "--rn-color-panel",
  surfaceVariant: "--rn-color-surface-variant",
  field: "--rn-color-field",
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

const TEXT_SURFACES: readonly (keyof ColorTokens)[] = [
  "canvas",
  "panel",
  "surfaceVariant",
  "field"
];

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

export interface ContrastSummary {
  readonly theme: DesignTheme;
  readonly mode: ColorMode;
  /** Kleinstes Verhältnis aller Textpaare (Ziel 7:1, AAA) */
  readonly text: number;
  /** Kleinstes Verhältnis aller Rahmen-, Grafik- und Fokuspaare (Ziel 3:1) */
  readonly ui: number;
  /** Kleinstes Verhältnis des Fokusrings zu den Flächen (Ziel 3:1) */
  readonly focus: number;
}

/** Kontrastmatrix: je Design und Modus die kleinsten Werte für Text, UI und Fokus. */
export function contrastMatrix(): ContrastSummary[] {
  return THEMES.flatMap((theme) =>
    COLOR_MODES.map((mode) => {
      const results = auditContrast(theme, mode);
      const min = (filter: (r: ContrastResult) => boolean) =>
        Math.min(...results.filter(filter).map((r) => r.ratio));
      return {
        theme,
        mode,
        text: min((r) => r.kind === "text"),
        ui: min((r) => r.kind === "ui"),
        focus: min((r) => r.foreground === "focusRing")
      };
    })
  );
}

/**
 * Mischt zwei Farben wie CSS `color-mix(in srgb, a share%, b)`: lineare Mischung der
 * sRGB-Kanäle, gerundet auf ganze Werte.
 */
export function mixSrgb(a: string, b: string, shareOfA: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const mixed = ca.map((v, i) => Math.round(v * shareOfA + (cb[i] as number) * (1 - shareOfA)));
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Getönte Flächen aus workspace.css (Kacheln, Karten, Reitermarke). Jede Fläche
 * ist eine Mischung aus zwei Tokens; darauf stehende Texte brauchen 7:1, Symbole 3:1.
 * Gilt für Hell und Dunkel; im AAA-Modus sind diese Flächen abgeschaltet.
 */
export interface MixedSurface {
  readonly theme: DesignTheme;
  readonly name: string;
  readonly mix: readonly [keyof ColorTokens, keyof ColorTokens, number];
  readonly text: readonly (keyof ColorTokens)[];
  readonly graphics: readonly (keyof ColorTokens)[];
}

export const MIXED_SURFACES: readonly MixedSurface[] = [
  {
    theme: "pure",
    name: "Werkzeugkachel und Dateiart",
    mix: ["brand", "panel", 0.12],
    text: ["primary"],
    graphics: ["primary"]
  },
  {
    theme: "pure",
    name: "Zusammenfassung",
    mix: ["brand", "panel", 0.09],
    text: ["textPrimary", "textSecondary", "primary"],
    graphics: []
  },
  {
    theme: "immersive-cinema",
    name: "Karte und Zusammenfassung",
    mix: ["brand", "panel", 0.07],
    text: ["textPrimary", "textSecondary", "primary"],
    graphics: ["accent"]
  },
  {
    theme: "immersive-cinema",
    name: "Kachel",
    mix: ["brand", "panel", 0.32],
    text: ["textPrimary"],
    graphics: ["textPrimary"]
  },
  {
    theme: "immersive-cinema",
    name: "Reitermarke",
    mix: ["brand", "panel", 0.22],
    text: [],
    graphics: ["primary"]
  },
  {
    theme: "fusion",
    name: "Werkzeugkachel, Markenende",
    mix: ["brand", "brand", 1],
    text: [],
    graphics: ["stageBg"]
  },
  {
    theme: "fusion",
    name: "Werkzeugkachel, Akzentende",
    mix: ["stageAccent", "stageAccent", 1],
    text: [],
    graphics: ["stageBg"]
  },
  {
    theme: "fusion",
    name: "Dateiart",
    mix: ["stageAccent", "panel", 0.16],
    text: ["primary"],
    graphics: []
  },
  {
    theme: "fusion",
    name: "Reitermarke",
    mix: ["stageAccent", "panel", 0.3],
    text: [],
    graphics: ["primary"]
  },
  // Gedrückter Umschalter im Video-Player (Untertitel, Audiodeskription), alle Designs
  ...THEMES.map(
    (theme): MixedSurface => ({
      theme,
      name: "Video-Umschalter, gedrückt",
      mix: ["stageAccent", "stageBg", 0.18],
      text: ["stageText"],
      graphics: ["stageAccent"]
    })
  )
];

export interface MixedSurfaceResult {
  readonly theme: DesignTheme;
  readonly mode: ColorMode;
  readonly surface: string;
  readonly foreground: keyof ColorTokens;
  readonly kind: ContrastKind;
  readonly ratio: number;
  readonly passes: boolean;
}

/** Prüft alle getönten Flächen in Hell und Dunkel. */
export function auditMixedSurfaces(): MixedSurfaceResult[] {
  return MIXED_SURFACES.flatMap((surface) =>
    (["light", "dark"] as const).flatMap((mode) => {
      const tokens = DESIGN_TOKENS[surface.theme][mode];
      const [a, b, share] = surface.mix;
      const background = mixSrgb(tokens[a], tokens[b], share);
      const check = (kind: ContrastKind) => (foreground: keyof ColorTokens) => {
        const ratio = contrastRatio(tokens[foreground], background);
        return {
          theme: surface.theme,
          mode,
          surface: surface.name,
          foreground,
          kind,
          ratio,
          passes: ratio >= MIN_RATIO[kind]
        };
      };
      return [...surface.text.map(check("text")), ...surface.graphics.map(check("ui"))];
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
  const c = SCALE[theme];
  return [
    `--rn-font-family-body: ${t.body};`,
    `--rn-font-family-headings: ${t.headings};`,
    `--rn-font-family-ui: ${t.ui};`,
    `--rn-text-base: ${c.textBase}rem;`,
    `--rn-text-small: ${c.textSmall}rem;`,
    `--rn-text-h2: ${c.textH2}rem;`,
    `--rn-text-h3: ${c.textH3}rem;`,
    `--rn-text-lead: ${c.textLead}rem;`,
    `--rn-line-body: ${c.lineBody};`,
    `--rn-line-heading: ${c.lineHeading};`,
    `--rn-tracking-heading: ${c.trackingHeading}em;`,
    `--rn-weight-heading: ${c.weightHeading};`,
    `--rn-gap-workspace: ${c.gapWorkspace}px;`,
    `--rn-pad-panel: ${c.padPanel}px;`,
    `--rn-pad-header: ${c.padHeaderY}px ${c.padHeaderX}px;`,
    `--rn-radius-sm: ${c.radiusSm}px;`,
    `--rn-radius-md: ${c.radiusMd}px;`,
    `--rn-radius-lg: ${c.radiusLg}px;`,
    `--rn-radius-panel: ${c.radiusPanel}px;`,
    `--rn-enter-duration: ${c.enterMs}ms;`,
    `--rn-enter-distance: ${c.enterDistance}px;`,
    `--rn-transition-speed: ${c.transitionMs}ms;`,
    `--rn-transition-ease: ${c.ease};`
  ];
}

/** Standard beim Erstbesuch (Issue #328): Pure, Farbmodus folgt dem System, sonst Hell. */
export const DEFAULT_THEME: DesignTheme = "pure";

/**
 * Erzeugt alle Farb- und Schriftblöcke für themes.css.
 * Ohne gesetzte Attribute (vor dem ersten Rendern) gilt Pure, Farbmodus nach System.
 */
export function buildThemeCss(): string {
  const blocks: string[] = [
    cssBlock(
      [":root", `html[data-design="${DEFAULT_THEME}"]`],
      typographyDeclarations(DEFAULT_THEME)
    ),
    cssBlock([":root"], modeDeclarations(DEFAULT_THEME, "light")),
    `@media (prefers-color-scheme: dark) {
${cssBlock([":root:not([data-color-mode])"], modeDeclarations(DEFAULT_THEME, "dark"), "  ")}}
`,
    `@media (prefers-contrast: more) {
${cssBlock(
  [":root:not([data-color-mode])"],
  modeDeclarations(DEFAULT_THEME, "aaa-contrast"),
  "  "
)}}
`
  ];
  for (const theme of THEMES) {
    if (theme !== DEFAULT_THEME) {
      blocks.push(cssBlock([`html[data-design="${theme}"]`], typographyDeclarations(theme)));
    }
    for (const mode of COLOR_MODES) {
      blocks.push(cssBlock([selectorFor(theme, mode)], modeDeclarations(theme, mode)));
    }
  }
  return blocks.join("\n");
}
