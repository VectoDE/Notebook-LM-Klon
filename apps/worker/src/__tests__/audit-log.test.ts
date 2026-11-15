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
  AUDIT_PURGE_CHUNK,
  AUDIT_PURGE_MAX_CHUNKS,
  AUDIT_RETRY_PREFIX,
  AuditLogger,
  purgeExpiredAuditEntries,
  replayPendingAuditEntries
} from "../audit-log.js";
import { registerChunkIngestionRoutes } from "../chunk-ingestion.js";
import {
  type BatchStatement,
  type MinimalR2Bucket,
  purgeUsers,
  runScheduledCleanup
} from "../cleanup.js";
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
    },
    async execBatch(statements: BatchStatement[]) {
      sqlite.exec("BEGIN");
      try {
        for (const statement of statements) {
          sqlite.prepare(statement.sql).run(...(statement.params as (string | number | null)[]));
        }
        sqlite.exec("COMMIT");
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
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
        await recordVia(logger, { userId: null, action: "source.delete", target: "nb:n1" })
      ).toBe(true);
    }
    const withSalt = new AuditLogger({ repo, saltSecret: SALT });
    expect(
      await recordVia(withSalt, { userId: null, action: "account.delete", target: "nb:n1" }, false)
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
    expect(await recordVia(logger, { userId: null, action: "source.delete", target: "nb:n1" })).toBe(
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
      await recordVia(logger2, { userId: null, action: "source.delete", target: "nb:n1" })
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
      ["auth.login.guest", guestId, "user:self"],
      ["auth.login.magic_link", "alice", "user:self"]
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

  it("hinterlässt nach der Kontolöschung keine Konto-ID in audit_log, auch nicht aus Altzeilen", async () => {
    // Altzeile aus der Zeit, als das Ziel noch user:<id> war
    await repo.logAudit({
      id: "legacy",
      user_id: "alice",
      action: "auth.login.passkey",
      target: "user:alice",
      ip_hash: "-",
      created_at: Date.now()
    });
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
    expect(auditRows(sqlite).map((r) => r.target)).toEqual(["user:alice", "user:self"]);

    await purgeUsers(repo.db, null, ["alice"]);

    const rows = auditRows(sqlite);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.user_id === null)).toBe(true);
    expect(rows.map((r) => r.target)).toEqual(["user:deleted", "user:deleted"]);
    expect(JSON.stringify(rows)).not.toContain("alice");
  });

  it("setzt die 90-Tage-Löschung auch durch, wenn die Kontolöschung im Cron scheitert", async () => {
    const now = 10 * AUDIT_RETENTION_MS;
    await repo.createUser({
      id: "guest_old",
      email: null,
      display_name: "Gast",
      locale: "de",
      is_guest: 1,
      created_at: now - 1000,
      expires_at: now - 1,
      deleted_at: null
    });
    await repo.logAudit({
      id: "old",
      user_id: null,
      action: "auth.login.guest",
      target: "user:self",
      ip_hash: "-",
      created_at: now - AUDIT_RETENTION_MS - 1
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: DatabaseAdapter = {
      ...repo.db,
      execBatch: async () => {
        throw new Error("D1 nicht erreichbar");
      }
    };

    const metrics = await runScheduledCleanup({ db: broken, now });

    expect(metrics.failedSteps).toBe(1);
    expect(metrics.deletedGuests).toBe(0);
    expect(metrics.deletedAuditEntries).toBe(1);
    expect(auditRows(sqlite)).toHaveLength(0);
    expect(errors).toHaveBeenCalled();
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
      // Gastkonto: braucht für die Kontolöschung keine frische Anmeldung (siehe account-routes.test.ts)
      c.set("sessionUser", { id: "alice", isGuest: true } as { id: string });
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
      ["account.delete", null, "user:deleted"]
    ]);
    const dump = JSON.stringify(rows);
    // Die Konto-ID steht in keiner Spalte, weder als user_id noch im Ziel
    expect(dump).not.toContain("alice");
    for (const content of ["Vertrag", "vertraulicher Inhalt", "Geheimes Projekt", CLIENT_IP]) {
      expect(dump).not.toContain(content);
    }
  });
});

describe("Audit: Nachlauf bei Schreibfehler und Aufbewahrung in Blöcken", () => {
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

  async function critical(logger: AuditLogger, event: AuditEvent) {
    const app = new Hono();
    app.post("/x", async (c) => c.json({ result: await logger.recordCritical(c, event) }));
    const res = await app.fetch(requestFromClient("http://localhost/x", { method: "POST" }));
    return ((await res.json()) as { result: string }).result;
  }

  function queued(): string[] {
    return (
      sqlite.prepare("SELECT prefix FROM pending_r2_purge ORDER BY prefix").all() as {
        prefix: string;
      }[]
    ).map((row) => row.prefix);
  }

  const DELETE_EVENT: AuditEvent = { userId: null, action: "account.delete", target: "user:deleted" };

  it("schreibt kritische Einträge direkt, wenn die Datenbank erreichbar ist", async () => {
    const logger = new AuditLogger({ repo, saltSecret: SALT, now: () => 5_000 });
    expect(await critical(logger, DELETE_EVENT)).toBe("written");
    expect(auditRows(sqlite).map((r) => [r.action, r.target, r.created_at])).toEqual([
      ["account.delete", "user:deleted", 5_000]
    ]);
    expect(queued()).toEqual([]);
  });

  it("verwirft unzulässige Ziele auch bei kritischen Einträgen", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new AuditLogger({ repo, saltSecret: SALT });
    expect(
      await critical(logger, { userId: null, action: "account.delete", target: "Freitext hier" })
    ).toBe("lost");
    expect(auditRows(sqlite)).toHaveLength(0);
    expect(queued()).toEqual([]);
    expect(String(errors.mock.calls[0]?.[0])).toContain("audit_log_rejected");
  });

  it("legt einen fehlgeschlagenen Eintrag in den Nachlauf und schreibt ihn später mit Originalzeit", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new AuditLogger({ repo, saltSecret: SALT, now: () => 5_000 });
    const write = vi.spyOn(repo, "logAudit");
    write.mockRejectedValueOnce(new Error("D1 nicht erreichbar"));
    write.mockRejectedValueOnce("kaputt");

    expect(await critical(logger, DELETE_EVENT)).toBe("queued");
    expect(await critical(logger, { ...DELETE_EVENT, target: "user:gone" })).toBe("queued");

    expect(errors.mock.calls.map((call) => JSON.parse(String(call[0])).event)).toEqual([
      "audit_log_critical_failed",
      "audit_log_retry_queued",
      "audit_log_critical_failed",
      "audit_log_retry_queued"
    ]);
    expect(String(errors.mock.calls[0]?.[0])).toContain("D1 nicht erreichbar");
    expect(String(errors.mock.calls[2]?.[0])).toContain("kaputt");
    expect(auditRows(sqlite)).toHaveLength(0);
    const keys = queued();
    expect(keys).toHaveLength(2);
    expect(keys.every((key) => key.startsWith(`${AUDIT_RETRY_PREFIX}5000:`))).toBe(true);
    expect(keys.join()).not.toContain("alice");

    expect(await replayPendingAuditEntries(repo.db)).toBe(2);
    expect(
      auditRows(sqlite).map((r) => [r.action, r.user_id, r.target, r.created_at]).sort()
    ).toEqual([
      ["account.delete", null, "user:deleted", 5_000],
      ["account.delete", null, "user:gone", 5_000]
    ]);
    expect(queued()).toEqual([]);
    expect(await replayPendingAuditEntries(repo.db)).toBe(0);
  });

  it("meldet den Verlust, wenn auch der Nachlauf nicht geschrieben werden kann", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const failure of [new Error("D1 tot"), "tot"]) {
      const deadDb: DatabaseAdapter = {
        ...repo.db,
        run: async () => {
          throw failure;
        }
      };
      const logger = new AuditLogger({ repo: new CoreRepository(deadDb), saltSecret: SALT });
      expect(await critical(logger, DELETE_EVENT)).toBe("lost");
    }
    const events = errors.mock.calls.map((call) => JSON.parse(String(call[0])));
    expect(events.map((e) => e.event)).toEqual([
      "audit_log_critical_failed",
      "audit_log_lost",
      "audit_log_critical_failed",
      "audit_log_lost"
    ]);
    expect(events[1].message).toBe("D1 tot");
    expect(events[3].message).toBe("tot");
  });

  it("verwirft ungültige Nachlauf-Einträge mit Logzeile und schreibt gültige", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const hash = "a".repeat(64);
    const keys = [
      `${AUDIT_RETRY_PREFIX}abc:-:account.delete:user:deleted`,
      `${AUDIT_RETRY_PREFIX}5`,
      `${AUDIT_RETRY_PREFIX}5:-`,
      `${AUDIT_RETRY_PREFIX}5:nicht-hex:account.delete:user:deleted`,
      `${AUDIT_RETRY_PREFIX}5:-:unbekannt.aktion:user:deleted`,
      `${AUDIT_RETRY_PREFIX}5:-:account.delete:Freitext mit Leerzeichen`,
      `${AUDIT_RETRY_PREFIX}7:${hash}:source.delete:source:src_9`,
      `${AUDIT_RETRY_PREFIX}8:-:account.delete:user:deleted`
    ];
    for (const key of keys) {
      await repo.db.run("INSERT INTO pending_r2_purge (prefix, created_at) VALUES (?, ?)", [key, 1]);
    }

    expect(await replayPendingAuditEntries(repo.db)).toBe(2);

    expect(errors).toHaveBeenCalledTimes(6);
    expect(
      auditRows(sqlite)
        .map((r) => [r.created_at, r.ip_hash, r.action, r.target])
        .sort()
    ).toEqual([
      [7, hash, "source.delete", "source:src_9"],
      [8, "-", "account.delete", "user:deleted"]
    ]);
    expect(queued()).toEqual([]);
  });

  it("der Cron schreibt Nachlauf-Einträge, fasst sie nicht als R2-Präfix an und behält sie bei Fehlern", async () => {
    const key = `${AUDIT_RETRY_PREFIX}9:-:account.delete:user:deleted`;
    await repo.db.run("INSERT INTO pending_r2_purge (prefix, created_at) VALUES (?, ?)", [key, 1]);
    const listed: string[] = [];
    const bucket: MinimalR2Bucket = {
      list: async (options) => {
        listed.push(options?.prefix ?? "");
        return { objects: [], truncated: false };
      },
      delete: async () => {}
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const failingWrites: DatabaseAdapter = {
      ...repo.db,
      run: async (sql, params) => {
        if (sql.includes("INSERT OR IGNORE INTO audit_log")) {
          throw new Error("D1 schreibt nicht");
        }
        return repo.db.run(sql, params);
      }
    };

    const failed = await runScheduledCleanup({ db: failingWrites, mediaBucket: bucket, now: 100 });
    expect(failed.failedSteps).toBe(1);
    expect(queued()).toEqual([key]);
    expect(listed).toEqual([]);
    expect(errors).toHaveBeenCalled();

    const ok = await runScheduledCleanup({ db: repo.db, mediaBucket: bucket, now: 100 });
    expect(ok.failedSteps).toBe(0);
    expect(queued()).toEqual([]);
    expect(auditRows(sqlite).map((r) => [r.created_at, r.action, r.target])).toEqual([
      [9, "account.delete", "user:deleted"]
    ]);
    expect(listed).toEqual([]);
  });

  it("DELETE /api/v1/me läuft auch bei Audit-Schreibfehler durch und holt den Eintrag nach", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = new AuditLogger({ repo, saltSecret: SALT, now: () => 6_000 });
    vi.spyOn(repo, "logAudit").mockRejectedValueOnce(new Error("D1 nicht erreichbar"));

    type Vars = { Bindings: Env; Variables: { sessionUser?: { id: string } } };
    const app = new Hono<Vars>();
    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: "alice", isGuest: true } as { id: string });
      await next();
    });
    registerAccountRoutes(app, { coreRepo: repo, isProduction: false, auditLogger: logger });

    const res = await app.fetch(
      requestFromClient("http://localhost/api/v1/me", {
        method: "DELETE",
        body: JSON.stringify({ confirm: ACCOUNT_DELETE_CONFIRMATION })
      }),
      {} as Env
    );

    expect(res.status).toBe(200);
    expect(await repo.getUserById("alice")).toBeNull();
    expect(auditRows(sqlite)).toHaveLength(0);
    expect(queued()).toHaveLength(1);

    await runScheduledCleanup({ db: repo.db, now: 6_000 });
    expect(auditRows(sqlite).map((r) => [r.action, r.user_id, r.target, r.created_at])).toEqual([
      ["account.delete", null, "user:deleted", 6_000]
    ]);
    expect(queued()).toEqual([]);
  });

  function bulkInsert(count: number) {
    sqlite
      .prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
         INSERT INTO audit_log (id, user_id, action, target, ip_hash, created_at)
         SELECT 'bulk_' || i, NULL, 'auth.login.guest', 'user:self', '-', 1 FROM n`
      )
      .run(count);
  }

  function auditCount(): number {
    return (sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
  }

  it("löscht große Bestände in Blöcken von höchstens 1000 Zeilen", async () => {
    expect(AUDIT_PURGE_CHUNK).toBe(1000);
    const statements: string[] = [];
    const spy: DatabaseAdapter = {
      ...repo.db,
      run: async (sql, params) => {
        statements.push(sql);
        return repo.db.run(sql, params);
      }
    };
    bulkInsert(2500);

    expect(await purgeExpiredAuditEntries(spy, 2 * AUDIT_RETENTION_MS)).toBe(2500);

    expect(auditCount()).toBe(0);
    expect(statements).toHaveLength(3);
    expect(statements.every((sql) => sql.includes("LIMIT ?"))).toBe(true);
  });

  it("begrenzt die Blöcke je Lauf und arbeitet den Rest im nächsten Lauf ab", async () => {
    const total = AUDIT_PURGE_CHUNK * AUDIT_PURGE_MAX_CHUNKS + 7;
    bulkInsert(total);

    expect(await purgeExpiredAuditEntries(repo.db, 2 * AUDIT_RETENTION_MS)).toBe(
      AUDIT_PURGE_CHUNK * AUDIT_PURGE_MAX_CHUNKS
    );
    expect(auditCount()).toBe(7);
    expect(await purgeExpiredAuditEntries(repo.db, 2 * AUDIT_RETENTION_MS)).toBe(7);
    expect(auditCount()).toBe(0);
  });
});
