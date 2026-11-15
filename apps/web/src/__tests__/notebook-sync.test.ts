import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { readTitle, startNotebookSync, writeTitle } from "../notebook-sync.js";
import type { SyncStatus, SyncTransport } from "../offline-sync.js";

function memoryTransport(initial?: (doc: Y.Doc) => void): SyncTransport & { doc: Y.Doc } {
  const doc = new Y.Doc();
  initial?.(doc);
  return {
    doc,
    push: async (update) => Y.applyUpdate(doc, update),
    pull: async (sv) => Y.encodeStateAsUpdate(doc, sv)
  };
}

const base = (transport: SyncTransport, idb?: IDBFactory) => {
  const titles: string[] = [];
  const statuses: SyncStatus[] = [];
  return {
    titles,
    statuses,
    options: {
      notebookId: "nb_x",
      material: new Uint8Array(32).fill(9),
      fetchFn: async () => new Response(null, { status: 500 }),
      isOnline: () => true,
      onStatus: (s: SyncStatus) => statuses.push(s),
      onTitle: (t: string) => titles.push(t),
      transport,
      idb
    }
  };
};

describe("Titel im Yjs-Dokument", () => {
  it("liest und schreibt nur Zeichenketten", () => {
    const doc = new Y.Doc();
    expect(readTitle(doc)).toBeUndefined();
    doc.getMap("meta").set("title", 5);
    expect(readTitle(doc)).toBeUndefined();
    writeTitle(doc, "A");
    expect(readTitle(doc)).toBe("A");
  });
});

describe("startNotebookSync (Issue #347)", () => {
  it("übernimmt den Titel vom Server statt des alten lokalen", async () => {
    const transport = memoryTransport((doc) => writeTitle(doc, "Server-Titel"));
    const { options, titles } = base(transport, new IDBFactory());
    const controller = await startNotebookSync({ ...options, initialTitle: "Alter Titel" });
    expect(titles).toEqual(["Server-Titel"]);
    expect(readTitle(transport.doc)).toBe("Server-Titel");
    controller.destroy();
  });

  it("schreibt einen lokalen Titel ins Dokument, wenn der Server keinen kennt", async () => {
    const transport = memoryTransport();
    const { options, titles } = base(transport, new IDBFactory());
    const controller = await startNotebookSync({ ...options, initialTitle: "Lokal" });
    await controller.flush();
    expect(readTitle(transport.doc)).toBe("Lokal");
    controller.rename("Umbenannt");
    await controller.flush();
    expect(readTitle(transport.doc)).toBe("Umbenannt");
    expect(titles).toEqual(["Lokal", "Umbenannt"]);
    expect(controller.status).toEqual({ state: "synced", pending: 0 });
    controller.destroy();
  });

  it("ohne Titel und ohne IndexedDB läuft die Warteschlange im Speicher", async () => {
    const transport = memoryTransport();
    const { options, titles } = base(transport);
    const controller = await startNotebookSync(options);
    expect(titles).toEqual([]);
    controller.rename("Nur im Speicher");
    await controller.flush();
    expect(readTitle(transport.doc)).toBe("Nur im Speicher");
    controller.destroy();
  });

  it("nutzt ohne eigenen Transport die HTTP-Anbindung", async () => {
    const { options, statuses } = base(memoryTransport(), new IDBFactory());
    const controller = await startNotebookSync({ ...options, transport: undefined });
    expect(statuses.at(-1)?.state).toBe("error");
    controller.destroy();
  });
});
