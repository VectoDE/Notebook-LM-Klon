import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runScheduledCleanup } from "../cleanup.js";
import { resolveAppConfig } from "../config.js";
import type { DatabaseAdapter } from "../core-repository.js";
import { verifyQuotaAction } from "../quota-guard.js";
import {
  FREE_TIER_R2_BUDGET,
  MAX_GUEST_STORAGE_BYTES,
  MAX_UPLOADS_PER_DAY,
  MAX_UPLOAD_BYTES_PER_DAY,
  MAX_USER_STORAGE_BYTES,
  R2_BUDGET_SHARE,
  R2_FREE_TIER,
  R2_OPS_PER_UPLOAD,
  R2_STORAGE_BUDGET_BYTES,
  STALE_UPLOAD_MS,
  UploadTooLargeError,
  limitStream,
  reserveUploadBudget,
  secondsUntilNextUtcDay
} from "../r2-budget.js";
import { RagRepository } from "../rag-repository.js";
import { MAX_SOURCE_BYTE_SIZE_LIMIT, registerSourcesUploadRoutes } from "../sources-upload.js";

const MIGRATIONS = [
  "0001_initial_core.sql",
  "0002_rag_and_studio.sql",
  "0003_webauthn_challenges.sql",
  "0007_upload_grenzen.sql"
];

type Params = (string | number | bigint | null)[];

function createDb(): {
  sqlite: DatabaseSync;
  adapter: DatabaseAdapter;
  d1: D1Database;
} {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of MIGRATIONS) {
    sqlite.exec(readFileSync(resolve(process.cwd(), "apps/worker/migrations", file), "utf-8"));
  }
  const adapter: DatabaseAdapter = {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return sqlite.prepare(sql).all(...(params as Params)) as T[];
    },
    async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      return (sqlite.prepare(sql).get(...(params as Params)) as T) ?? null;
    },
    async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
      return { changes: Number(sqlite.prepare(sql).run(...(params as Params)).changes) };
    },
    async exec(sql: string): Promise<void> {
      sqlite.exec(sql);
    }
  };
  const d1 = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          bound = args;
          return this;
        },
        first: <T>() => adapter.queryOne<T>(sql, bound),
        all: async <T>() => ({ results: await adapter.query<T>(sql, bound) }),
        run: async () => ({ meta: { changes: (await adapter.run(sql, bound)).changes } })
      };
    }
  } as unknown as D1Database;
  return { sqlite, adapter, d1 };
}

function seedOwner(sqlite: DatabaseSync, userId: string, notebookIds: string[], isGuest = 0): void {
  const now = Date.now();
  sqlite
    .prepare(
      "INSERT INTO users (id, email, display_name, locale, is_guest, created_at, expires_at) VALUES (?, NULL, 'U', 'de', ?, ?, ?)"
    )
    .run(userId, isGuest, now, isGuest ? now + 3600_000 : null);
  sqlite
    .prepare("INSERT INTO workspaces (id, name, owner_id, created_at) VALUES (?, 'W', ?, ?)")
    .run(`ws_${userId}`, userId, now);
  for (const nb of notebookIds) {
    sqlite
      .prepare(
        "INSERT INTO notebooks (id, workspace_id, title, created_by, created_at, updated_at) VALUES (?, ?, 'N', ?, ?, ?)"
      )
      .run(nb, `ws_${userId}`, userId, now, now);
  }
}

function insertSource(
  sqlite: DatabaseSync,
  id: string,
  notebookId: string,
  byteSize: number,
  options: { r2Key?: string | null; status?: string; createdAt?: number } = {}
): void {
  const createdAt = options.createdAt ?? Date.now();
  const r2Key =
    options.r2Key === undefined ? `notebooks/${notebookId}/sources/${id}.txt` : options.r2Key;
  sqlite
    .prepare(
      `INSERT INTO sources (id, notebook_id, title, original_name, mime_type, source_type, byte_size, r2_key, status, created_at, updated_at)
       VALUES (?, ?, 't', 't', 'text/plain', 'txt', ?, ?, ?, ?, ?)`
    )
    .run(id, notebookId, byteSize, r2Key, options.status ?? "ready", createdAt, createdAt);
}

function storedBytes(sqlite: DatabaseSync): number {
  return Number(
    (
      sqlite.prepare("SELECT stored_bytes FROM r2_usage WHERE id = 1").get() as {
        stored_bytes: number;
      }
    ).stored_bytes
  );
}

/** Minimaler R2-Bucket im Speicher, inklusive list() für den Cron. */
function createBucket() {
  const store = new Map<string, Uint8Array>();
  const bucket = {
    store,
    async put(key: string, value: ReadableStream<Uint8Array> | Uint8Array) {
      let data: Uint8Array;
      if (value instanceof Uint8Array) {
        data = value;
      } else {
        const chunks: Uint8Array[] = [];
        const reader = value.getReader();
        for (;;) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          chunks.push(chunk);
        }
        data = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
        let offset = 0;
        for (const c of chunks) {
          data.set(c, offset);
          offset += c.byteLength;
        }
      }
      store.set(key, data);
      return { key, size: data.byteLength, etag: `etag-${data.byteLength}` };
    },
    async get(key: string, options?: { range?: { offset: number; length: number } }) {
      const data = store.get(key);
      if (!data) return null;
      const slice = options?.range
        ? data.slice(options.range.offset, options.range.offset + options.range.length)
        : data;
      return {
        key,
        size: data.byteLength,
        body: new Response(slice).body,
        async arrayBuffer() {
          return slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
        }
      };
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? "";
      return {
        objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })),
        truncated: false
      };
    }
  };
  return bucket;
}

describe("R2-Freimenge und abgeleitete Grenzen (F247)", () => {
  it("belegt die Freimenge laut Cloudflare-Doku mit Quelle und Abrufdatum", () => {
    expect(R2_FREE_TIER.storageBytes).toBe(10_000_000_000);
    expect(R2_FREE_TIER.classAOpsPerMonth).toBe(1_000_000);
    expect(R2_FREE_TIER.classBOpsPerMonth).toBe(10_000_000);
    expect(R2_FREE_TIER.source).toBe("https://developers.cloudflare.com/r2/pricing/");
    expect(R2_FREE_TIER.retrievedAt).toBe("2026-11-14");
  });

  it("plant höchstens die Hälfte des Speichers ein", () => {
    expect(R2_BUDGET_SHARE).toBe(0.5);
    expect(R2_STORAGE_BUDGET_BYTES).toBe(5_000_000_000);
    expect(MAX_UPLOAD_BYTES_PER_DAY).toBeLessThanOrEqual(R2_STORAGE_BUDGET_BYTES);
  });

  it("bleibt bei vollem Tageslimit über 31 Tage unter 10 % der Class-A- und 1 % der Class-B-Operationen", () => {
    const uploadsPerMonth = MAX_UPLOADS_PER_DAY * 31;
    expect(uploadsPerMonth * R2_OPS_PER_UPLOAD.classA).toBeLessThanOrEqual(
      R2_FREE_TIER.classAOpsPerMonth * 0.1
    );
    expect(uploadsPerMonth * R2_OPS_PER_UPLOAD.classB).toBeLessThanOrEqual(
      R2_FREE_TIER.classBOpsPerMonth * 0.01
    );
  });

  it("verwendet die vorhandene 50-MB-Grenze je Datei und hält Nutzer- und Gastspeicher darunter", () => {
    expect(MAX_SOURCE_BYTE_SIZE_LIMIT).toBe(50 * 1024 * 1024);
    expect(MAX_GUEST_STORAGE_BYTES).toBeGreaterThanOrEqual(MAX_SOURCE_BYTE_SIZE_LIMIT);
    expect(MAX_USER_STORAGE_BYTES).toBeGreaterThan(MAX_GUEST_STORAGE_BYTES);
    expect(MAX_USER_STORAGE_BYTES).toBeLessThan(R2_STORAGE_BUDGET_BYTES);
  });

  it("setzt das R2-Budget im Profil demo und hebt es im Profil full auf", () => {
    const demo = resolveAppConfig({ APP_PROFILE: "demo" }).quotas;
    expect(demo.r2Budget).toEqual(FREE_TIER_R2_BUDGET);
    expect(demo.maxUserStorageBytes).toBe(MAX_USER_STORAGE_BYTES);
    expect(demo.maxGuestStorageBytes).toBe(MAX_GUEST_STORAGE_BYTES);
    const full = resolveAppConfig({ APP_PROFILE: "full" }).quotas;
    expect(full.r2Budget).toBeNull();
    expect(full.maxGuestStorageBytes).toBe(MAX_GUEST_STORAGE_BYTES);
  });

  it("rechnet Sekunden bis zum nächsten UTC-Tag für Retry-After", () => {
    expect(secondsUntilNextUtcDay(new Date("2026-11-14T23:59:30Z"))).toBe(30);
    expect(secondsUntilNextUtcDay(new Date("2026-11-14T00:00:00Z"))).toBe(86_400);
  });
});

describe("Zähler r2_usage per Trigger (Migration 0007)", () => {
  it("zählt nur Quellen mit R2-Objekt und folgt Änderungen und Kaskaden", () => {
    const { sqlite } = createDb();
    seedOwner(sqlite, "u1", ["nb1"]);
    expect(storedBytes(sqlite)).toBe(0);

    insertSource(sqlite, "s1", "nb1", 1000);
    insertSource(sqlite, "s2", "nb1", 500, { r2Key: null });
    expect(storedBytes(sqlite)).toBe(1000);

    sqlite.prepare("UPDATE sources SET byte_size = 400 WHERE id = 's1'").run();
    expect(storedBytes(sqlite)).toBe(400);
    sqlite.prepare("UPDATE sources SET r2_key = 'k' WHERE id = 's2'").run();
    expect(storedBytes(sqlite)).toBe(900);

    sqlite.exec("PRAGMA foreign_keys = ON");
    sqlite.prepare("DELETE FROM notebooks WHERE id = 'nb1'").run();
    expect(storedBytes(sqlite)).toBe(0);
  });
});

describe("reserveUploadBudget: globale Tages- und Speichergrenze", () => {
  const limits = { storageBytes: 1000, uploadsPerDay: 2, uploadBytesPerDay: 600 };
  const day1 = new Date("2026-11-14T10:00:00Z");

  it("lässt ohne Budget (Profil full) alles zu", async () => {
    const { d1 } = createDb();
    expect(await reserveUploadBudget(d1, 10 ** 12, null)).toEqual({ ok: true });
  });

  it("zählt Uploads und Bytes je UTC-Tag und lehnt den dritten Upload ab", async () => {
    const { d1, sqlite } = createDb();
    expect(await reserveUploadBudget(d1, 100, limits, day1)).toEqual({ ok: true });
    expect(await reserveUploadBudget(d1, 100, limits, day1)).toEqual({ ok: true });
    expect(await reserveUploadBudget(d1, 100, limits, day1)).toEqual({
      ok: false,
      code: "UPLOAD_DAILY_LIMIT_REACHED"
    });
    expect(sqlite.prepare("SELECT uploads, bytes FROM upload_daily").get()).toEqual({
      uploads: 2,
      bytes: 200
    });
    // Neuer UTC-Tag: neuer Zähler
    expect(await reserveUploadBudget(d1, 100, limits, new Date("2026-11-15T00:00:01Z"))).toEqual({
      ok: true
    });
  });

  it("lehnt ab, wenn die Tagesbytes überschritten würden (genau am Limit erlaubt)", async () => {
    const { d1 } = createDb();
    expect(await reserveUploadBudget(d1, 400, limits, day1)).toEqual({ ok: true });
    expect(await reserveUploadBudget(d1, 201, limits, day1)).toEqual({
      ok: false,
      code: "UPLOAD_DAILY_LIMIT_REACHED"
    });
    expect(await reserveUploadBudget(d1, 200, limits, day1)).toEqual({ ok: true });
  });

  it("lehnt eine einzelne Datei über dem Tagesbudget und ein Tagesbudget von 0 ab", async () => {
    const { d1 } = createDb();
    expect(await reserveUploadBudget(d1, 601, limits, day1)).toEqual({
      ok: false,
      code: "UPLOAD_DAILY_LIMIT_REACHED"
    });
    expect(await reserveUploadBudget(d1, 1, { ...limits, uploadsPerDay: 0 }, day1)).toEqual({
      ok: false,
      code: "UPLOAD_DAILY_LIMIT_REACHED"
    });
  });

  it("lehnt ab, wenn der gesamte R2-Speicher das Budget sprengen würde", async () => {
    const { d1, sqlite } = createDb();
    seedOwner(sqlite, "u1", ["nb1"]);
    insertSource(sqlite, "s1", "nb1", 900);
    expect(await reserveUploadBudget(d1, 100, limits, day1)).toEqual({ ok: true });
    expect(await reserveUploadBudget(d1, 101, limits, day1)).toEqual({
      ok: false,
      code: "STORAGE_BUDGET_EXHAUSTED"
    });
  });

  it("behandelt eine fehlende Zählerzeile wie 0 Bytes", async () => {
    const { d1, sqlite } = createDb();
    sqlite.exec("DELETE FROM r2_usage");
    expect(await reserveUploadBudget(d1, 100, limits, day1)).toEqual({ ok: true });
  });
});

describe("Speicher je Nutzer und je Gast (Summe byte_size in D1)", () => {
  const quotas = resolveAppConfig({ APP_PROFILE: "demo" }).quotas;
  const MB = 1024 * 1024;

  it("rechnet alle Notebooks des Eigentümers zusammen; genau am Limit ist erlaubt", async () => {
    const { d1, sqlite } = createDb();
    seedOwner(sqlite, "u1", ["nb1", "nb2", "nb3"]);
    // 500 MB verteilt auf drei Notebooks, je unter 200 MB
    insertSource(sqlite, "a", "nb1", 190 * MB);
    insertSource(sqlite, "b", "nb2", 190 * MB);
    insertSource(sqlite, "c", "nb3", 100 * MB);
    const atLimit = await verifyQuotaAction(
      d1,
      "u1",
      { type: "add_source", notebookId: "nb3", byteSize: 20 * MB },
      quotas
    );
    expect(atLimit.allowed).toBe(true);
    const over = await verifyQuotaAction(
      d1,
      "u1",
      { type: "add_source", notebookId: "nb3", byteSize: 20 * MB + 1 },
      quotas
    );
    expect(over.allowed).toBe(false);
    expect(over.code).toBe("QUOTA_MAX_USER_STORAGE_EXCEEDED");
    expect(over.reason).toContain("500");
    expect(over.reasonEn).toContain("500");
  });

  it("zählt Uploads eines Mitbearbeiters beim Eigentümer des Notebooks", async () => {
    const { d1, sqlite } = createDb();
    seedOwner(sqlite, "owner", ["nb1", "nb2", "nb3"]);
    seedOwner(sqlite, "editor", []);
    insertSource(sqlite, "a", "nb1", 190 * MB);
    insertSource(sqlite, "b", "nb2", 190 * MB);
    insertSource(sqlite, "c", "nb3", 120 * MB);
    const check = await verifyQuotaAction(
      d1,
      "editor",
      { type: "add_source", notebookId: "nb3", byteSize: 1 },
      quotas
    );
    expect(check.code).toBe("QUOTA_MAX_USER_STORAGE_EXCEEDED");
  });

  it("begrenzt Gäste auf 100 MB", async () => {
    const { d1, sqlite } = createDb();
    seedOwner(sqlite, "g1", ["nbg"], 1);
    insertSource(sqlite, "a", "nbg", 60 * MB);
    const ok = await verifyQuotaAction(
      d1,
      "g1",
      { type: "add_source", notebookId: "nbg", byteSize: 40 * MB },
      quotas
    );
    expect(ok.allowed).toBe(true);
    const denied = await verifyQuotaAction(
      d1,
      "g1",
      { type: "add_source", notebookId: "nbg", byteSize: 40 * MB + 1 },
      quotas
    );
    expect(denied.code).toBe("QUOTA_MAX_GUEST_STORAGE_EXCEEDED");
    expect(denied.reason).toContain("100");
  });

  it("prüft bei unbekanntem Notebook nur die übrigen Grenzen", async () => {
    const { d1, sqlite } = createDb();
    seedOwner(sqlite, "u1", []);
    const check = await verifyQuotaAction(
      d1,
      "u1",
      { type: "add_source", notebookId: "missing", byteSize: 10 },
      quotas
    );
    expect(check.allowed).toBe(true);
  });
});

describe("limitStream bricht beim Streamen ab", () => {
  function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        for (const p of parts) controller.enqueue(new TextEncoder().encode(p));
        controller.close();
      }
    });
  }

  it("reicht Daten bis zur Grenze durch", async () => {
    const text = await new Response(limitStream(streamOf("Hallo", " Welt"), 10)).text();
    expect(text).toBe("Hallo Welt");
  });

  it("wirft UploadTooLargeError ab dem ersten Byte zu viel", async () => {
    await expect(
      new Response(limitStream(streamOf("Hallo", " Welt!"), 10)).text()
    ).rejects.toBeInstanceOf(UploadTooLargeError);
  });
});

describe("Upload-Routen erzwingen die R2-Grenzen", () => {
  let db: ReturnType<typeof createDb>;
  let bucket: ReturnType<typeof createBucket>;
  let ragRepo: RagRepository;
  let env: Record<string, unknown>;
  let app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>;

  beforeEach(() => {
    db = createDb();
    bucket = createBucket();
    ragRepo = new RagRepository(db.adapter);
    seedOwner(db.sqlite, "u1", ["nb1"]);
    env = { DB: db.d1, MEDIA: bucket, APP_PROFILE: "demo", APP_ORIGIN: "http://localhost:8787" };
    app = new Hono();
    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: "u1" });
      c.env = env as unknown as Env;
      await next();
    });
    registerSourcesUploadRoutes(app, { coreRepo: {} as never, ragRepo });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function init(byteSize: number, lang?: string) {
    return app.request("/api/v1/notebooks/nb1/sources", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(lang ? { "Accept-Language": lang } : {})
      },
      body: JSON.stringify({ filename: "a.txt", mimeType: "text/plain", byteSize })
    });
  }

  it("antwortet 503 mit Retry-After, wenn das Tageslimit erreicht ist, und legt keine Quelle an", async () => {
    db.sqlite
      .prepare("INSERT INTO upload_daily (day, uploads, bytes) VALUES (?, ?, 0)")
      .run(new Date().toISOString().slice(0, 10), MAX_UPLOADS_PER_DAY);
    const res = await init(10);
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    const problem = (await res.json()) as { code: string; detail: string };
    expect(problem.code).toBe("UPLOAD_DAILY_LIMIT_REACHED");
    expect(problem.detail).toContain("UTC");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM sources").get()).toEqual({ n: 0 });

    const en = (await (await init(10, "en-GB")).json()) as { detail: string };
    expect(en.detail).toContain("daily upload limit");
  });

  it("antwortet 507, wenn der gesamte R2-Speicher erschöpft ist", async () => {
    insertSource(db.sqlite, "big", "nb1", R2_STORAGE_BUDGET_BYTES - 5);
    const res = await init(10);
    expect(res.status).toBe(507);
    const problem = (await res.json()) as { code: string };
    expect(problem.code).toBe("STORAGE_BUDGET_EXHAUSTED");
    const en = (await (await init(10, "en")).json()) as { detail: string };
    expect(en.detail).toContain("storage");
  });

  it("nutzt im Profil demo immer den Worker-Upload, auch wenn S3-Schlüssel gesetzt sind", async () => {
    env = {
      ...env,
      R2_ACCESS_KEY_ID: "k",
      R2_SECRET_ACCESS_KEY: "s",
      R2_BUCKET_NAME: "b",
      R2_ACCOUNT_ID: "a"
    };
    const res = await init(10);
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { mode: string };
    expect(payload.mode).toBe("worker-upload");
  });

  async function initSource(byteSize: number): Promise<{ sourceId: string; uploadUrl: string }> {
    return (await (await init(byteSize)).json()) as { sourceId: string; uploadUrl: string };
  }

  function bodyStream(text: string): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      }
    });
  }

  it("bricht ab, wenn der Body mehr Bytes liefert als Content-Length, und räumt das Objekt weg", async () => {
    const { sourceId, uploadUrl } = await initSource(12);
    const req = new Request(`http://localhost${uploadUrl}`, {
      method: "PUT",
      headers: { "Content-Type": "text/plain", "Content-Length": "5" },
      body: bodyStream("Hello World!"),
      duplex: "half"
    } as RequestInit);
    const res = await app.fetch(req, env as unknown as Env);
    expect(res.status).toBe(413);
    const problem = (await res.json()) as { code: string };
    expect(problem.code).toBe("UPLOAD_TOO_LARGE");
    const source = await ragRepo.getSourceById(sourceId);
    expect(source?.status).toBe("error");
    expect(bucket.store.size).toBe(0);
  });

  it("räumt das Objekt auch bei anderen Speicherfehlern weg und gibt den Fehler weiter", async () => {
    const { sourceId, uploadUrl } = await initSource(5);
    const failing = {
      ...bucket,
      put: async () => {
        throw new Error("R2 nicht erreichbar");
      }
    };
    env = { ...env, MEDIA: failing };
    const res = await app.request(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/plain", "Content-Length": "5" },
      body: new TextEncoder().encode("Hallo")
    });
    expect(res.status).toBe(500);
    const source = await ragRepo.getSourceById(sourceId);
    expect(source?.status).toBe("error");
  });

  it("gibt R2 eine feste Länge, wenn FixedLengthStream vorhanden ist (Workers-Laufzeit)", async () => {
    const seen: number[] = [];
    class FakeFixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
      constructor(length: number) {
        super();
        seen.push(length);
      }
    }
    vi.stubGlobal("FixedLengthStream", FakeFixedLengthStream);
    const { uploadUrl } = await initSource(5);
    const res = await app.request(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/plain", "Content-Length": "5" },
      body: new TextEncoder().encode("Hallo")
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual([5]);
  });

  it("lehnt beim Abschluss ein Objekt ab, das größer ist als angemeldet, und löscht es", async () => {
    const { sourceId } = await initSource(5);
    const source = await ragRepo.getSourceById(sourceId);
    // Simuliert einen direkten PUT (z. B. Presigned URL), der mehr als angemeldet schreibt
    await bucket.put(source?.r2_key as string, new TextEncoder().encode("Hallo Welt"));
    const res = await app.request(`/api/v1/sources/${sourceId}/upload/complete`, {
      method: "POST"
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe("UPLOAD_SIZE_MISMATCH");
    expect(bucket.store.has(source?.r2_key as string)).toBe(false);
    expect((await ragRepo.getSourceById(sourceId))?.status).toBe("error");
  });

  it("löscht das Objekt, wenn die Magic-Byte-Prüfung fehlschlägt", async () => {
    const { sourceId } = await initSource(4);
    const source = await ragRepo.getSourceById(sourceId);
    await bucket.put(source?.r2_key as string, new Uint8Array([0x4d, 0x5a, 0x00, 0x00]));
    const res = await app.request(`/api/v1/sources/${sourceId}/upload/complete`, {
      method: "POST"
    });
    expect(res.status).toBe(415);
    expect(bucket.store.has(source?.r2_key as string)).toBe(false);
  });
});

describe("Cron räumt abgebrochene Uploads und Gast-Dateien in R2 weg", () => {
  it("löscht Uploads, die länger als eine Stunde im Status uploading hängen, samt R2-Objekt", async () => {
    const { sqlite, adapter } = createDb();
    const bucket = createBucket();
    const now = Date.now();
    seedOwner(sqlite, "u1", ["nb1"]);
    insertSource(sqlite, "stale", "nb1", 100, {
      status: "uploading",
      createdAt: now - STALE_UPLOAD_MS - 1
    });
    insertSource(sqlite, "fresh", "nb1", 100, { status: "uploading", createdAt: now - 1000 });
    insertSource(sqlite, "old-ready", "nb1", 100, { createdAt: now - 10 * STALE_UPLOAD_MS });
    insertSource(sqlite, "stale-nokey", "nb1", 0, {
      r2Key: null,
      status: "uploading",
      createdAt: now - STALE_UPLOAD_MS - 1
    });
    for (const id of ["stale", "fresh", "old-ready"]) {
      bucket.store.set(`notebooks/nb1/sources/${id}.txt`, new Uint8Array([1]));
    }

    const metrics = await runScheduledCleanup({ db: adapter, mediaBucket: bucket, now });
    expect(metrics.deletedStaleUploads).toBe(2);
    const left = sqlite.prepare("SELECT id FROM sources ORDER BY id").all();
    expect(left).toEqual([{ id: "fresh" }, { id: "old-ready" }]);
    expect([...bucket.store.keys()].sort()).toEqual([
      "notebooks/nb1/sources/fresh.txt",
      "notebooks/nb1/sources/old-ready.txt"
    ]);
    expect(storedBytes(sqlite)).toBe(200);
  });

  it("räumt abgebrochene Uploads auch ohne R2-Binding aus D1", async () => {
    const { sqlite, adapter } = createDb();
    const now = Date.now();
    seedOwner(sqlite, "u1", ["nb1"]);
    insertSource(sqlite, "stale", "nb1", 100, {
      status: "uploading",
      createdAt: now - STALE_UPLOAD_MS - 1
    });
    const metrics = await runScheduledCleanup({ db: adapter, now });
    expect(metrics.deletedStaleUploads).toBe(1);
  });

  it("löscht beim Ablauf eines Gasts die hochgeladenen Quelldateien und gibt den Speicher frei", async () => {
    const { sqlite, adapter } = createDb();
    sqlite.exec("PRAGMA foreign_keys = ON");
    const bucket = createBucket();
    const now = Date.now();
    seedOwner(sqlite, "g1", ["nbg"], 1);
    sqlite.prepare("UPDATE users SET expires_at = ? WHERE id = 'g1'").run(now - 1);
    insertSource(sqlite, "s1", "nbg", 300);
    bucket.store.set("notebooks/nbg/sources/s1.txt", new Uint8Array([1]));

    const metrics = await runScheduledCleanup({ db: adapter, mediaBucket: bucket, now });
    expect(metrics.deletedGuests).toBe(1);
    expect(bucket.store.size).toBe(0);
    expect(storedBytes(sqlite)).toBe(0);
  });

  it("entfernt Tageszähler, die älter als sieben Tage sind", async () => {
    const { sqlite, adapter } = createDb();
    const now = Date.parse("2026-11-14T12:00:00Z");
    sqlite.exec(
      "INSERT INTO upload_daily (day, uploads, bytes) VALUES ('2026-11-06', 1, 1), ('2026-11-07', 1, 1), ('2026-11-14', 1, 1)"
    );
    await runScheduledCleanup({ db: adapter, now });
    expect(sqlite.prepare("SELECT day FROM upload_daily ORDER BY day").all()).toEqual([
      { day: "2026-11-07" },
      { day: "2026-11-14" }
    ]);
  });
});
