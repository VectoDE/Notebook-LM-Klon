/**
 * Führt Nicht-Kritisches erst aus, wenn die Seite fertig geladen und gezeichnet ist (Issue #257,
 * LCP mobil). Vorladen von Studio-Werkzeugen und Demodaten konkurriert sonst mit dem ersten
 * Aufbau um Bandbreite und Hauptthread. Die Rückgabe bricht die Planung ab.
 */
export function afterSettled(run: () => void, delayMs = 3000): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const schedule = () => {
    if (!cancelled) timer = setTimeout(run, delayMs);
  };
  if (typeof document === "undefined" || document.readyState === "complete") {
    schedule();
  } else {
    window.addEventListener("load", schedule, { once: true });
  }
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
    if (typeof window !== "undefined") window.removeEventListener("load", schedule);
  };
}
