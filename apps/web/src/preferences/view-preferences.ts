/**
 * Gespeicherte Ansichten (Issue #329), ohne React und ohne DOM: Quellen als Liste oder
 * Karten, tabellarische Ergebnisse als Tabelle oder Karten. Die Wahl bleibt auf dem Gerät.
 */

export type SourcesView = "list" | "cards";
export type TableView = "table" | "cards";

export const VIEW_STORAGE_KEYS = {
  sources: "rn_sources_view",
  quizResults: "rn_quiz_results_view"
} as const;

export type ViewStorageKey = (typeof VIEW_STORAGE_KEYS)[keyof typeof VIEW_STORAGE_KEYS];

function safeGet(storage: Pick<Storage, "getItem"> | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Speichert die Wahl; ohne Speicher (privates Fenster) gilt sie nur für diese Sitzung. */
export function storeView(
  storage: Pick<Storage, "setItem"> | undefined,
  key: ViewStorageKey,
  value: string
): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Speichern nicht möglich
  }
}

/** Ansicht der Quellen; unbekannte Werte gelten als Liste mit Haken. */
export function readSourcesView(storage: Pick<Storage, "getItem"> | undefined): SourcesView {
  return safeGet(storage, VIEW_STORAGE_KEYS.sources) === "cards" ? "cards" : "list";
}

/**
 * Ansicht einer Tabelle. Ohne gespeicherte Wahl entscheidet der Platz: schmal Karten,
 * breit Tabelle.
 */
export function readTableView(
  storage: Pick<Storage, "getItem"> | undefined,
  key: ViewStorageKey,
  fallback: TableView
): TableView {
  const stored = safeGet(storage, key);
  return stored === "table" || stored === "cards" ? stored : fallback;
}
