/**
 * Kleine, DOM-freie Helfer für die Bühne: deutsche Zustandsnamen des Audio-Players
 * und Farben für den Aurora-Orb aus den Design-Tokens.
 */
import type { PodcastState } from "@notebook-lm/shared";

const PODCAST_STATE_LABELS: Readonly<Record<PodcastState, string>> = {
  idle: "Bereit",
  playing: "Läuft",
  paused: "Pausiert",
  interjecting: "Zwischenfrage",
  answering: "Hosts antworten",
  resuming: "Wird fortgesetzt"
};

/** Sichtbarer Name eines Player-Zustands; unbekannte Werte erscheinen nie roh. */
export function podcastStateLabel(state: string): string {
  return PODCAST_STATE_LABELS[state as PodcastState] ?? "Bereit";
}

/** Schlüssel im Sprachkatalog für den Namen eines Player-Zustands; unbekannt: "Bereit". */
export function podcastStateKey(state: string): string {
  const known = state in PODCAST_STATE_LABELS ? state : "idle";
  return `podState${known.charAt(0).toUpperCase()}${known.slice(1)}`;
}

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Rückfall, falls ein Token fehlt: der helle Bühnenakzent von Pure (dunkel). */
export const ORB_FALLBACK: Rgb = { r: 199, g: 210, b: 254 };

/** Liest #rgb oder #rrggbb (so stehen die Tokens in themes.css); sonst null. */
export function parseHexColor(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, "");
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return null;
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : hex;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16)
  };
}

export function rgba({ r, g, b }: Rgb, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Höchste Helligkeit (HSL) des Orbs: blasse Akzente (z. B. Pure #c7d2fe) wirken sonst grau. */
export const ORB_MAX_LIGHTNESS = 0.7;

/**
 * Hält Farbton und Sättigung, senkt aber die Helligkeit auf höchstens ORB_MAX_LIGHTNESS,
 * damit der Orb auf der dunklen Bühne farbig statt grau erscheint (Issue #315).
 */
export function vividOrbColor(color: Rgb, maxLightness = ORB_MAX_LIGHTNESS): Rgb {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (l <= maxLightness) return color;
  const d = max - min;
  // Helle Farben (l > 0,5): Sättigung nach HSL
  const sat = d === 0 ? 0 : d / (2 - max - min);
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) hue = ((b - r) / d + 2) / 6;
    else hue = ((r - g) / d + 4) / 6;
  }
  const q = maxLightness < 0.5 ? maxLightness * (1 + sat) : maxLightness + sat - maxLightness * sat;
  const p = 2 * maxLightness - q;
  const channel = (t0: number): number => {
    const t = t0 < 0 ? t0 + 1 : t0 > 1 ? t0 - 1 : t0;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: Math.round(channel(hue + 1 / 3) * 255),
    g: Math.round(channel(hue) * 255),
    b: Math.round(channel(hue - 1 / 3) * 255)
  };
}

/** Darstellung des Orbs: im Hochkontrast flach mit Rand, sonst als leuchtender Verlauf. */
export type OrbStyle = "flat" | "glow";

export function orbStyleFor(colorMode: string | null | undefined): OrbStyle {
  return colorMode === "aaa-contrast" ? "flat" : "glow";
}

export interface OrbPalette {
  /** Kern, Mitte und auslaufender Rand des Hauptverlaufs. */
  readonly core: string;
  readonly mid: string;
  readonly edge: string;
  /** Glanzlicht in der Bühnen-Textfarbe statt fest Weiß. */
  readonly glow: string;
  readonly glowMid: string;
  readonly glowEdge: string;
  /** Flache Darstellung (AAA): volle Füllung und 2-px-Rand in Bühnentextfarbe. */
  readonly fill: string;
  readonly outline: string;
}

/**
 * Verläufe des Orbs aus Bühnenakzent und Bühnentext. Der zweite Sprecher wird etwas
 * gedämpfter gezeichnet, damit ein Sprecherwechsel sichtbar bleibt.
 */
export function orbPalette(
  accentToken: string,
  textToken: string,
  activeSpeaker: "hostA" | "hostB" | null
): OrbPalette {
  const raw = parseHexColor(accentToken) ?? ORB_FALLBACK;
  const accent = vividOrbColor(raw);
  const text = parseHexColor(textToken) ?? { r: 255, g: 255, b: 255 };
  const strength = activeSpeaker === "hostB" ? 0.75 : 0.9;
  return {
    fill: rgba(raw, activeSpeaker === "hostB" ? 0.8 : 1),
    outline: rgba(text, 1),
    core: rgba(accent, strength),
    mid: rgba(accent, strength * 0.55),
    edge: rgba(accent, 0),
    glow: rgba(text, 0.35),
    glowMid: rgba(text, 0.15),
    glowEdge: rgba(text, 0)
  };
}
