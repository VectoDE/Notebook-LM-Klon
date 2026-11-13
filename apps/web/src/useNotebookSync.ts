import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLocalKey } from "./local-session.js";
import type { NotebookSyncController } from "./notebook-sync.js";
import type { SyncStatus } from "./offline-sync.js";

/** Abstand für erneute Versuche, solange Änderungen warten. */
const RETRY_MS = 15_000;

export interface NotebookSyncHandle {
  /** null: keine Sitzung oder kein Schlüssel; dann gilt das bisherige lokale Speichern. */
  readonly status: SyncStatus | null;
  /** true, wenn die Synchronisation die Umbenennung übernommen hat. */
  readonly rename: (title: string) => boolean;
  /** Beendet die Synchronisation sofort (Abmelden). */
  readonly stop: () => void;
}

/**
 * Startet die Offline-Synchronisation des Notebooks (Issue #347), sobald ein Sitzungsschlüssel
 * (Issue #348) vorliegt. Yjs und die Ablage werden erst dann nachgeladen.
 */
export function useNotebookSync(
  notebookId: string,
  initialTitle: string | undefined,
  onTitle: (title: string) => void
): NotebookSyncHandle {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const controllerRef = useRef<NotebookSyncController | null>(null);
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const initialTitleRef = useRef(initialTitle);

  useEffect(() => {
    let cancelled = false;
    const fetchFn = (input: string, init?: RequestInit) => fetch(input, init);
    void (async () => {
      const key = await fetchLocalKey(fetchFn);
      if (cancelled || key.status !== "ok") return;
      const { startNotebookSync } = await import("./notebook-sync.js");
      const controller = await startNotebookSync({
        notebookId,
        material: key.material,
        fetchFn,
        isOnline: () => navigator.onLine,
        onStatus: (next) => {
          if (!cancelled) setStatus(next);
        },
        onTitle: (title) => {
          if (!cancelled) onTitleRef.current(title);
        },
        initialTitle: initialTitleRef.current
      });
      if (cancelled) controller.destroy();
      else controllerRef.current = controller;
    })();

    const flush = () => void controllerRef.current?.flush();
    window.addEventListener("online", flush);
    window.addEventListener("offline", flush);
    const timer = window.setInterval(() => {
      const current = controllerRef.current?.status;
      if (current && current.pending > 0) flush();
    }, RETRY_MS);
    return () => {
      cancelled = true;
      window.removeEventListener("online", flush);
      window.removeEventListener("offline", flush);
      window.clearInterval(timer);
      controllerRef.current?.destroy();
      controllerRef.current = null;
      setStatus(null);
    };
  }, [notebookId]);

  const rename = useCallback((title: string) => {
    const controller = controllerRef.current;
    if (!controller) return false;
    controller.rename(title);
    return true;
  }, []);

  const stop = useCallback(() => {
    controllerRef.current?.destroy();
    controllerRef.current = null;
    setStatus(null);
  }, []);

  return { status, rename, stop };
}
