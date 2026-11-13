import * as Y from "yjs";
import type { EncryptedStore } from "./encrypted-store.js";

/**
 * Offline-Bearbeiten mit Synchronisation (Issue #347) auf Basis von Yjs.
 *
 * - Jede lokale Änderung am Y.Doc landet als Yjs-Update in einer Warteschlange. Mit Sitzung
 *   liegt sie verschlüsselt in IndexedDB (Issue #348), dazu ein verschlüsselter Schnappschuss
 *   des ganzen Stands; ohne Ablage nur im Arbeitsspeicher.
 * - flush(): offline nichts senden, sonst alle wartenden Updates zusammengeführt per POST
 *   schicken, danach per Zustandsvektor holen, was am Server neu ist.
 * - Konflikte: Yjs-Updates sind kommutativ und idempotent. Gleichzeitige Änderungen an
 *   verschiedenen Feldern bleiben beide erhalten; am selben Feld gewinnt auf allen Geräten
 *   derselbe Wert (Yjs-Regel für Y.Map). Ein doppelt gesendetes Update schadet nicht.
 */

export type SyncState = "syncing" | "synced" | "pending" | "offline" | "error";

export interface SyncStatus {
  readonly state: SyncState;
  /** Lokale Änderungen, die der Server noch nicht bestätigt hat. */
  readonly pending: number;
}

export interface SyncTransport {
  /** Schickt ein (zusammengeführtes) Update. Wirft SyncHttpError oder einen Netzfehler. */
  push(update: Uint8Array): Promise<void>;
  /** Holt, was zum Zustandsvektor fehlt. */
  pull(stateVector: Uint8Array): Promise<Uint8Array>;
}

/** Antwort des Servers mit Fehlerstatus (kein Netzfehler). */
export class SyncHttpError extends Error {
  constructor(readonly status: number) {
    super(`sync: HTTP ${status}`);
    this.name = "SyncHttpError";
  }
}

/** Herkunft von Updates, die nicht erneut gesendet werden dürfen. */
export const REMOTE_ORIGIN = Symbol("rn-remote");
export const RESTORE_ORIGIN = Symbol("rn-restore");

const outboxArea = (notebookId: string) => `outbox:${notebookId}`;
const docArea = (notebookId: string) => `doc:${notebookId}`;
const SNAPSHOT_ID = "state";

export interface OfflineSyncOptions {
  readonly doc: Y.Doc;
  readonly notebookId: string;
  readonly store: EncryptedStore | null;
  readonly transport: SyncTransport;
  readonly isOnline: () => boolean;
  readonly onStatus: (status: SyncStatus) => void;
}

interface QueuedUpdate {
  readonly id: string;
  readonly update: Uint8Array;
}

export class OfflineSync {
  private readonly queue: QueuedUpdate[] = [];
  private running: Promise<void> | null = null;
  private again = false;
  private state: SyncState = "pending";
  private persistChain: Promise<void> = Promise.resolve();
  private readonly onUpdate: (update: Uint8Array, origin: unknown) => void;

  private constructor(private readonly opts: OfflineSyncOptions) {
    this.onUpdate = (update, origin) => {
      if (origin === REMOTE_ORIGIN || origin === RESTORE_ORIGIN) return;
      this.enqueue(update);
    };
  }

  /**
   * Stellt den lokal gespeicherten Stand und die Warteschlange wieder her und hört danach
   * auf Änderungen am Dokument.
   */
  static async create(opts: OfflineSyncOptions): Promise<OfflineSync> {
    const sync = new OfflineSync(opts);
    const { store, notebookId, doc } = opts;
    if (store) {
      const snapshot = await store.getBytes(docArea(notebookId), SNAPSHOT_ID);
      if (snapshot) Y.applyUpdate(doc, snapshot, RESTORE_ORIGIN);
      const queued = await store.listBytes(outboxArea(notebookId));
      queued.sort((a, b) => a.id.localeCompare(b.id));
      for (const { id, value } of queued) {
        Y.applyUpdate(doc, value, RESTORE_ORIGIN);
        sync.queue.push({ id, update: value });
      }
    }
    doc.on("update", sync.onUpdate);
    sync.emit(sync.queue.length > 0 ? "pending" : "synced");
    return sync;
  }

  get status(): SyncStatus {
    return { state: this.state, pending: this.queue.length };
  }

  /** Wartet, bis alle verschlüsselten Schreibvorgänge abgeschlossen sind (für Tests). */
  persisted(): Promise<void> {
    return this.persistChain;
  }

  destroy(): void {
    this.opts.doc.off("update", this.onUpdate);
  }

  private emit(state: SyncState): void {
    this.state = state;
    this.opts.onStatus(this.status);
  }

  private persist(work: (store: EncryptedStore) => Promise<void>): void {
    const store = this.opts.store;
    if (!store) return;
    // Nacheinander, damit ein späterer Schnappschuss nie von einem früheren überschrieben wird
    this.persistChain = this.persistChain.then(() => work(store)).catch(() => undefined);
  }

  private saveSnapshot(): void {
    const state = Y.encodeStateAsUpdate(this.opts.doc);
    this.persist((store) => store.putBytes(docArea(this.opts.notebookId), SNAPSHOT_ID, state));
  }

  private enqueue(update: Uint8Array): void {
    // Zeit zuerst (Reihenfolge beim Wiederherstellen), Zufall gegen Kollisionen nach Neuladen
    const id = `${Date.now().toString(36).padStart(9, "0")}-${crypto.randomUUID()}`;
    this.queue.push({ id, update });
    this.persist((store) => store.putBytes(outboxArea(this.opts.notebookId), id, update));
    this.saveSnapshot();
    this.emit(this.opts.isOnline() ? "pending" : "offline");
    void this.flush();
  }

  /** Synchronisiert jetzt. Läuft schon ein Durchgang, folgt direkt ein weiterer. */
  flush(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.flush();
      }
    });
    return this.running;
  }

  private async run(): Promise<void> {
    if (!this.opts.isOnline()) {
      this.emit("offline");
      return;
    }
    this.emit("syncing");
    try {
      const batch = this.queue.slice();
      if (batch.length > 0) {
        await this.opts.transport.push(Y.mergeUpdates(batch.map((entry) => entry.update)));
        const sent = new Set(batch.map((entry) => entry.id));
        for (let i = this.queue.length - 1; i >= 0; i -= 1) {
          if (sent.has((this.queue[i] as QueuedUpdate).id)) this.queue.splice(i, 1);
        }
        for (const id of sent) {
          this.persist((store) => store.delete(outboxArea(this.opts.notebookId), id));
        }
      }
      const remote = await this.opts.transport.pull(Y.encodeStateVector(this.opts.doc));
      Y.applyUpdate(this.opts.doc, remote, REMOTE_ORIGIN);
      this.saveSnapshot();
      this.emit(this.queue.length > 0 ? "pending" : "synced");
    } catch (error) {
      // fetch meldet fehlende Verbindung als TypeError; alles andere ist ein echter Fehler
      this.emit(error instanceof TypeError ? "offline" : "error");
    }
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** HTTP-Anbindung an GET/POST /api/v1/notebooks/:id/doc. */
export function createHttpTransport(notebookId: string, fetchFn: FetchFn): SyncTransport {
  const url = `/api/v1/notebooks/${encodeURIComponent(notebookId)}/doc`;
  return {
    push: async (update) => {
      const res = await fetchFn(url, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ update: toBase64Url(update) })
      });
      if (!res.ok) throw new SyncHttpError(res.status);
    },
    pull: async (stateVector) => {
      const res = await fetchFn(`${url}?sv=${toBase64Url(stateVector)}`, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: "application/json" }
      });
      if (!res.ok) throw new SyncHttpError(res.status);
      try {
        const body = (await res.json()) as { update?: unknown };
        if (typeof body.update !== "string") throw new Error("update fehlt");
        return fromBase64Url(body.update);
      } catch {
        throw new SyncHttpError(502);
      }
    }
  };
}
