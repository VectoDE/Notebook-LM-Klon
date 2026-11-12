/**
 * Zeitsteuerung der Hinweis-Leiste (Issue #329), ohne React und ohne DOM.
 * Die Leiste verschwindet nach DURATION Millisekunden. Zeiger oder Fokus auf der Leiste
 * halten die Zeit an (WCAG 2.2.1), danach läuft nur die Restzeit weiter.
 */

export const TOAST_DURATION_MS = 5000;

export interface ToastClock {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

export interface ToastTimer {
  /** Zeit anhalten (Zeiger oder Fokus auf der Leiste). Mehrfaches Anhalten zählt mit. */
  readonly pause: () => void;
  /** Weiterlaufen lassen, sobald kein Grund zum Anhalten mehr besteht. */
  readonly resume: () => void;
  /** Ablauf beenden, ohne onExpire auszulösen (Leiste geschlossen oder ersetzt). */
  readonly dispose: () => void;
  /** Verbleibende Zeit in Millisekunden (für Tests und Anzeige). */
  readonly remaining: () => number;
}

export function createToastTimer(
  onExpire: () => void,
  clock: ToastClock,
  duration: number = TOAST_DURATION_MS
): ToastTimer {
  let remaining = duration;
  let startedAt = 0;
  let handle: unknown = null;
  let holds = 0;
  let done = false;

  const start = () => {
    startedAt = clock.now();
    handle = clock.setTimeout(() => {
      handle = null;
      remaining = 0;
      done = true;
      onExpire();
    }, remaining);
  };

  const stop = () => {
    if (handle === null) return;
    clock.clearTimeout(handle);
    handle = null;
    remaining = Math.max(0, remaining - (clock.now() - startedAt));
  };

  start();

  return {
    pause: () => {
      if (done) return;
      holds += 1;
      stop();
    },
    resume: () => {
      if (done || holds === 0) return;
      holds -= 1;
      if (holds === 0) start();
    },
    dispose: () => {
      done = true;
      stop();
    },
    remaining: () =>
      handle === null ? remaining : Math.max(0, remaining - (clock.now() - startedAt))
  };
}
