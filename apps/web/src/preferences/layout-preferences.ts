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
  titles: "rn_notebook_titles",
  chats: "rn_chat_ids"
} as const;

export const NO_PANELS_COLLAPSED: CollapsedPanels = { sources: false, studio: false };

/**
 * Schmaler Desktop (900 bis 1279 px, z. B. 1024 px): drei Spalten passen nicht ohne
 * Umbrüche in Knöpfen und Metadaten nebeneinander. Ohne gespeicherte Wahl startet das
 * Studio deshalb eingeklappt (Symbolleiste mit allen Werkzeugen, ein Klick klappt aus);
 * Quellen und Chat bekommen die Breite (Issue #335).
 */
export const NARROW_DESKTOP = { min: 900, max: 1279.98 } as const;

export function defaultCollapsedPanels(viewportWidth: number | undefined): CollapsedPanels {
  const narrowDesktop =
    viewportWidth !== undefined &&
    viewportWidth >= NARROW_DESKTOP.min &&
    viewportWidth <= NARROW_DESKTOP.max;
  return { sources: false, studio: narrowDesktop };
}

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

/**
 * Gespeicherter Zustand der Spalten; unbekannte oder kaputte Werte gelten als ausgeklappt.
 * Ohne gespeicherte Wahl gilt die Vorgabe für die Fensterbreite (defaultCollapsedPanels).
 */
export function readCollapsedPanels(
  storage: Pick<Storage, "getItem"> | undefined,
  viewportWidth?: number
): CollapsedPanels {
  const raw = safeGet(storage, LAYOUT_STORAGE_KEYS.collapsed);
  if (raw === null) return defaultCollapsedPanels(viewportWidth);
  const value = parseObject(raw);
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

/** Zuletzt genutzter Chat eines Notebooks, damit der Verlauf nach dem Neuladen zurückkommt. */
export function readChatId(
  storage: Pick<Storage, "getItem"> | undefined,
  notebookId: string
): string | undefined {
  const stored = parseObject(safeGet(storage, LAYOUT_STORAGE_KEYS.chats))[notebookId];
  return typeof stored === "string" && stored.length > 0 ? stored : undefined;
}

/** Speichert die Chat-Kennung eines Notebooks neben denen anderer Notebooks. */
export function storeChatId(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  notebookId: string,
  chatId: string
): void {
  const chats = parseObject(safeGet(storage, LAYOUT_STORAGE_KEYS.chats));
  safeSet(storage, LAYOUT_STORAGE_KEYS.chats, JSON.stringify({ ...chats, [notebookId]: chatId }));
}
