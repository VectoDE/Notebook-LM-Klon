import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACCOUNT_DELETE_CONFIRMATION, registerAccountRoutes } from "../account-routes.js";
import { CoreRepository } from "../core-repository.js";
import { createD1DatabaseAdapter } from "../d1-adapter.js";
import { createApp } from "../index.js";
import { createNodeEnv, runSqliteMigrations } from "../node-server.js";
import { clearRateLimitMemory } from "../rate-limiter.js";
import { SessionManager } from "../session.js";

const ORIGIN = "http://localhost:8787";
const TEST_SALT = "test-only-session-salt-account-routes";

/** In-memory R2 bucket with list/put/delete like the real binding. */
class MemoryBucket {
  readonly objects = new Map<string, string>();

  async put(key: string, value: string): Promise<void> {
    this.objects.set(key, value);
  }

  async list(options?: { prefix?: string; cursor?: string; limit?: number }) {
    const prefix = options?.prefix ?? "";
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix));
    return { objects: keys.map((key) => ({ key })), truncated: false };
  }

  async delete(keys: string[] | string): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.objects.delete(key);
    }
  }
}

/** Tables that hold rows belonging to a user or one of their notebooks. */
const USER_SCOPED_COUNTS: Record<string, string> = {
  users: "SELECT COUNT(*) AS n FROM users WHERE id = ?",
  passkeys: "SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?",
  sessions: "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?",
  quotas: "SELECT COUNT(*) AS n FROM quotas WHERE user_id = ?",
  workspaces: "SELECT COUNT(*) AS n FROM workspaces WHERE owner_id = ?",
  workspace_members: "SELECT COUNT(*) AS n FROM workspace_members WHERE user_id = ?",
  notebooks: "SELECT COUNT(*) AS n FROM notebooks WHERE created_by = ?",
  notebook_shares: "SELECT COUNT(*) AS n FROM notebook_shares WHERE user_id = ?",
  chats: "SELECT COUNT(*) AS n FROM chats WHERE user_id = ?",
  notes: "SELECT COUNT(*) AS n FROM notes WHERE user_id = ?",
  artifacts: "SELECT COUNT(*) AS n FROM artifacts WHERE user_id = ?",
  provider_keys: "SELECT COUNT(*) AS n FROM provider_keys WHERE user_id = ?",
  sources: "SELECT COUNT(*) AS n FROM sources WHERE notebook_id IN ('nb_alice', 'nb_alice_in_bob')",
  chunks: "SELECT COUNT(*) AS n FROM chunks WHERE notebook_id IN ('nb_alice', 'nb_alice_in_bob')",
  chunk_vectors:
    "SELECT COUNT(*) AS n FROM chunk_vectors WHERE notebook_id IN ('nb_alice', 'nb_alice_in_bob')",
  messages: "SELECT COUNT(*) AS n FROM messages WHERE chat_id = 'chat_alice'"
};

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  bucket: MemoryBucket;
  aliceCookie: string;
  bobCookie: string;
  dataDir: string;
}

async function seedUser(repo: CoreRepository, id: string, now: number): Promise<void> {
  await repo.createUser({
    id,
    email: `${id}@example.test`,
    display_name: id,
    locale: "de",
    is_guest: 0,
    created_at: now,
    expires_at: null,
    deleted_at: null
  });
}

async function createFixture(): Promise<Fixture> {
  const dataDir = mkdtempSync(join(tmpdir(), "account-routes-"));
  const sqlite = new DatabaseSync(":memory:");
  runSqliteMigrations(sqlite, resolve(process.cwd(), "apps/worker/migrations"));
  const { env: baseEnv } = createNodeEnv({ db: sqlite, dataDir, sessionSaltSecret: TEST_SALT });
  const bucket = new MemoryBucket();
  const env = Object.assign(baseEnv, { MEDIA: bucket }) as unknown as Env;
  const repo = new CoreRepository(createD1DatabaseAdapter(env.DB));
  const now = Date.now();

  await seedUser(repo, "alice", now);
  await seedUser(repo, "bob", now);

  // alice: own workspace + notebook, plus a notebook she created in bob's workspace
  await repo.createWorkspace({ id: "ws_alice", name: "A", owner_id: "alice", created_at: now });
  await repo.createWorkspace({ id: "ws_bob", name: "B", owner_id: "bob", created_at: now });
  for (const [id, ws, by] of [
    ["nb_alice", "ws_alice", "alice"],
    ["nb_alice_in_bob", "ws_bob", "alice"],
    ["nb_bob", "ws_bob", "bob"]
  ] as const) {
    await repo.createNotebook({
      id,
      workspace_id: ws,
      title: id,
      emoji: "",
      created_by: by,
      created_at: now,
      updated_at: now,
      expires_at: null
    });
  }
  const db = repo.db;
  await db.run(
    "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES ('ws_bob', 'alice', 'editor', ?)",
    [now]
  );
  await db.run(
    "INSERT INTO notebook_shares (notebook_id, user_id, role, created_at) VALUES ('nb_bob', 'alice', 'viewer', ?)",
    [now]
  );
  await db.run(
    "INSERT INTO passkeys (id, user_id, public_key, created_at) VALUES ('pk_alice', 'alice', x'00', ?)",
    [now]
  );
  await repo.setQuota({
    user_id: "alice",
    notebooks_count: 1,
    sources_count: 1,
    storage_bytes: 10,
    llm_calls_day: 0,
    quota_day: "2026-11-13"
  });
  for (const [src, nb] of [
    ["src_alice", "nb_alice"],
    ["src_bob", "nb_bob"]
  ] as const) {
    await db.run(
      `INSERT INTO sources (id, notebook_id, title, original_name, mime_type, source_type, r2_key, status, created_at, updated_at)
       VALUES (?, ?, 't', 'f.txt', 'text/plain', 'txt', ?, 'ready', ?, ?)`,
      [src, nb, `notebooks/${nb}/sources/${src}.txt`, now, now]
    );
    await db.run(
      `INSERT INTO chunks (id, source_id, notebook_id, chunk_index, text, created_at)
       VALUES (?, ?, ?, 0, 'geheimer Quelltext', ?)`,
      [`ch_${src}`, src, nb, now]
    );
    await db.run(
      `INSERT INTO chunk_vectors (chunk_id, notebook_id, model, dimensions, vector, created_at)
       VALUES (?, ?, 'm', 1, x'01', ?)`,
      [`ch_${src}`, nb, now]
    );
  }
  await db.run(
    "INSERT INTO chats (id, notebook_id, user_id, title, model_used, created_at, updated_at) VALUES ('chat_alice', 'nb_alice', 'alice', 'c', 'm', ?, ?)",
    [now, now]
  );
  await db.run(
    "INSERT INTO messages (id, chat_id, role, content, created_at) VALUES ('msg_alice', 'chat_alice', 'user', 'hallo', ?)",
    [now]
  );
  await db.run(
    "INSERT INTO notes (id, notebook_id, user_id, title, created_at, updated_at) VALUES ('note_alice', 'nb_bob', 'alice', 'n', ?, ?)",
    [now, now]
  );
  await db.run(
    "INSERT INTO artifacts (id, notebook_id, user_id, type, title, created_at, updated_at) VALUES ('art_alice', 'nb_bob', 'alice', 'summary', 'a', ?, ?)",
    [now, now]
  );
  await db.run(
    "INSERT INTO provider_keys (id, user_id, provider, encrypted_key, last4, created_at, updated_at) VALUES ('pkey_alice', 'alice', 'google', 'enc', '1234', ?, ?)",
    [now, now]
  );

  await bucket.put("users/alice/avatar.png", "a");
  await bucket.put("notebooks/nb_alice/sources/src_alice.txt", "a");
  await bucket.put("notebooks/nb_alice_in_bob/artifacts/x.json", "a");
  await bucket.put("notebooks/nb_bob/sources/src_bob.txt", "b");
  await bucket.put("users/bob/avatar.png", "b");

  const sessions = new SessionManager({ repo, saltSecret: TEST_SALT });
  const alice = await sessions.createSession("alice", null, null);
  const bob = await sessions.createSession("bob", null, null);

  return {
    env,
    sqlite,
    bucket,
    aliceCookie: `sid=${alice.rawToken}`,
    bobCookie: `sid=${bob.rawToken}`,
    dataDir
  };
}

function countFor(sqlite: DatabaseSync, sql: string, userId: string): number {
  const stmt = sqlite.prepare(sql);
  const params = sql.includes("?") ? [userId] : [];
  return Number((stmt.get(...params) as { n: number }).n);
}

describe("DELETE /api/v1/me (Löschkonzept #258)", () => {
  const app = createApp();
  let fx: Fixture;

  function deleteMe(cookie: string | undefined, body: string | undefined): Promise<Response> {
    const headers: Record<string, string> = { origin: ORIGIN, "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;
    const init: RequestInit = { method: "DELETE", headers };
    if (body !== undefined) init.body = body;
    return Promise.resolve(app.request(`${ORIGIN}/api/v1/me`, init, fx.env));
  }

  beforeEach(async () => {
    clearRateLimitMemory();
    fx = await createFixture();
  });

  afterEach(() => {
    fx.sqlite.close();
    rmSync(fx.dataDir, { recursive: true, force: true });
  });

  it("löscht alle D1-Datensätze und R2-Objekte des Kontos sofort und lässt fremde Daten stehen", async () => {
    for (const [table, sql] of Object.entries(USER_SCOPED_COUNTS)) {
      expect(countFor(fx.sqlite, sql, "alice"), `vorher ${table}`).toBeGreaterThan(0);
    }

    const res = await deleteMe(
      fx.aliceCookie,
      JSON.stringify({ confirm: ACCOUNT_DELETE_CONFIRMATION })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await res.json()).toEqual({
      deleted: true,
      deletedNotebooks: 2,
      deletedR2Objects: 3
    });

    for (const [table, sql] of Object.entries(USER_SCOPED_COUNTS)) {
      expect(countFor(fx.sqlite, sql, "alice"), `nachher ${table}`).toBe(0);
    }
    // FTS index has no orphaned rows for the deleted chunks
    const fts = fx.sqlite
      .prepare("SELECT COUNT(*) AS n FROM chunks_fts WHERE chunks_fts MATCH 'geheimer'")
      .get() as { n: number };
    expect(Number(fts.n)).toBe(1);

    expect([...fx.bucket.objects.keys()].sort()).toEqual([
      "notebooks/nb_bob/sources/src_bob.txt",
      "users/bob/avatar.png"
    ]);

    // bob keeps workspace, notebook, source and session
    expect(countFor(fx.sqlite, USER_SCOPED_COUNTS.users as string, "bob")).toBe(1);
    expect(countFor(fx.sqlite, USER_SCOPED_COUNTS.workspaces as string, "bob")).toBe(1);
    expect(countFor(fx.sqlite, USER_SCOPED_COUNTS.notebooks as string, "bob")).toBe(1);
    expect(countFor(fx.sqlite, USER_SCOPED_COUNTS.sessions as string, "bob")).toBe(1);
    const bobSources = fx.sqlite
      .prepare("SELECT COUNT(*) AS n FROM sources WHERE notebook_id = 'nb_bob'")
      .get() as { n: number };
    expect(Number(bobSources.n)).toBe(1);

    // the old session cookie no longer authenticates
    const again = await deleteMe(
      fx.aliceCookie,
      JSON.stringify({ confirm: ACCOUNT_DELETE_CONFIRMATION })
    );
    expect(again.status).toBe(401);
  });

  it("verlangt die ausdrückliche Bestätigung und löscht ohne sie nichts", async () => {
    for (const body of [undefined, "kein json", JSON.stringify({ confirm: true }), "null"]) {
      const res = await deleteMe(fx.aliceCookie, body);
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toContain("application/problem+json");
      expect(((await res.json()) as { code: string }).code).toBe("CONFIRMATION_REQUIRED");
    }
    expect(countFor(fx.sqlite, USER_SCOPED_COUNTS.users as string, "alice")).toBe(1);
    expect(fx.bucket.objects.size).toBe(5);
  });

  it("lehnt Anfragen ohne Sitzung mit 401 ab", async () => {
    const res = await deleteMe(undefined, JSON.stringify({ confirm: ACCOUNT_DELETE_CONFIRMATION }));
    expect(res.status).toBe(401);
    expect(countFor(fx.sqlite, USER_SCOPED_COUNTS.users as string, "alice")).toBe(1);
  });

  it("löscht die D1-Daten auch ohne R2-Bindung und setzt in Produktion das __Host-Cookie zurück", async () => {
    const plain = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    plain.use("*", async (c, next) => {
      c.set("sessionUser", { id: "alice" });
      await next();
    });
    const repo = new CoreRepository(createD1DatabaseAdapter(fx.env.DB));
    registerAccountRoutes(plain, { coreRepo: repo, isProduction: true });
    const envWithoutMedia = { ...fx.env, MEDIA: undefined } as unknown as Env;

    const res = await plain.request(
      "/api/v1/me",
      { method: "DELETE", body: JSON.stringify({ confirm: ACCOUNT_DELETE_CONFIRMATION }) },
      envWithoutMedia
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("__Host-sid=;");
    expect(((await res.json()) as { deletedR2Objects: number }).deletedR2Objects).toBe(0);
    expect(countFor(fx.sqlite, USER_SCOPED_COUNTS.users as string, "alice")).toBe(0);
  });

  it("prüft die Sitzung auch im Handler selbst (Verteidigung in der Tiefe)", async () => {
    const plain = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    const repo = new CoreRepository(createD1DatabaseAdapter(fx.env.DB));
    registerAccountRoutes(plain, { coreRepo: repo, isProduction: false });

    const res = await plain.request("/api/v1/me", { method: "DELETE" }, fx.env);

    expect(res.status).toBe(401);
    expect(countFor(fx.sqlite, USER_SCOPED_COUNTS.users as string, "alice")).toBe(1);
  });
});
