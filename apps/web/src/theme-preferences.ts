/**
 * Reine Hilfsfunktionen für Design-, Farbmodus- und Sprachwahl (ohne React),
 * damit Startwerte, Systemeinstellung und DOM-Attribute testbar sind.
 *
 * DOM-Vertrag: <html data-design="…" data-color-mode="…" data-language="…" lang="…">.
 * data-language trägt die gewählte Sprache (auch "de-x-ls"), lang die Dokumentsprache.
 * Das frühere Attribut data-theme wird entfernt (Issue #252).
 */

import {
  COLOR_MODES,
  type ColorMode,
  DEFAULT_THEME,
  type DesignTheme,
  THEMES
} from "./design-tokens.js";
import { directionOf } from "./i18n.js";

/**
 * Sprachen der Oberfläche. "de-x-ls" ist Deutsch in Leichter Sprache (Issue #349): eine
 * Variante von Deutsch mit eigenem Katalog (locales/de-x-ls.json), der erst bei Bedarf lädt.
 */
export type Language = "de" | "de-x-ls" | "en";

/** Gewählter Farbmodus: fest oder "system" (folgt dem Gerät, auch bei späteren Änderungen). */
export type ColorModePreference = ColorMode | "system";
export const COLOR_MODE_PREFERENCES: readonly ColorModePreference[] = [
  "system",
  ...COLOR_MODES
] as const;

/** Media Queries, auf die der Modus "system" reagiert. */
export const SYSTEM_COLOR_QUERIES = [
  "(prefers-contrast: more)",
  "(prefers-color-scheme: dark)"
] as const;
export const LANGUAGES: readonly Language[] = ["de", "de-x-ls", "en"] as const;

/**
 * Wert für <html lang>: Leichte Sprache ist Deutsch. Screenreader und Browser wählen Stimme,
 * Silbentrennung und Rechtschreibprüfung nach der Hauptsprache; ein privater Tag wie
 * "de-x-ls" ist zwar gültiges BCP 47, wird aber nicht überall erkannt.
 */
export function documentLanguage(language: Language): "de" | "en" {
  return language === "en" ? "en" : "de";
}

export const STORAGE_KEYS = {
  theme: "rn_design",
  colorMode: "rn_color_mode",
  language: "rn_language",
  reduceMotion: "rn_reduce_motion",
  model: "rn_model"
} as const;

/** Wählbare KI-Modelle (Reihenfolge wie in den Einstellungen); das erste ist der Standard. */
export const MODEL_IDS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "claude-3-7-sonnet",
  "gpt-4o",
  "deepseek-r1",
  "ollama-local"
] as const;
export type ModelId = (typeof MODEL_IDS)[number];
export const DEFAULT_MODEL: ModelId = MODEL_IDS[0];

/** Ältere gespeicherte Werte (vor Issue #252) auf die neuen Namen abbilden. */
const LEGACY_THEME_KEY = "rn_theme";
const LEGACY_VALUES: Readonly<Record<string, string>> = {
  "pure-notebooklm": "pure",
  "oled-dark": "dark"
};

export interface ThemePreferences {
  readonly theme: DesignTheme;
  readonly colorMode: ColorModePreference;
  readonly language: Language;
}

export interface PreferenceEnvironment {
  readonly storage?: Pick<Storage, "getItem"> | undefined;
  readonly matchMedia?: ((query: string) => { readonly matches: boolean }) | undefined;
}

export interface PreferenceDefaults {
  readonly theme?: DesignTheme | undefined;
  readonly colorMode?: ColorModePreference | undefined;
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
  if (query(SYSTEM_COLOR_QUERIES[0]).matches) return "aaa-contrast";
  if (query(SYSTEM_COLOR_QUERIES[1]).matches) return "dark";
  return "light";
}

/** Tatsächlich angewendeter Farbmodus: bei "system" der Modus des Geräts. */
export function resolveColorMode(preference: ColorModePreference, system: ColorMode): ColorMode {
  return preference === "system" ? system : preference;
}

/**
 * Startwerte: gespeicherte Wahl, sonst übergebener Standard, sonst "system" (Farbmodus
 * folgt dem Gerät, ohne Vorgabe des Geräts Hell) bzw. Pure und Deutsch (Issue #328).
 */
export function resolveInitialPreferences(
  env: PreferenceEnvironment,
  defaults: PreferenceDefaults = {}
): ThemePreferences {
  const storedTheme =
    pick(safeRead(env.storage, STORAGE_KEYS.theme), THEMES) ??
    pick(safeRead(env.storage, LEGACY_THEME_KEY), THEMES);
  const storedMode = pick(safeRead(env.storage, STORAGE_KEYS.colorMode), COLOR_MODE_PREFERENCES);
  const storedLanguage = pick(safeRead(env.storage, STORAGE_KEYS.language), LANGUAGES);
  return {
    theme: storedTheme ?? defaults.theme ?? DEFAULT_THEME,
    colorMode: storedMode ?? defaults.colorMode ?? "system",
    language: storedLanguage ?? defaults.language ?? "de"
  };
}

/**
 * Schreibt die Wahl als Attribute auf <html> und speichert sie (Fehler beim Speichern werden
 * ignoriert). data-color-mode trägt immer den angewendeten Modus, gespeichert wird die Wahl.
 */
export function applyThemeToDocument(
  root: Pick<Element, "setAttribute" | "removeAttribute">,
  prefs: ThemePreferences,
  storage?: Pick<Storage, "setItem"> | undefined,
  systemMode: ColorMode = "light"
): void {
  root.setAttribute("data-design", prefs.theme);
  root.setAttribute("data-color-mode", resolveColorMode(prefs.colorMode, systemMode));
  const lang = documentLanguage(prefs.language);
  root.setAttribute("lang", lang);
  root.setAttribute("data-language", prefs.language);
  root.setAttribute("dir", directionOf(lang));
  root.removeAttribute("data-theme");
  try {
    storage?.setItem(STORAGE_KEYS.theme, prefs.theme);
    storage?.setItem(STORAGE_KEYS.colorMode, prefs.colorMode);
    storage?.setItem(STORAGE_KEYS.language, prefs.language);
  } catch {
    // Speichern nicht möglich (z. B. privater Modus): Auswahl gilt nur für diese Sitzung.
  }
}

/**
 * Schalter „Bewegung reduzieren“ (Issue #315): Attribut am <html>, das dieselben Regeln
 * auslöst wie prefers-reduced-motion: reduce (themes.css, workspace.css).
 */
export const REDUCE_MOTION_ATTRIBUTE = "data-reduce-motion";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Systemwert (Issue #328): wünscht das Gerät weniger Bewegung? Ohne matchMedia: nein. */
export function systemPrefersReducedMotion(
  matchMedia?: ((query: string) => { readonly matches: boolean }) | undefined
): boolean {
  return Boolean(matchMedia?.(REDUCED_MOTION_QUERY).matches);
}

/** Gespeicherte Wahl lesen: nur "true" schaltet ein, alles andere (auch Fehler) aus. */
export function readReduceMotion(storage: Pick<Storage, "getItem"> | undefined): boolean {
  return safeRead(storage, STORAGE_KEYS.reduceMotion) === "true";
}

/** Setzt oder entfernt das Attribut und speichert die Wahl (Speicherfehler werden ignoriert). */
export function applyReduceMotion(
  root: Pick<Element, "setAttribute" | "removeAttribute">,
  enabled: boolean,
  storage?: Pick<Storage, "setItem"> | undefined
): void {
  if (enabled) root.setAttribute(REDUCE_MOTION_ATTRIBUTE, "true");
  else root.removeAttribute(REDUCE_MOTION_ATTRIBUTE);
  try {
    storage?.setItem(STORAGE_KEYS.reduceMotion, enabled ? "true" : "false");
  } catch {
    // Speichern nicht möglich: Wahl gilt nur für diese Sitzung.
  }
}

/**
 * Gespeicherte Modellwahl (Issue #319): nur bekannte Modelle, sonst (auch bei Lesefehlern)
 * der Standard.
 */
export function readStoredModel(storage: Pick<Storage, "getItem"> | undefined): ModelId {
  return pick(safeRead(storage, STORAGE_KEYS.model), MODEL_IDS) ?? DEFAULT_MODEL;
}

/** Speichert die Modellwahl; unbekannte Werte werden ignoriert, Speicherfehler auch. */
export function storeModel(storage: Pick<Storage, "setItem"> | undefined, model: string): void {
  if (!(MODEL_IDS as readonly string[]).includes(model)) return;
  try {
    storage?.setItem(STORAGE_KEYS.model, model);
  } catch {
    // Speichern nicht möglich: Wahl gilt nur für diese Sitzung.
  }
}

/** localStorage des Browsers, falls vorhanden und zugänglich (sonst undefined). */
export function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Soll Bewegung entfallen? Ja, wenn der Schalter in der App an ist oder das Gerät es wünscht.
 * Für Canvas- und Scroll-Code, den CSS nicht erreicht (Orb, Live-Transkript).
 */
export function shouldReduceMotion(
  root: Pick<Element, "getAttribute"> | undefined,
  matchMedia?: ((query: string) => { readonly matches: boolean }) | undefined
): boolean {
  if (root?.getAttribute(REDUCE_MOTION_ATTRIBUTE) === "true") return true;
  return Boolean(matchMedia?.(REDUCED_MOTION_QUERY).matches);
}
