import { useEffect, useRef } from "react";
import { focusFirstAvailable } from "./focus-return.js";

/**
 * Merkt beim Öffnen das fokussierte Element (den Auslöser) und gibt ihm beim Schließen
 * den Fokus zurück. Nimmt der Auslöser ihn nicht mehr an (ausgehängt oder in einem
 * geschlossenen Sheet), geht der Fokus an das Rückfallziel.
 *
 * Muss im Komponentenrumpf VOR dem Effekt stehen, der showModal() aufruft, damit der
 * Auslöser gemerkt wird, bevor der Dialog den Fokus übernimmt.
 */
export function useReturnFocus(
  isOpen: boolean,
  fallback?: () => HTMLElement | null | undefined
): void {
  const remembered = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      const active = document.activeElement;
      remembered.current = active instanceof HTMLElement ? active : null;
    }
    if (!isOpen && wasOpen.current) {
      const target = remembered.current;
      remembered.current = null;
      // Ein Frame Abstand: Dialog ist ausgehängt, der Hintergrund nicht mehr inert.
      requestAnimationFrame(() => {
        focusFirstAvailable([target, fallbackRef.current?.()], () => document.activeElement);
      });
    }
    wasOpen.current = isOpen;
  }, [isOpen]);
}
