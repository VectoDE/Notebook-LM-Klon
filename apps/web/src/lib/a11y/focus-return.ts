/**
 * Fokus-Rückgabe nach dem Schließen von Dialogen und Bühnen.
 *
 * Ohne DOM-Abhängigkeit geschrieben, damit sie in Node getestet werden kann: Der Aufrufer
 * übergibt die Kandidaten (zuerst der gemerkte Auslöser, dann Rückfallziele) und eine
 * Funktion, die das aktive Element liefert.
 */

export interface FocusCandidate {
  focus(options?: { preventScroll?: boolean }): void;
  /** Fehlt im DOM-freien Test; im Browser false, sobald das Element ausgehängt ist. */
  readonly isConnected?: boolean;
}

/**
 * Setzt den Fokus auf den ersten Kandidaten, der ihn wirklich annimmt.
 * Ein Element, das noch im DOM hängt, aber verborgen oder inert ist (zum Beispiel ein
 * Knopf im geschlossenen Menü-Sheet), nimmt den Fokus nicht an; dann folgt der nächste.
 * Gibt den fokussierten Kandidaten zurück, sonst null.
 */
export function focusFirstAvailable<T extends FocusCandidate>(
  candidates: readonly (T | null | undefined)[],
  getActive: () => unknown
): T | null {
  for (const candidate of candidates) {
    if (!candidate || candidate.isConnected === false) continue;
    candidate.focus({ preventScroll: true });
    if (getActive() === candidate) return candidate;
  }
  return null;
}
