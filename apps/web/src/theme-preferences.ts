/**
 * Reine Hilfsfunktionen für Design-, Farbmodus- und Sprachwahl (ohne React),
 * damit Startwerte, Systemeinstellung und DOM-Attribute testbar sind.
 *
 * DOM-Vertrag: <html data-design="…" data-color-mode="…" lang="…">.
 * Das frühere Attribut data-theme wird entfernt (Issue #252).
 */

import { COLOR_MODES, type ColorMode, type DesignTheme, THEMES } from "./design-tokens.js";

export type Language = "de" | "en";
export const LANGUAGES: readonly Language[] = ["de", "en"] as const;

export const STORAGE_KEYS = {
  theme: "rn_design",
  colorMode: "rn_color_mode",
  language: "rn_language"
} as const;

/** Ältere gespeicherte Werte (vor Issue #252) auf die neuen Namen abbilden. */
const LEGACY_THEME_KEY = "rn_theme";
const LEGACY_VALUES: Readonly<Record<string, string>> = {
  "pure-notebooklm": "pure",
  "oled-dark": "dark"
};

export interface ThemePreferences {
  readonly theme: DesignTheme;
  readonly colorMode: ColorMode;
  readonly language: Language;
}

export interface PreferenceEnvironment {
  readonly storage?: Pick<Storage, "getItem"> | undefined;
  readonly matchMedia?: ((query: string) => { readonly matches: boolean }) | undefined;
}

export interface PreferenceDefaults {
  readonly theme?: DesignTheme | undefined;
  readonly colorMode?: ColorMode | undefined;
  readonly language?: Language | undefined;
}

function safeRead(storage: Pick<Storage, "getItem"> | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  if (value === null) return undefined;
  const mapped = LEGACY_VALUES[value] ?? value;
  return (allowed as readonly string[]).includes(mapped) ? (mapped as T) : undefined;
}

/** Farbmodus aus der Systemeinstellung (prefers-contrast vor prefers-color-scheme). */
export function systemColorMode(env: PreferenceEnvironment): ColorMode {
  const query = env.matchMedia;
  if (!query) return "light";
  if (query("(prefers-contrast: more)").matches) return "aaa-contrast";
  if (query("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

/**
 * Startwerte: gespeicherte Wahl, sonst übergebener Standard, sonst Systemeinstellung
 * (Farbmodus) bzw. Fusion und Deutsch.
 */
export function resolveInitialPreferences(
  env: PreferenceEnvironment,
  defaults: PreferenceDefaults = {}
): ThemePreferences {
  const storedTheme =
    pick(safeRead(env.storage, STORAGE_KEYS.theme), THEMES) ??
    pick(safeRead(env.storage, LEGACY_THEME_KEY), THEMES);
  const storedMode = pick(safeRead(env.storage, STORAGE_KEYS.colorMode), COLOR_MODES);
  const storedLanguage = pick(safeRead(env.storage, STORAGE_KEYS.language), LANGUAGES);
  return {
    theme: storedTheme ?? defaults.theme ?? "fusion",
    colorMode: storedMode ?? defaults.colorMode ?? systemColorMode(env),
    language: storedLanguage ?? defaults.language ?? "de"
  };
}

/** Schreibt die Wahl als Attribute auf <html> und speichert sie (Fehler beim Speichern werden ignoriert). */
export function applyThemeToDocument(
  root: Pick<Element, "setAttribute" | "removeAttribute">,
  prefs: ThemePreferences,
  storage?: Pick<Storage, "setItem"> | undefined
): void {
  root.setAttribute("data-design", prefs.theme);
  root.setAttribute("data-color-mode", prefs.colorMode);
  root.setAttribute("lang", prefs.language);
  root.removeAttribute("data-theme");
  try {
    storage?.setItem(STORAGE_KEYS.theme, prefs.theme);
    storage?.setItem(STORAGE_KEYS.colorMode, prefs.colorMode);
    storage?.setItem(STORAGE_KEYS.language, prefs.language);
  } catch {
    // Speichern nicht möglich (z. B. privater Modus): Auswahl gilt nur für diese Sitzung.
  }
}
