/**
 * Reine Hilfsfunktionen für das Desktop-Layout (Issue #325), ohne React und ohne DOM:
 * eingeklappte Spalten, Tastenkürzel und der lokal gespeicherte Notebook-Titel.
 */

/** Spalten, die sich auf eine Symbolleiste einklappen lassen. */
export type CollapsiblePanel = "sources" | "studio";

export interface CollapsedPanels {
  readonly sources: boolean;
  readonly studio: boolean;
}

export const LAYOUT_STORAGE_KEYS = {
  collapsed: "rn_collapsed_panels",
  titles: "rn_notebook_titles"
} as const;

export const NO_PANELS_COLLAPSED: CollapsedPanels = { sources: false, studio: false };

/** Längster Notebook-Titel; längere Eingaben werden gekürzt. */
export const NOTEBOOK_TITLE_MAX_LENGTH = 120;

/**
 * Tastenkürzel zum Ein- und Ausklappen: Alt+Umschalt+1 (Quellen) und Alt+Umschalt+3 (Studio),
 * passend zur Position der Spalte. Ausgewertet wird die physische Taste (event.code), so
 * gilt das Kürzel auf jeder Tastaturbelegung. Strg und Meta bleiben frei: Strg+Alt ist auf
 * Windows AltGr (Sonderzeichen), Alt+Ziffer wechselt unter Linux die Browser-Tabs, und
 * Screenreader nutzen Einfg, Feststell- oder Strg+Option-Tasten.
 */
export const PANEL_SHORTCUTS: Readonly<Record<CollapsiblePanel, string>> = {
  sources: "Alt+Shift+1",
  studio: "Alt+Shift+3"
};

const SHORTCUT_CODES: Readonly<Record<string, CollapsiblePanel>> = {
  Digit1: "sources",
  Numpad1: "sources",
  Digit3: "studio",
  Numpad3: "studio"
};

export interface ShortcutKeyEvent {
  readonly code: string;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly repeat?: boolean | undefined;
}

/** Welche Spalte schaltet dieser Tastendruck um? null, wenn es nicht das Kürzel ist. */
export function matchPanelShortcut(event: ShortcutKeyEvent): CollapsiblePanel | null {
  if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.repeat) {
    return null;
  }
  return SHORTCUT_CODES[event.code] ?? null;
}

function safeGet(storage: Pick<Storage, "getItem"> | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage: Pick<Storage, "setItem"> | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Speichern nicht möglich: Wahl gilt nur für diese Sitzung.
  }
}

function parseObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Gespeicherter Zustand der Spalten; unbekannte oder kaputte Werte gelten als ausgeklappt. */
export function readCollapsedPanels(
  storage: Pick<Storage, "getItem"> | undefined
): CollapsedPanels {
  const value = parseObject(safeGet(storage, LAYOUT_STORAGE_KEYS.collapsed));
  return { sources: value.sources === true, studio: value.studio === true };
}

export function storeCollapsedPanels(
  storage: Pick<Storage, "setItem"> | undefined,
  panels: CollapsedPanels
): void {
  safeSet(
    storage,
    LAYOUT_STORAGE_KEYS.collapsed,
    JSON.stringify({ sources: panels.sources, studio: panels.studio })
  );
}

/**
 * Bereinigt eine Titeleingabe: Leerraum zusammengefasst, Länge begrenzt.
 * Leere Eingabe behält den bisherigen Titel.
 */
export function normalizeNotebookTitle(input: string, previous: string): string {
  const clean = input.replace(/\s+/g, " ").trim().slice(0, NOTEBOOK_TITLE_MAX_LENGTH).trim();
  return clean || previous;
}

/** Gespeicherter Titel eines Notebooks, sonst der Standardtitel. */
export function readNotebookTitle(
  storage: Pick<Storage, "getItem"> | undefined,
  notebookId: string,
  fallback: string
): string {
  const stored = parseObject(safeGet(storage, LAYOUT_STORAGE_KEYS.titles))[notebookId];
  return typeof stored === "string" ? normalizeNotebookTitle(stored, fallback) : fallback;
}

/** Speichert den Titel eines Notebooks neben den Titeln anderer Notebooks. */
export function storeNotebookTitle(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  notebookId: string,
  title: string
): void {
  const titles = parseObject(safeGet(storage, LAYOUT_STORAGE_KEYS.titles));
  safeSet(storage, LAYOUT_STORAGE_KEYS.titles, JSON.stringify({ ...titles, [notebookId]: title }));
}
