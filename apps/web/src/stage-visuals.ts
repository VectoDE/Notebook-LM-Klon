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

export interface OrbPalette {
  /** Kern, Mitte und auslaufender Rand des Hauptverlaufs. */
  readonly core: string;
  readonly mid: string;
  readonly edge: string;
  /** Glanzlicht in der Bühnen-Textfarbe statt fest Weiß. */
  readonly glow: string;
  readonly glowMid: string;
  readonly glowEdge: string;
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
  const accent = parseHexColor(accentToken) ?? ORB_FALLBACK;
  const text = parseHexColor(textToken) ?? { r: 255, g: 255, b: 255 };
  const strength = activeSpeaker === "hostB" ? 0.75 : 0.9;
  return {
    core: rgba(accent, strength),
    mid: rgba(accent, strength * 0.55),
    edge: rgba(accent, 0),
    glow: rgba(text, 0.35),
    glowMid: rgba(text, 0.15),
    glowEdge: rgba(text, 0)
  };
}
