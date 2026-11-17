/**
 * Fokusfalle für Menüs und Sheets: Tab und Umschalt+Tab bleiben im Container.
 *
 * Die Logik ist bewusst ohne DOM-Abhängigkeit geschrieben, damit sie in Node getestet
 * werden kann; im Browser übergibt der Aufrufer Container und aktives Element.
 */

/** Alles, was per Tastatur erreichbar ist. */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(", ");

/**
 * Welches Element soll bei Tab den Fokus bekommen?
 * Liefert den Index, auf den umgelenkt wird, oder null, wenn der Browser normal weiterspringt.
 */
export function nextTrapIndex(count: number, current: number, backwards: boolean): number | null {
  if (count === 0) return null;
  if (backwards) return current <= 0 ? count - 1 : null;
  return current === -1 || current >= count - 1 ? 0 : null;
}

export interface Focusable {
  focus(): void;
  readonly type?: string;
  readonly name?: string;
  readonly checked?: boolean;
}

/**
 * Radiogruppen sind ein einziger Tab-Halt: der gewählte Knopf, sonst der erste der Gruppe.
 * So erkennt die Falle das echte erste und letzte Tab-Ziel.
 */
export function tabbableItems<T extends Focusable>(items: readonly T[]): T[] {
  return items.filter((el) => {
    if (el.type !== "radio" || !el.name) return true;
    const group = items.filter((o) => o.type === "radio" && o.name === el.name);
    const checked = group.find((o) => o.checked);
    return (checked ?? group[0]) === el;
  });
}

export interface TrapContainer<T extends Focusable> {
  querySelectorAll(selector: string): ArrayLike<T>;
}

export interface TrapKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  preventDefault(): void;
}

/**
 * Hält den Fokus im Container. Gibt true zurück, wenn der Fokus umgelenkt wurde.
 * Ohne fokussierbare Elemente wird Tab ganz unterdrückt, damit der Fokus nicht entweicht.
 */
export function trapTabKey<T extends Focusable>(
  event: TrapKeyEvent,
  container: TrapContainer<T>,
  active: unknown
): boolean {
  if (event.key !== "Tab") return false;
  const items = tabbableItems(Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)));
  if (items.length === 0) {
    event.preventDefault();
    return true;
  }
  const target = nextTrapIndex(items.length, items.indexOf(active as T), event.shiftKey);
  if (target === null) return false;
  event.preventDefault();
  (items[target] as T).focus();
  return true;
}
