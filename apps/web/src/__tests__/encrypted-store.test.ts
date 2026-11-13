import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import {
  LOCAL_DB_NAME,
  localDataExists,
  openEncryptedStore,
  requestToPromise,
  txDone,
  wipeLocalData
} from "../encrypted-store.js";

/** Ruft einen Ereignis-Handler eines nachgebauten IDB-Objekts auf. */
function fire(target: object, handler: string): void {
  const fn = (target as Record<string, ((event: Event) => void) | undefined>)[handler];
  fn?.(new Event(handler.slice(2)));
}

const materialA = () => new Uint8Array(32).fill(11);
const materialB = () => new Uint8Array(32).fill(22);

/** Liest alle Rohdatensätze, so wie sie auf der Festplatte liegen. */
async function rawRecords(idb: IDBFactory): Promise<unknown[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open(LOCAL_DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = db.transaction(["records", "meta"], "readonly");
  const records = await requestToPromise(tx.objectStore("records").getAll());
  const meta = await requestToPromise(tx.objectStore("meta").getAll());
  db.close();
  return [...records, ...meta];
}

function containsText(value: unknown, text: string): boolean {
  if (value instanceof Uint8Array) return new TextDecoder().decode(value).includes(text);
  if (typeof value === "string") return value.includes(text);
  if (value && typeof value === "object") {
    return Object.values(value).some((v) => containsText(v, text));
  }
  return false;
}

describe("openEncryptedStore (Issue #348)", () => {
  it("speichert, liest, listet und löscht – nur Chiffrat in IndexedDB", async () => {
    const idb = new IDBFactory();
    const { store, reset } = await openEncryptedStore({ material: materialA(), idb });
    expect(reset).toBe(false);

    await store.put("titles", "nb_1", { title: "Vertrauliche Strategie" });
    await store.put("titles", "nb_2", { title: "Zweiter Titel" });
    await store.putBytes("outbox", "u1", new TextEncoder().encode("Yjs-Update Geheimtext"));

    expect(await store.get("titles", "nb_1")).toEqual({ title: "Vertrauliche Strategie" });
    expect(await store.get("titles", "fehlt")).toBeUndefined();
    expect(await store.getBytes("titles", "fehlt")).toBeUndefined();
    expect(new TextDecoder().decode(await store.getBytes("outbox", "u1"))).toBe(
      "Yjs-Update Geheimtext"
    );
    expect((await store.list("titles")).map((r) => r.id).sort()).toEqual(["nb_1", "nb_2"]);
    expect(await store.listBytes("outbox")).toHaveLength(1);

    const raw = await rawRecords(idb);
    expect(raw.length).toBeGreaterThan(3);
    expect(raw.some((r) => containsText(r, "Vertrauliche"))).toBe(false);
    expect(raw.some((r) => containsText(r, "Geheimtext"))).toBe(false);

    await store.delete("titles", "nb_2");
    expect(await store.list("titles")).toHaveLength(1);
    await store.clear("titles");
    expect(await store.list("titles")).toHaveLength(0);
    expect(await store.listBytes("outbox")).toHaveLength(1);
    store.close();
  });

  it("liest nach erneutem Öffnen mit demselben Sitzungsmaterial weiter", async () => {
    const idb = new IDBFactory();
    const first = await openEncryptedStore({ material: materialA(), idb });
    await first.store.put("titles", "nb_1", "A");
    first.store.close();
    const second = await openEncryptedStore({ material: materialA(), idb });
    expect(second.reset).toBe(false);
    expect(await second.store.get("titles", "nb_1")).toBe("A");
    second.store.close();
  });

  it("verwirft Daten einer anderen Sitzung (falscher Schlüssel)", async () => {
    const idb = new IDBFactory();
    const first = await openEncryptedStore({ material: materialA(), idb });
    await first.store.put("titles", "nb_1", "A");
    first.store.close();
    const second = await openEncryptedStore({ material: materialB(), idb });
    expect(second.reset).toBe(true);
    expect(await second.store.list("titles")).toEqual([]);
    second.store.close();
  });

  it("erkennt vertauschte Datensätze über die AAD", async () => {
    const idb = new IDBFactory();
    const { store } = await openEncryptedStore({ material: materialA(), idb });
    await store.put("titles", "nb_1", "A");
    store.close();
    // Datensatz nb_1 roh unter der ID nb_2 einspielen
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = idb.open(LOCAL_DB_NAME);
      req.onsuccess = () => resolve(req.result);
    });
    const tx = db.transaction("records", "readwrite");
    const os = tx.objectStore("records");
    const rec = (await requestToPromise(os.get(["titles", "nb_1"]))) as Record<string, unknown>;
    os.put({ ...rec, id: "nb_2" });
    await txDone(tx);
    db.close();
    const again = await openEncryptedStore({ material: materialA(), idb });
    await expect(again.store.get("titles", "nb_2")).rejects.toMatchObject({ code: "decrypt" });
    again.store.close();
  });

  it("behandelt ein kaputtes Salz wie einen Neustart", async () => {
    const idb = new IDBFactory();
    const { store } = await openEncryptedStore({ material: materialA(), idb });
    store.close();
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = idb.open(LOCAL_DB_NAME);
      req.onsuccess = () => resolve(req.result);
    });
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put("kein-salz", "salt");
    await txDone(tx);
    db.close();
    const again = await openEncryptedStore({ material: materialA(), idb });
    expect(again.reset).toBe(false);
    again.store.close();
  });

  it("schließt die Verbindung, wenn das Öffnen scheitert", async () => {
    const idb = new IDBFactory();
    await expect(openEncryptedStore({ material: new Uint8Array(3), idb })).rejects.toMatchObject({
      code: "key-material"
    });
    // Keine offene Verbindung blockiert das Löschen
    expect(await wipeLocalData(idb)).toBe(true);
  });

  it("ohne IndexedDB gibt es einen klaren Fehler", async () => {
    await expect(openEncryptedStore({ material: materialA() })).rejects.toThrow(/IndexedDB/);
  });

  it("meldet Fehler beim Öffnen der Datenbank", async () => {
    const request = {} as IDBOpenDBRequest & { error: Error };
    Object.assign(request, { error: new Error("open kaputt") });
    const idb = { open: () => request } as unknown as IDBFactory;
    const pending = openEncryptedStore({ material: materialA(), idb });
    fire(request, "onerror");
    await expect(pending).rejects.toThrow("open kaputt");
  });
});

describe("wipeLocalData und localDataExists", () => {
  it("Abmelden löscht die Datenbank nachweisbar, auch bei offener Verbindung", async () => {
    const idb = new IDBFactory();
    const { store } = await openEncryptedStore({ material: materialA(), idb });
    await store.put("titles", "nb_1", "A");
    expect(await localDataExists(idb)).toBe(true);
    expect(await wipeLocalData(idb)).toBe(true);
    expect(await localDataExists(idb)).toBe(false);
  });

  it("andere Verbindungen schließen sich bei versionchange", async () => {
    const idb = new IDBFactory();
    const { store } = await openEncryptedStore({ material: materialA(), idb });
    await store.put("titles", "nb_1", "A");
    // Löschen an der Ablage vorbei (wie aus einem anderen Tab)
    await new Promise<void>((resolve, reject) => {
      const req = idb.deleteDatabase(LOCAL_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    expect(await localDataExists(idb)).toBe(false);
  });

  it("ohne IndexedDB: nichts zu löschen, nichts vorhanden", async () => {
    expect(await wipeLocalData(undefined)).toBe(true);
    expect(await localDataExists(undefined)).toBe(false);
  });

  it("ohne databases(): Vorhandensein unbekannt", async () => {
    expect(await localDataExists({} as IDBFactory)).toBeUndefined();
  });

  it("meldet ein gescheitertes Löschen und wartet bei blockiertem Löschen", async () => {
    const failing = {} as IDBOpenDBRequest;
    const idbFail = { deleteDatabase: () => failing } as unknown as IDBFactory;
    const pendingFail = wipeLocalData(idbFail);
    fire(failing, "onerror");
    expect(await pendingFail).toBe(false);

    const blocked = {} as IDBOpenDBRequest;
    const idbBlocked = { deleteDatabase: () => blocked } as unknown as IDBFactory;
    const pendingBlocked = wipeLocalData(idbBlocked);
    fire(blocked, "onblocked");
    fire(blocked, "onsuccess");
    expect(await pendingBlocked).toBe(true);
  });
});

describe("Hilfsfunktionen", () => {
  it("requestToPromise reicht Fehler weiter", async () => {
    const req = { error: new Error("req kaputt") } as unknown as IDBRequest;
    const p = requestToPromise(req);
    fire(req, "onerror");
    await expect(p).rejects.toThrow("req kaputt");
  });

  it("txDone reicht Fehler und Abbruch weiter", async () => {
    const tx1 = { error: new Error("tx kaputt") } as unknown as IDBTransaction;
    const p1 = txDone(tx1);
    fire(tx1, "onerror");
    await expect(p1).rejects.toThrow("tx kaputt");
    const tx2 = { error: new Error("abgebrochen") } as unknown as IDBTransaction;
    const p2 = txDone(tx2);
    fire(tx2, "onabort");
    await expect(p2).rejects.toThrow("abgebrochen");
  });
});
