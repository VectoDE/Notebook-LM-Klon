import {
  LOCAL_SALT_BYTES,
  LocalCipher,
  type LocalCipherOptions,
  buildAad,
  deriveLocalKey
} from "./local-crypto.js";

/**
 * Verschlüsselte lokale Ablage in IndexedDB (Issue #348).
 *
 * Datenbank LOCAL_DB_NAME mit zwei Object Stores:
 * - "meta": Salz der Schlüsselableitung (nicht geheim) und ein Prüfwert, mit dem sich
 *   erkennen lässt, ob der aktuelle Sitzungsschlüssel zu den gespeicherten Daten passt.
 * - "records": Datensätze { area, id, v, iv, ct }. Klartext liegt nie in IndexedDB.
 *
 * Passt der Schlüssel nicht (neue Sitzung, Rotation), sind die alten Chiffrate ohnehin
 * unlesbar; die Datenbank wird dann geleert und neu angelegt (reset: true).
 */

export const LOCAL_DB_NAME = "rn-local-v1";
const DB_VERSION = 1;
const META = "meta";
const RECORDS = "records";
const VERIFIER_AREA = "__meta";
const VERIFIER_ID = "verifier";
const VERIFIER_TEXT = "relationnotes-local-verifier";

type Area = string;

interface StoredRecord {
  readonly area: Area;
  readonly id: string;
  readonly v: number;
  readonly iv: Uint8Array;
  readonly ct: Uint8Array;
}

export interface LocalRecord<T> {
  readonly id: string;
  readonly value: T;
}

export interface EncryptedStore {
  put(area: Area, id: string, value: unknown): Promise<void>;
  putBytes(area: Area, id: string, value: Uint8Array): Promise<void>;
  get<T>(area: Area, id: string): Promise<T | undefined>;
  getBytes(area: Area, id: string): Promise<Uint8Array | undefined>;
  list<T>(area: Area): Promise<LocalRecord<T>[]>;
  listBytes(area: Area): Promise<LocalRecord<Uint8Array>[]>;
  delete(area: Area, id: string): Promise<void>;
  clear(area: Area): Promise<void>;
  close(): void;
}

export interface OpenStoreOptions {
  /** 32 Byte Sitzungsmaterial vom Server; wird nach der Ableitung genullt. */
  readonly material: Uint8Array;
  readonly idb?: IDBFactory | undefined;
  readonly cipher?: Omit<LocalCipherOptions, "subtle"> | undefined;
  readonly subtle?: SubtleCrypto | undefined;
}

export interface OpenStoreResult {
  readonly store: EncryptedStore;
  /** true, wenn vorhandene Daten zu einem anderen Schlüssel gehörten und gelöscht wurden. */
  readonly reset: boolean;
}

/** Offene Verbindungen dieser Seite; wipeLocalData schließt sie vor dem Löschen. */
const openConnections = new Set<IDBDatabase>();

function defaultIdb(): IDBFactory | undefined {
  return globalThis.indexedDB;
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function openDatabase(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open(LOCAL_DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(META);
      const records = db.createObjectStore(RECORDS, { keyPath: ["area", "id"] });
      records.createIndex("area", "area");
    };
    request.onsuccess = () => {
      const db = request.result;
      // Andere Tabs oder ein Abmelden wollen löschen: Verbindung sofort freigeben
      db.onversionchange = () => {
        db.close();
        openConnections.delete(db);
      };
      openConnections.add(db);
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

async function readMeta(db: IDBDatabase, key: string): Promise<unknown> {
  const tx = db.transaction(META, "readonly");
  return requestToPromise(tx.objectStore(META).get(key));
}

async function clearAll(db: IDBDatabase): Promise<void> {
  const tx = db.transaction([META, RECORDS], "readwrite");
  tx.objectStore(META).clear();
  tx.objectStore(RECORDS).clear();
  await txDone(tx);
}

async function writeMeta(db: IDBDatabase, entries: Record<string, unknown>): Promise<void> {
  const tx = db.transaction(META, "readwrite");
  for (const [key, value] of Object.entries(entries)) tx.objectStore(META).put(value, key);
  await txDone(tx);
}

/**
 * Öffnet die Ablage mit dem Schlüssel der aktuellen Sitzung. Erster Start: neues Salz
 * und Prüfwert. Passt der Prüfwert nicht zum Schlüssel, wird alles gelöscht.
 */
export async function openEncryptedStore(options: OpenStoreOptions): Promise<OpenStoreResult> {
  const idb = options.idb ?? defaultIdb();
  if (!idb) throw new Error("IndexedDB ist nicht verfügbar.");
  const subtle = options.subtle ?? crypto.subtle;
  const db = await openDatabase(idb);
  try {
    let salt = await readMeta(db, "salt");
    let reset = false;
    const fresh = !(salt instanceof Uint8Array) || salt.byteLength !== LOCAL_SALT_BYTES;
    if (fresh) {
      salt = crypto.getRandomValues(new Uint8Array(LOCAL_SALT_BYTES));
    }
    const key = await deriveLocalKey(options.material, salt as Uint8Array, subtle);
    const cipher = new LocalCipher(key, { ...options.cipher, subtle });
    const verifierAad = buildAad(VERIFIER_AREA, VERIFIER_ID);

    if (!fresh) {
      try {
        // AES-GCM authentifiziert: Entschlüsseln gelingt nur mit genau diesem Schlüssel
        await cipher.decrypt(verifierAad, await readMeta(db, VERIFIER_ID));
      } catch {
        // Daten einer anderen Sitzung: nicht lesbar, also entfernen
        reset = true;
      }
    }
    if (fresh || reset) {
      await clearAll(db);
      await writeMeta(db, {
        salt,
        [VERIFIER_ID]: await cipher.encryptJson(verifierAad, VERIFIER_TEXT)
      });
    }
    return { store: createStore(db, cipher), reset };
  } catch (error) {
    db.close();
    openConnections.delete(db);
    throw error;
  }
}

function createStore(db: IDBDatabase, cipher: LocalCipher): EncryptedStore {
  const writeRecord = async (area: Area, id: string, plain: Uint8Array): Promise<void> => {
    const envelope = await cipher.encrypt(buildAad(area, id), plain);
    const record: StoredRecord = { area, id, v: envelope.v, iv: envelope.iv, ct: envelope.ct };
    const tx = db.transaction(RECORDS, "readwrite");
    tx.objectStore(RECORDS).put(record);
    await txDone(tx);
  };

  const readRecord = async (area: Area, id: string): Promise<Uint8Array | undefined> => {
    const tx = db.transaction(RECORDS, "readonly");
    const record = await requestToPromise<StoredRecord | undefined>(
      tx.objectStore(RECORDS).get([area, id])
    );
    return record ? cipher.decrypt(buildAad(area, id), record) : undefined;
  };

  const listRecords = async (area: Area): Promise<LocalRecord<Uint8Array>[]> => {
    const tx = db.transaction(RECORDS, "readonly");
    const records = await requestToPromise<StoredRecord[]>(
      tx.objectStore(RECORDS).index("area").getAll(area)
    );
    const result: LocalRecord<Uint8Array>[] = [];
    for (const record of records) {
      result.push({
        id: record.id,
        value: await cipher.decrypt(buildAad(area, record.id), record)
      });
    }
    return result;
  };

  const decodeJson = <T>(bytes: Uint8Array): T => JSON.parse(new TextDecoder().decode(bytes)) as T;

  return {
    put: (area, id, value) =>
      writeRecord(area, id, new TextEncoder().encode(JSON.stringify(value))),
    putBytes: (area, id, value) => writeRecord(area, id, value),
    get: async <T>(area: Area, id: string) => {
      const bytes = await readRecord(area, id);
      return bytes ? decodeJson<T>(bytes) : undefined;
    },
    getBytes: readRecord,
    list: async <T>(area: Area) =>
      (await listRecords(area)).map(({ id, value }) => ({ id, value: decodeJson<T>(value) })),
    listBytes: listRecords,
    delete: async (area, id) => {
      const tx = db.transaction(RECORDS, "readwrite");
      tx.objectStore(RECORDS).delete([area, id]);
      await txDone(tx);
    },
    clear: async (area) => {
      const tx = db.transaction(RECORDS, "readwrite");
      const store = tx.objectStore(RECORDS);
      const keys = await requestToPromise(store.index("area").getAllKeys(area));
      for (const key of keys) store.delete(key);
      await txDone(tx);
    },
    close: () => {
      db.close();
      openConnections.delete(db);
    }
  };
}

/**
 * Löscht die gesamte lokale Datenbank. Offene Verbindungen dieser Seite werden vorher
 * geschlossen, andere Tabs schließen ihre über onversionchange. true, wenn gelöscht.
 */
export async function wipeLocalData(idb: IDBFactory | undefined = defaultIdb()): Promise<boolean> {
  for (const db of openConnections) db.close();
  openConnections.clear();
  // Ohne IndexedDB (z. B. gesperrter Speicher) gibt es nichts zu löschen
  if (!idb) return true;
  return new Promise((resolve) => {
    const request = idb.deleteDatabase(LOCAL_DB_NAME);
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
    // Ein anderer Tab hält die Datenbank noch: Löschen läuft weiter, sobald er schließt
    request.onblocked = () => undefined;
  });
}

/** Gibt es die lokale Datenbank? Ohne indexedDB.databases() (ältere Browser): undefined. */
export async function localDataExists(
  idb: IDBFactory | undefined = defaultIdb()
): Promise<boolean | undefined> {
  if (!idb) return false;
  if (typeof idb.databases !== "function") return undefined;
  const list = await idb.databases();
  return list.some((info) => info.name === LOCAL_DB_NAME);
}
