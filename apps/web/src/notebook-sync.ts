import * as Y from "yjs";
import { type EncryptedStore, openEncryptedStore } from "./encrypted-store.js";
import {
  OfflineSync,
  type SyncStatus,
  type SyncTransport,
  createHttpTransport
} from "./offline-sync.js";

/**
 * Notebook-Dokument und Start der Synchronisation (Issue #347). Wird erst nach erfolgreichem
 * Schlüsselabruf dynamisch geladen, damit Yjs nicht im Start-Bundle landet.
 */

const META = "meta";
const TITLE_KEY = "title";

export function readTitle(doc: Y.Doc): string | undefined {
  const value = doc.getMap(META).get(TITLE_KEY);
  return typeof value === "string" ? value : undefined;
}

export function writeTitle(doc: Y.Doc, title: string): void {
  doc.getMap(META).set(TITLE_KEY, title);
}

export interface NotebookSyncController {
  readonly status: SyncStatus;
  rename(title: string): void;
  flush(): Promise<void>;
  destroy(): void;
}

export interface StartNotebookSyncOptions {
  readonly notebookId: string;
  /** Sitzungsmaterial (Issue #348); wird beim Öffnen der Ablage genullt. */
  readonly material: Uint8Array;
  readonly fetchFn: (input: string, init?: RequestInit) => Promise<Response>;
  readonly isOnline: () => boolean;
  readonly onStatus: (status: SyncStatus) => void;
  readonly onTitle: (title: string) => void;
  /** Titel aus der Zeit vor der Synchronisation; landet einmalig im Dokument. */
  readonly initialTitle?: string | undefined;
  readonly idb?: IDBFactory | undefined;
  readonly transport?: SyncTransport | undefined;
}

/**
 * Öffnet die verschlüsselte Ablage, stellt Dokument und Warteschlange wieder her und
 * synchronisiert einmal. Ohne nutzbare IndexedDB läuft die Warteschlange nur im Speicher.
 */
export async function startNotebookSync(
  options: StartNotebookSyncOptions
): Promise<NotebookSyncController> {
  let store: EncryptedStore | null = null;
  try {
    store = (await openEncryptedStore({ material: options.material, idb: options.idb })).store;
  } catch {
    store = null;
  }
  const doc = new Y.Doc();
  const sync = await OfflineSync.create({
    doc,
    notebookId: options.notebookId,
    store,
    transport: options.transport ?? createHttpTransport(options.notebookId, options.fetchFn),
    isOnline: options.isOnline,
    onStatus: options.onStatus
  });

  let lastTitle: string | undefined;
  const announceTitle = () => {
    const title = readTitle(doc);
    if (title !== undefined && title !== lastTitle) {
      lastTitle = title;
      options.onTitle(title);
    }
  };
  doc.on("update", announceTitle);
  announceTitle();
  // Erst den Serverstand holen: ein alter lokaler Titel soll keinen neueren überschreiben
  await sync.flush();
  if (lastTitle === undefined && options.initialTitle) writeTitle(doc, options.initialTitle);

  return {
    get status() {
      return sync.status;
    },
    rename: (title) => writeTitle(doc, title),
    flush: () => sync.flush(),
    destroy: () => {
      doc.off("update", announceTitle);
      sync.destroy();
      store?.close();
    }
  };
}
