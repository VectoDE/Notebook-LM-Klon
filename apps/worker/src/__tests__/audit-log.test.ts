import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_DELETE_CONFIRMATION, registerAccountRoutes } from "../account-routes.js";
import {
  AUDIT_NO_IP_HASH,
  AUDIT_RETENTION_DAYS,
  AUDIT_RETENTION_MS,
  type AuditEvent,
  AuditLogger,
  purgeExpiredAuditEntries
} from "../audit-log.js";
import { registerChunkIngestionRoutes } from "../chunk-ingestion.js";
import { runScheduledCleanup } from "../cleanup.js";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import { createGuestAndMagicLinkRoutes } from "../guest-magic-link-routes.js";
import { ConsoleMailAdapter } from "../mail-adapter.js";
import { runSqliteMigrations } from "../node-server.js";
import { createPasskeyRoutes } from "../passkey-routes.js";
import type { PasskeyService } from "../passkey-service.js";
import { RagRepository } from "../rag-repository.js";
import { registerSocketAddress } from "../rate-limiter.js";
import { SessionManager, sha256Hex } from "../session.js";
import { TURNSTILE_TEST_SECRET_ALWAYS_PASSES } from "../turnstile.js";

const SALT = "audit-test-salt";
const CLIENT_IP = "203.0.113.77";

type AuditRow = {
  id: string;
  user_id: string | null;
  action: string;
  target: string;
  ip_hash: string;
  created_at: number;
};

function createDb(): { sqlite: DatabaseSync; adapter: DatabaseAdapter } {
  const sqlite = new DatabaseSync(":memory:");
  runSqliteMigrations(sqlite, resolve(process.cwd(), "apps/worker/migrations"));
  const adapter: DatabaseAdapter = {
    async exec(sql) {
      sqlite.exec(sql);
    },
    async query<T>(sql: string, params: unknown[] = []) {
      return sqlite.prepare(sql).all(...(params as (string | number | null)[])) as T[];
    },
    async queryOne<T>(sql: string, params: unknown[] = []) {
      return (sqlite.prepare(sql).get(...(params as (string | number | null)[])) as T) ?? null;
    },
    async run(sql: string, params: unknown[] = []) {
      const info = sqlite.prepare(sql).run(...(params as (string | number | null)[]));
      return { changes: Number(info.changes) };
    }
  };
  return { sqlite, adapter };
}

function auditRows(sqlite: DatabaseSync): AuditRow[] {
  return sqlite.prepare("SELECT * FROM audit_log ORDER BY rowid").all() as AuditRow[];
}

async function seedUser(repo: CoreRepository, id: string, email: string | null = null) {
  await repo.createUser({
    id,
    email,
    display_name: id,
    locale: "de",
    is_guest: 0,
    created_at: Date.now(),
    expires_at: null,
    deleted_at: null
  });
}

/** Request whose client IP is known to the worker (as the Node server registers it). */
function requestFromClient(url: string, init: RequestInit = {}): Request {
  const request = new Request(url, init);
  registerSocketAddress(request, CLIENT_IP);
  return request;
}

describe("AuditLogger (Issue #259)", () => {
  let sqlite: DatabaseSync;
  let repo: CoreRepository;

  beforeEach(async () => {
    const db = createDb();
    sqlite = db.sqlite;
    repo = new CoreRepository(db.adapter);
    await seedUser(repo, "alice");
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
  });

  async function recordVia(logger: AuditLogger, event: AuditEvent, withIp = true) {
    const app = new Hono();
    app.post("/x", async (c) => c.json({ ok: await logger.record(c, event) }));
    const request = withIp
      ? requestFromClient("http://localhost/x", { method: "POST" })
      : new Request("http://localhost/x", { method: "POST" });
    return ((await (await app.fetch(request)).json()) as { ok: boolean }).ok;
  }

  it("speichert die IP nur als gesalzenen Tageshash, nie im Klartext", async () => {
    const logger = new AuditLogger({ repo, saltSecret: SALT, now: () => 1_000 });
    const ok = await recordVia(logger, {
      userId: "alice",
      action: "auth.login.passkey",
      target: "user:alice"
    });

    expect(ok).toBe(true);
    const [row] = auditRows(sqlite);
    const day = new Date().toISOString().slice(0, 10);
    expect(row).toMatchObject({
      user_id: "alice",
      action: "auth.login.passkey",
      target: "user:alice",
      created_at: 1_000,
      ip_hash: await sha256Hex(`${day}:audit:${SALT}:${CLIENT_IP}`)
    });
    expect(row?.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(auditRows(sqlite))).not.toContain(CLIENT_IP);
    expect(row?.id).toMatch(/^aud_/);
  });

  it("speichert ohne Salz oder ohne bekannte IP keinen Hash", async () => {
    for (const saltSecret of [undefined, "   "]) {
      const logger = new AuditLogger({ repo, saltSecret });
      expect(
        await recordVia(logger, { userId: null, action: "share.create", target: "nb:n1" })
      ).toBe(true);
    }
    const withSalt = new AuditLogger({ repo, saltSecret: SALT });
    expect(
      await recordVia(withSalt, { userId: null, action: "export.create", target: "nb:n1" }, false)
    ).toBe(true);

    const rows = auditRows(sqlite);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.ip_hash).toBe(AUDIT_NO_IP_HASH);
      expect(row.created_at).toBeGreaterThan(0);
    }
  });

  it("weist Ziele mit Freitext oder Inhalten ab und schreibt dann nichts", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new AuditLogger({ repo, saltSecret: SALT });
    for (const target of [
      "source:Vertrag mit Kunde.pdf",
      "geheimer Quelltext",
      "user:alice@example.test",
      `source:${"x".repeat(129)}`,
      ""
    ]) {
      expect(await recordVia(logger, { userId: "alice", action: "source.delete", target })).toBe(
        false
      );
    }
    expect(auditRows(sqlite)).toHaveLength(0);
    expect(errors).toHaveBeenCalledTimes(5);
    expect(String(errors.mock.calls[0]?.[0])).not.toContain("Vertrag");
  });

  it("lässt die auslösende Anfrage nicht scheitern, wenn das Schreiben fehlschlägt", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = new CoreRepository({
      exec: async () => {},
      query: async () => [],
      queryOne: async () => null,
      run: async () => {
        throw new Error("D1 nicht erreichbar");
      }
    });
    const logger = new AuditLogger({ repo: failing, saltSecret: SALT });
    expect(await recordVia(logger, { userId: null, action: "share.revoke", target: "nb:n1" })).toBe(
      false
    );

    const throwsString = new CoreRepository({
      exec: async () => {},
      query: async () => [],
      queryOne: async () => null,
      run: async () => {
        throw "kaputt";
      }
    });
    const logger2 = new AuditLogger({ repo: throwsString, saltSecret: SALT });
    expect(
      await recordVia(logger2, { userId: null, action: "share.revoke", target: "nb:n1" })
    ).toBe(false);
    expect(String(errors.mock.calls[0]?.[0])).toContain("D1 nicht erreichbar");
    expect(String(errors.mock.calls[1]?.[0])).toContain("kaputt");
  });

  it("löscht Einträge nach Ablauf der Aufbewahrungsfrist, auch per Cron", async () => {
    expect(AUDIT_RETENTION_DAYS).toBe(90);
    const now = 10 * AUDIT_RETENTION_MS;
    for (const [id, age] of [
      ["old", AUDIT_RETENTION_MS + 1],
      ["edge", AUDIT_RETENTION_MS],
      ["fresh", 1_000]
    ] as const) {
      await repo.logAudit({
        id,
        user_id: null,
        action: "auth.login.guest",
        target: "user:x",
        ip_hash: "-",
        created_at: now - age
      });
    }

    expect(await purgeExpiredAuditEntries(repo.db, now)).toBe(1);
    expect(auditRows(sqlite).map((r) => r.id)).toEqual(["edge", "fresh"]);

    const metrics = await runScheduledCleanup({ db: repo.db, now: now + AUDIT_RETENTION_MS });
    expect(metrics.deletedAuditEntries).toBe(2);
    expect(auditRows(sqlite)).toHaveLength(0);
  });
});

describe("Audit-Ereignisse an den Routen (Issue #259)", () => {
  let sqlite: DatabaseSync;
  let repo: CoreRepository;
  let logger: AuditLogger;
  let sessions: SessionManager;

  beforeEach(async () => {
    const db = createDb();
    sqlite = db.sqlite;
    repo = new CoreRepository(db.adapter);
    logger = new AuditLogger({ repo, saltSecret: SALT });
    sessions = new SessionManager({ repo, saltSecret: SALT });
    await seedUser(repo, "alice", "alice@example.test");
  });

  afterEach(() => {
    sqlite.close();
  });

  it("protokolliert Gast-Login und Magic-Link-Login", async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.route(
      "/api/v1/auth",
      createGuestAndMagicLinkRoutes({
        repo,
        sessionManager: sessions,
        mailAdapter: new ConsoleMailAdapter(),
        appBaseUrl: "http://localhost",
        turnstileSecretKey: TURNSTILE_TEST_SECRET_ALWAYS_PASSES,
        customFetch: (async () =>
          new Response(JSON.stringify({ success: true }), {
            headers: { "content-type": "application/json" }
          })) as unknown as typeof fetch,
        auditLogger: logger
      })
    );

    const guest = await app.fetch(
      requestFromClient("http://localhost/api/v1/auth/guest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turnstileToken: "t", locale: "de" })
      })
    );
    expect(guest.status).toBe(201);
    const guestId = ((await guest.json()) as { user: { id: string } }).user.id;

    const rawToken = "magic-token-audit-test";
    await repo.db.run(
      "INSERT INTO magic_links (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)",
      [await sha256Hex(rawToken), "alice@example.test", Date.now(), Date.now() + 60_000]
    );
    const magic = await app.fetch(
      requestFromClient(`http://localhost/api/v1/auth/magic-link/callback?token=${rawToken}`)
    );
    expect(magic.status).toBe(200);

    const rows = auditRows(sqlite);
    expect(rows.map((r) => [r.action, r.user_id, r.target])).toEqual([
      ["auth.login.guest", guestId, `user:${guestId}`],
      ["auth.login.magic_link", "alice", "user:alice"]
    ]);
    // no e-mail address, no token, no plain IP in the log
    const dump = JSON.stringify(rows);
    for (const secret of ["alice@example.test", rawToken, CLIENT_IP]) {
      expect(dump).not.toContain(secret);
    }
  });

  it("protokolliert den Passkey-Login", async () => {
    const user = await repo.getUserById("alice");
    const passkeyService = {
      verifyLogin: async () => ({ verified: true, user, signCountUpdated: true })
    } as unknown as PasskeyService;
    const app = new Hono<{ Bindings: Env }>();
    app.route(
      "/api/v1/auth/passkey",
      createPasskeyRoutes({ repo, passkeyService, sessionManager: sessions, auditLogger: logger })
    );

    const res = await app.fetch(
      requestFromClient("http://localhost/api/v1/auth/passkey/login/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "cred", response: {} })
      })
    );

    expect(res.status).toBe(200);
    expect(auditRows(sqlite).map((r) => [r.action, r.user_id])).toEqual([
      ["auth.login.passkey", "alice"]
    ]);
  });

  it("protokolliert Quellen- und Kontolöschung ohne Quelleninhalte", async () => {
    const now = Date.now();
    await repo.createWorkspace({ id: "ws", name: "W", owner_id: "alice", created_at: now });
    await repo.createNotebook({
      id: "nb",
      workspace_id: "ws",
      title: "Geheimes Projekt",
      emoji: "",
      created_by: "alice",
      created_at: now,
      updated_at: now,
      expires_at: null
    });
    for (const id of ["src_1", "src_2"]) {
      await repo.db.run(
        `INSERT INTO sources (id, notebook_id, title, original_name, mime_type, source_type, status, created_at, updated_at)
         VALUES (?, 'nb', 'Vertrag', 'vertrag.pdf', 'application/pdf', 'pdf', 'ready', ?, ?)`,
        [id, now, now]
      );
      await repo.db.run(
        "INSERT INTO chunks (id, source_id, notebook_id, chunk_index, text, created_at) VALUES (?, ?, 'nb', 0, 'vertraulicher Inhalt', ?)",
        [`ch_${id}`, id, now]
      );
    }

    type Vars = { Bindings: Env; Variables: { sessionUser?: { id: string } } };
    const ragRepo = new RagRepository(repo.db);
    const env = {} as Env;

    const withSession = new Hono<Vars>();
    withSession.use("*", async (c, next) => {
      c.set("sessionUser", { id: "alice" });
      await next();
    });
    registerChunkIngestionRoutes(withSession, { ragRepo, coreRepo: repo, auditLogger: logger });
    registerAccountRoutes(withSession, {
      coreRepo: repo,
      isProduction: false,
      auditLogger: logger
    });

    for (const id of ["src_1", "src_2"]) {
      const del = await withSession.fetch(
        requestFromClient(`http://localhost/api/v1/sources/${id}`, { method: "DELETE" }),
        env
      );
      expect(del.status).toBe(200);
    }
    const delMe = await withSession.fetch(
      requestFromClient("http://localhost/api/v1/me", {
        method: "DELETE",
        body: JSON.stringify({ confirm: ACCOUNT_DELETE_CONFIRMATION })
      }),
      env
    );
    expect(delMe.status).toBe(200);

    const rows = auditRows(sqlite);
    expect(rows.map((r) => [r.action, r.user_id, r.target])).toEqual([
      // alice's own row lost its user_id when the account was deleted (ON DELETE SET NULL)
      ["source.delete", null, "source:src_1"],
      ["source.delete", null, "source:src_2"],
      ["account.delete", null, "user:alice"]
    ]);
    const dump = JSON.stringify(rows);
    for (const content of ["Vertrag", "vertraulicher Inhalt", "Geheimes Projekt", CLIENT_IP]) {
      expect(dump).not.toContain(content);
    }
  });
});
