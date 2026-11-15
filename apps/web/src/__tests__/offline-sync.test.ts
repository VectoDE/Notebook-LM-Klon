import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { openEncryptedStore } from "../encrypted-store.js";
import {
  OfflineSync,
  REMOTE_ORIGIN,
  SyncHttpError,
  type SyncStatus,
  type SyncTransport,
  createHttpTransport
} from "../offline-sync.js";

/** Server im Speicher: hält den zusammengeführten Yjs-Stand wie das NotebookDO. */
function createServer() {
  let state: Uint8Array | null = null;
  let online = true;
  let failWith: number | null = null;
  const pushes: Uint8Array[] = [];
  const transport: SyncTransport = {
    push: async (update) => {
      if (!online) throw new TypeError("Failed to fetch");
      if (failWith) throw new SyncHttpError(failWith);
      pushes.push(update);
      state = state ? Y.mergeUpdates([state, update]) : update;
    },
    pull: async (sv) => {
      if (!online) throw new TypeError("Failed to fetch");
      return state ? Y.diffUpdate(state, sv) : Y.encodeStateAsUpdate(new Y.Doc());
    }
  };
  return {
    transport,
    pushes,
    setOnline: (value: boolean) => {
      online = value;
    },
    failWith: (status: number | null) => {
      failWith = status;
    },
    snapshot: () => {
      const doc = new Y.Doc();
      if (state) Y.applyUpdate(doc, state);
      return doc;
    }
  };
}

const material = () => new Uint8Array(32).fill(5);

async function client(
  server: ReturnType<typeof createServer>,
  online: { value: boolean },
  store: Awaited<ReturnType<typeof openEncryptedStore>>["store"] | null = null,
  clientID?: number
) {
  const doc = new Y.Doc();
  if (clientID !== undefined) doc.clientID = clientID;
  const statuses: SyncStatus[] = [];
  const sync = await OfflineSync.create({
    doc,
    notebookId: "nb_1",
    store,
    transport: server.transport,
    isOnline: () => online.value,
    onStatus: (s) => statuses.push(s)
  });
  return { doc, sync, statuses, meta: doc.getMap<string>("meta") };
}

describe("OfflineSync (Issue #347)", () => {
  it("online: Änderung wird gesendet und als synchronisiert gemeldet", async () => {
    const server = createServer();
    const a = await client(server, { value: true });
    expect(a.sync.status).toEqual({ state: "synced", pending: 0 });
    a.meta.set("title", "Neu");
    await a.sync.flush();
    expect(server.snapshot().getMap("meta").get("title")).toBe("Neu");
    expect(a.sync.status).toEqual({ state: "synced", pending: 0 });
    expect(a.statuses.map((s) => s.state)).toContain("syncing");
  });

  it("offline schreiben: Warteschlange wächst, nichts wird gesendet", async () => {
    const server = createServer();
    const online = { value: false };
    server.setOnline(false);
    const a = await client(server, online);
    a.meta.set("title", "Eins");
    a.meta.set("note", "Zwei");
    await a.sync.flush();
    expect(a.sync.status).toEqual({ state: "offline", pending: 2 });
    expect(server.pushes).toHaveLength(0);
  });

  it("Browser meldet online, Netz fehlt trotzdem: Status offline", async () => {
    const server = createServer();
    server.setOnline(false);
    const a = await client(server, { value: true });
    a.meta.set("title", "T");
    await a.sync.flush();
    expect(a.sync.status).toEqual({ state: "offline", pending: 1 });
  });

  it("Wiederverbindung: wartende Änderungen gehen in einem Update raus", async () => {
    const server = createServer();
    const online = { value: false };
    server.setOnline(false);
    const a = await client(server, online);
    a.meta.set("title", "Offline geschrieben");
    a.meta.set("note", "auch offline");
    await a.sync.flush();
    online.value = true;
    server.setOnline(true);
    await a.sync.flush();
    expect(server.pushes).toHaveLength(1);
    expect(server.snapshot().getMap("meta").toJSON()).toEqual({
      title: "Offline geschrieben",
      note: "auch offline"
    });
    expect(a.sync.status).toEqual({ state: "synced", pending: 0 });
  });

  it("Konflikt: verschiedene Felder bleiben beide, dasselbe Feld endet überall gleich", async () => {
    const server = createServer();
    const onlineA = { value: true };
    const onlineB = { value: true };
    const a = await client(server, onlineA, null, 1);
    const b = await client(server, onlineB, null, 2);
    // A geht offline und ändert Titel und Notiz
    onlineA.value = false;
    a.meta.set("title", "Titel von A");
    a.meta.set("noteA", "nur A");
    // B ändert online denselben Titel und ein eigenes Feld
    b.meta.set("title", "Titel von B");
    b.meta.set("noteB", "nur B");
    await b.sync.flush();
    // A kommt zurück
    onlineA.value = true;
    await a.sync.flush();
    await b.sync.flush();

    const server1 = server.snapshot().getMap("meta").toJSON();
    expect(a.meta.toJSON()).toEqual(server1);
    expect(b.meta.toJSON()).toEqual(server1);
    expect(server1.noteA).toBe("nur A");
    expect(server1.noteB).toBe("nur B");
    expect(["Titel von A", "Titel von B"]).toContain(server1.title);
  });

  it("doppelt gesendete Updates schaden nicht (idempotent)", async () => {
    const server = createServer();
    const a = await client(server, { value: true });
    a.meta.set("title", "X");
    await a.sync.flush();
    await server.transport.push(server.pushes[0] as Uint8Array);
    expect(server.snapshot().getMap("meta").toJSON()).toEqual({ title: "X" });
  });

  it("Serverfehler: Status error, Änderungen bleiben in der Warteschlange", async () => {
    const server = createServer();
    const a = await client(server, { value: true });
    server.failWith(403);
    a.meta.set("title", "Y");
    await a.sync.flush();
    expect(a.sync.status).toEqual({ state: "error", pending: 1 });
    server.failWith(null);
    await a.sync.flush();
    expect(a.sync.status).toEqual({ state: "synced", pending: 0 });
  });

  it("Änderungen während eines Durchgangs lösen einen weiteren aus", async () => {
    const server = createServer();
    const a = await client(server, { value: true });
    a.meta.set("title", "1");
    const first = a.sync.flush();
    a.meta.set("title", "2");
    await first;
    await vi.waitFor(() => expect(a.sync.status).toEqual({ state: "synced", pending: 0 }));
    expect(server.snapshot().getMap("meta").get("title")).toBe("2");
  });

  it("entfernte Updates werden nicht zurückgesendet", async () => {
    const server = createServer();
    const a = await client(server, { value: true });
    const other = new Y.Doc();
    other.getMap("meta").set("title", "fremd");
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(other), REMOTE_ORIGIN);
    expect(a.sync.status.pending).toBe(0);
    a.sync.destroy();
    a.meta.set("title", "nach destroy");
    expect(a.sync.status.pending).toBe(0);
  });

  it("ungültiges Update vom Server ist ein Fehler, kein Offline", async () => {
    const a = await client(
      {
        ...createServer(),
        transport: { push: async () => undefined, pull: async () => new Uint8Array([1, 2, 3]) }
      } as ReturnType<typeof createServer>,
      { value: true }
    );
    await a.sync.flush();
    expect(a.sync.status.state).toBe("error");
  });
});

describe("Verschlüsselte Warteschlange über Neuladen hinweg", () => {
  it("offline geschriebene Änderungen überleben einen Neustart und werden danach gesendet", async () => {
    const idb = new IDBFactory();
    const server = createServer();
    server.setOnline(false);
    const online = { value: false };

    const first = await openEncryptedStore({ material: material(), idb });
    const a = await client(server, online, first.store);
    a.meta.set("title", "Vertraulich offline");
    a.meta.set("note", "zweite Änderung");
    await a.sync.flush();
    await a.sync.persisted();
    expect(a.sync.status).toEqual({ state: "offline", pending: 2 });
    a.sync.destroy();
    first.store.close();

    // Neuladen: gleiche Sitzung, gleiches Material
    const second = await openEncryptedStore({ material: material(), idb });
    const b = await client(server, online, second.store);
    expect(b.meta.get("title")).toBe("Vertraulich offline");
    expect(b.meta.get("note")).toBe("zweite Änderung");
    expect(b.sync.status).toEqual({ state: "pending", pending: 2 });

    online.value = true;
    server.setOnline(true);
    await b.sync.flush();
    await b.sync.persisted();
    expect(server.snapshot().getMap("meta").get("title")).toBe("Vertraulich offline");
    expect(await second.store.listBytes("outbox:nb_1")).toEqual([]);
    expect(await second.store.getBytes("doc:nb_1", "state")).toBeInstanceOf(Uint8Array);
    second.store.close();
  });

  it("Schreibfehler der Ablage halten die Synchronisation nicht auf", async () => {
    const idb = new IDBFactory();
    const { store } = await openEncryptedStore({ material: material(), idb });
    store.close();
    const server = createServer();
    const a = await client(server, { value: true }, {
      ...store,
      getBytes: async () => undefined,
      listBytes: async () => []
    } as typeof store);
    a.meta.set("title", "trotzdem");
    await a.sync.flush();
    await a.sync.persisted();
    expect(server.snapshot().getMap("meta").get("title")).toBe("trotzdem");
  });
});

describe("createHttpTransport", () => {
  it("POST und GET mit base64url gegen /api/v1/notebooks/:id/doc", async () => {
    const remote = new Y.Doc();
    remote.getMap("meta").set("title", "vom Server");
    const update = Y.encodeStateAsUpdate(remote);
    const b64 = btoa(String.fromCharCode(...update))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return init?.method === "POST"
        ? new Response(JSON.stringify({ stateVector: "AA" }), { status: 200 })
        : new Response(JSON.stringify({ update: b64, stateVector: "AA" }), { status: 200 });
    };
    const transport = createHttpTransport("nb 1", fetchFn);
    await transport.push(new Uint8Array([0, 0]));
    const pulled = await transport.pull(new Uint8Array([0]));
    expect(pulled).toEqual(update);
    expect(calls[0]?.url).toBe("/api/v1/notebooks/nb%201/doc");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ update: "AAA" });
    expect(calls[1]?.url).toBe("/api/v1/notebooks/nb%201/doc?sv=AA");
  });

  it("wirft SyncHttpError bei Fehlerstatus und kaputten Antworten", async () => {
    const failing = createHttpTransport("nb", async () => new Response(null, { status: 403 }));
    await expect(failing.push(new Uint8Array([0, 0]))).rejects.toMatchObject({ status: 403 });
    await expect(failing.pull(new Uint8Array([0]))).rejects.toMatchObject({ status: 403 });
    const html = createHttpTransport("nb", async () => new Response("<html>", { status: 200 }));
    await expect(html.pull(new Uint8Array([0]))).rejects.toMatchObject({ status: 502 });
    const noUpdate = createHttpTransport("nb", async () => new Response("{}", { status: 200 }));
    await expect(noUpdate.pull(new Uint8Array([0]))).rejects.toBeInstanceOf(SyncHttpError);
  });
});
