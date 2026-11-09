import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  csrfProtection,
  requireAuth,
  requireNotebookRole,
  requireWorkspaceRole,
  sessionMiddleware
} from "../auth-middleware.js";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import {
  DEV_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  SessionManager,
  buildClearSessionCookie,
  buildSessionCookie,
  computeDailySaltedHash,
  extractSessionToken,
  generateSessionToken,
  sha256Hex
} from "../session.js";

function createSqliteAdapter(): { adapter: DatabaseAdapter; close: () => void } {
  const db = new DatabaseSync(":memory:");
  const migrationPath = resolve(process.cwd(), "apps/worker/migrations/0001_initial_core.sql");
  const sql = readFileSync(migrationPath, "utf-8");
  db.exec(sql);

  const adapter: DatabaseAdapter = {
    async exec(sqlStr: string): Promise<void> {
      db.exec(sqlStr);
    },
    async query<T>(sqlStr: string, params: unknown[] = []): Promise<T[]> {
      const stmt = db.prepare(sqlStr);
      return stmt.all(...(params as (string | number | bigint | null)[])) as T[];
    },
    async queryOne<T>(sqlStr: string, params: unknown[] = []): Promise<T | null> {
      const stmt = db.prepare(sqlStr);
      const row = stmt.get(...(params as (string | number | bigint | null)[]));
      return (row as T) ?? null;
    },
    async run(sqlStr: string, params: unknown[] = []): Promise<{ changes: number }> {
      const stmt = db.prepare(sqlStr);
      const info = stmt.run(...(params as (string | number | bigint | null)[]));
      return { changes: Number(info.changes) };
    }
  };

  return { adapter, close: () => db.close() };
}

describe("Session Management, Cookies & Privacy Hashing (Sub-Issue #65)", () => {
  it("generates opaque tokens and verifies SHA-256 hashing", async () => {
    const token = generateSessionToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThanOrEqual(40);

    const hash1 = await sha256Hex(token);
    const hash2 = await sha256Hex(new TextEncoder().encode(token));
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);
  });

  it("hashes IP addresses and User-Agents with daily salt and handles empty values", async () => {
    const saltSecret = "test-salt-secret-01";
    const ip = "192.168.1.100";
    const ua = "Mozilla/5.0 TestBrowser";

    const ipHashDay1 = await computeDailySaltedHash(ip, saltSecret, "2026-11-09");
    const ipHashDay2 = await computeDailySaltedHash(ip, saltSecret, "2026-11-10");
    expect(ipHashDay1).not.toBeNull();
    expect(ipHashDay2).not.toBeNull();
    expect(ipHashDay1).not.toBe(ipHashDay2);

    const uaHash = await computeDailySaltedHash(ua, saltSecret);
    expect(uaHash).not.toBeNull();

    expect(await computeDailySaltedHash(null, saltSecret)).toBeNull();
    expect(await computeDailySaltedHash("", saltSecret)).toBeNull();
    expect(await computeDailySaltedHash("   ", saltSecret)).toBeNull();
  });

  it("builds and extracts secure and dev session cookies", () => {
    const secureCookie = buildSessionCookie("token123", true, 3600);
    expect(secureCookie).toContain(`${SESSION_COOKIE_NAME}=token123`);
    expect(secureCookie).toContain("Secure");
    expect(secureCookie).toContain("HttpOnly");
    expect(secureCookie).toContain("SameSite=Lax");

    const devCookie = buildSessionCookie("token456", false, 3600);
    expect(devCookie).toContain(`${DEV_SESSION_COOKIE_NAME}=token456`);
    expect(devCookie).not.toContain("Secure");

    const clearSecure = buildClearSessionCookie(true);
    expect(clearSecure).toContain("Max-Age=0");
    expect(clearSecure).toContain("Secure");

    const clearDev = buildClearSessionCookie(false);
    expect(clearDev).toContain("Max-Age=0");
    expect(clearDev).not.toContain("Secure");

    expect(extractSessionToken(null)).toBeNull();
    expect(extractSessionToken("other=123; foo=bar")).toBeNull();
    expect(extractSessionToken(`other=123; ${SESSION_COOKIE_NAME}=abc111`)).toBe("abc111");
    expect(extractSessionToken(`${DEV_SESSION_COOKIE_NAME}=def222`)).toBe("def222");
  });

  it("creates, validates, slides, rotates, and revokes sessions without storing plaintext token", async () => {
    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);
    const sessionManager = new SessionManager({ repo, saltSecret: "top-secret-salt" });

    const now = Date.now();
    await repo.createUser({
      id: "usr_alice",
      email: "alice@example.com",
      display_name: "Alice",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    const { rawToken, idHash } = await sessionManager.createSession(
      "usr_alice",
      "127.0.0.1",
      "Jest/Node"
    );

    // Plaintext token must NEVER exist in DB
    const dbRows = await adapter.query<{ id_hash: string }>("SELECT id_hash FROM sessions");
    expect(dbRows.length).toBe(1);
    expect(dbRows[0]?.id_hash).toBe(idHash);
    expect(dbRows[0]?.id_hash).not.toBe(rawToken);

    // Validate active session
    const validated = await sessionManager.validateAndSlideSession(rawToken);
    expect(validated).not.toBeNull();
    expect(validated?.user.id).toBe("usr_alice");
    expect(validated?.user.email).toBe("alice@example.com");

    // Sliding test: update expiration to trigger sliding branch
    await adapter.run("UPDATE sessions SET expires_at = ? WHERE id_hash = ?", [
      Date.now() + 1000,
      idHash
    ]);
    const slid = await sessionManager.validateAndSlideSession(rawToken);
    expect(slid).not.toBeNull();

    // Rotate session
    const rotated = await sessionManager.rotateSession(rawToken, "127.0.0.1", "Jest/Node");
    expect(rotated).not.toBeNull();
    expect(rotated?.rawToken).not.toBe(rawToken);

    // Old token should now be invalid
    expect(await sessionManager.validateAndSlideSession(rawToken)).toBeNull();
    // New token is valid
    expect(rotated?.rawToken).toBeDefined();
    if (rotated) {
      expect(await sessionManager.validateAndSlideSession(rotated.rawToken)).not.toBeNull();

      // Revoke new token
      await sessionManager.revokeSession(rotated.rawToken);
      expect(await sessionManager.validateAndSlideSession(rotated.rawToken)).toBeNull();
    }

    // Soft-deleted user test
    const { rawToken: user2Token, idHash: user2Hash } = await sessionManager.createSession(
      "usr_alice",
      null,
      null
    );
    await adapter.run("UPDATE users SET deleted_at = ? WHERE id = ?", [Date.now(), "usr_alice"]);
    expect(await sessionManager.validateAndSlideSession(user2Token)).toBeNull();
    // Session should have been deleted
    expect(await adapter.query("SELECT * FROM sessions WHERE id_hash = ?", [user2Hash])).toEqual(
      []
    );

    // Rotate non-existent token returns null
    expect(await sessionManager.rotateSession("unknown-token", null, null)).toBeNull();

    close();
  });
});

describe("CSRF Protection & Sec-Fetch-Site (Sub-Issue #66)", () => {
  function createTestApp() {
    const app = new Hono<{ Bindings: Env }>();
    app.use(
      "*",
      csrfProtection({
        allowedOrigins: ["https://trusted-partner.example.com"],
        isProduction: true
      })
    );

    app.get("/api/data", (c) => c.text("ok"));
    app.post("/api/data", (c) => c.text("mutated"));
    return app;
  }

  it("permits safe GET requests without origin validation", async () => {
    const app = createTestApp();
    const res = await app.request("https://api.example.com/api/data", { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");

    // POST without Origin or Sec-Fetch-Site (e.g. CLI or same-site navigation)
    const postWithoutOrigin = await app.request("https://api.example.com/api/data", {
      method: "POST"
    });
    expect(postWithoutOrigin.status).toBe(200);
  });

  it("rejects cross-site Sec-Fetch-Site requests with 403 Problem Details", async () => {
    const app = createTestApp();
    const res = await app.request("https://api.example.com/api/data", {
      method: "POST",
      headers: {
        "sec-fetch-site": "cross-site",
        origin: "https://evil.com"
      }
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("CSRF_CROSS_SITE_FORBIDDEN");
  });

  it("rejects unauthorized Origin requests with 403 Problem Details", async () => {
    const app = createTestApp();
    const res = await app.request("https://api.example.com/api/data", {
      method: "POST",
      headers: {
        origin: "https://attacker.com"
      }
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("CSRF_ORIGIN_FORBIDDEN");
  });

  it("permits same-origin and explicitly allowed origins", async () => {
    const app = createTestApp();

    const sameOriginRes = await app.request("https://api.example.com/api/data", {
      method: "POST",
      headers: {
        origin: "https://api.example.com"
      }
    });
    expect(sameOriginRes.status).toBe(200);

    const trustedRes = await app.request("https://api.example.com/api/data", {
      method: "POST",
      headers: {
        origin: "https://trusted-partner.example.com"
      }
    });
    expect(trustedRes.status).toBe(200);
  });
});

describe("RBAC & IDOR Protection Guards (Sub-Issue #67)", () => {
  function setupRbacApp(repo: CoreRepository, sessionManager: SessionManager) {
    const app = new Hono<{ Bindings: Env }>();
    app.use("*", sessionMiddleware(sessionManager));

    app.get("/api/auth/me", requireAuth(), (c) => {
      const user = c.get("sessionUser");
      return c.json({ user });
    });

    app.get("/api/workspaces/:workspaceId", requireWorkspaceRole(repo, "viewer"), (c) =>
      c.text("workspace-view")
    );

    app.delete("/api/workspaces/:workspaceId", requireWorkspaceRole(repo, "owner"), (c) =>
      c.text("workspace-deleted")
    );

    app.get("/api/notebooks/:notebookId", requireNotebookRole(repo, "viewer"), (c) =>
      c.text("notebook-view")
    );

    app.put("/api/notebooks/:notebookId", requireNotebookRole(repo, "editor"), (c) =>
      c.text("notebook-edited")
    );

    // Missing parameter routes for full coverage
    app.get("/api/test-missing-param-ws", requireWorkspaceRole(repo, "viewer", "missingId"), (c) =>
      c.text("ok")
    );
    app.get("/api/test-missing-param-nb", requireNotebookRole(repo, "viewer", "missingId"), (c) =>
      c.text("ok")
    );

    return app;
  }

  it("prevents unauthorized access and protects workspaces against IDOR", async () => {
    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);
    const sessionManager = new SessionManager({ repo, saltSecret: "rbac-test-salt" });
    const app = setupRbacApp(repo, sessionManager);

    const now = Date.now();
    await repo.createUser({
      id: "usr_alice",
      email: "alice@example.com",
      display_name: "Alice",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    await repo.createUser({
      id: "usr_bob",
      email: "bob@example.com",
      display_name: "Bob",
      locale: "en",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    await repo.createWorkspace({
      id: "ws_alice",
      name: "Alice Workspace",
      owner_id: "usr_alice",
      created_at: now
    });

    // Add Bob as viewer to Alice workspace
    await adapter.run(
      "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      ["ws_alice", "usr_bob", "viewer", now]
    );

    const { rawToken: aliceToken } = await sessionManager.createSession("usr_alice", null, null);
    const { rawToken: bobToken } = await sessionManager.createSession("usr_bob", null, null);

    // 1. Unauthenticated request -> 401
    const unauthRes = await app.request("https://api.example.com/api/auth/me");
    expect(unauthRes.status).toBe(401);

    // Invalid cookie token in sessionMiddleware -> ignored, still 401
    const invalidCookieRes = await app.request("https://api.example.com/api/auth/me", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=invalid_or_expired_token` }
    });
    expect(invalidCookieRes.status).toBe(401);

    // 2. Authenticated request -> 200
    const authRes = await app.request("https://api.example.com/api/auth/me", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${aliceToken}` }
    });
    expect(authRes.status).toBe(200);

    // 3. Bob (viewer) views workspace -> 200
    const bobViewRes = await app.request("https://api.example.com/api/workspaces/ws_alice", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${bobToken}` }
    });
    expect(bobViewRes.status).toBe(200);

    // 4. Bob (viewer) attempts to DELETE workspace (requires owner) -> 403 Forbidden
    const bobDeleteRes = await app.request("https://api.example.com/api/workspaces/ws_alice", {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${bobToken}` }
    });
    expect(bobDeleteRes.status).toBe(403);

    // 5. Alice (owner) deletes workspace -> 200
    const aliceDeleteRes = await app.request("https://api.example.com/api/workspaces/ws_alice", {
      method: "DELETE",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${aliceToken}` }
    });
    expect(aliceDeleteRes.status).toBe(200);

    // 6. IDOR: Bob accesses non-existent or inaccessible workspace -> 404 (does not leak existence)
    const idorRes = await app.request("https://api.example.com/api/workspaces/ws_secret_other", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${bobToken}` }
    });
    expect(idorRes.status).toBe(404);

    // 7. Missing param test -> 400
    const missingWsParamRes = await app.request(
      "https://api.example.com/api/test-missing-param-ws",
      {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${aliceToken}` }
      }
    );
    expect(missingWsParamRes.status).toBe(400);

    // 8. requireWorkspaceRole without auth -> 401
    const noAuthWsRes = await app.request("https://api.example.com/api/workspaces/ws_alice");
    expect(noAuthWsRes.status).toBe(401);

    close();
  });

  it("protects notebooks against IDOR via workspace membership and notebook_shares", async () => {
    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);
    const sessionManager = new SessionManager({ repo, saltSecret: "rbac-nb-salt" });
    const app = setupRbacApp(repo, sessionManager);

    const now = Date.now();
    await repo.createUser({
      id: "usr_alice",
      email: "alice@example.com",
      display_name: "Alice",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    await repo.createUser({
      id: "usr_charlie",
      email: "charlie@example.com",
      display_name: "Charlie",
      locale: "de",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    await repo.createUser({
      id: "usr_stranger",
      email: "stranger@example.com",
      display_name: "Stranger",
      locale: "en",
      is_guest: 0,
      created_at: now,
      expires_at: null,
      deleted_at: null
    });

    await repo.createWorkspace({
      id: "ws_alice",
      name: "Alice WS",
      owner_id: "usr_alice",
      created_at: now
    });

    await repo.createNotebook({
      id: "nb_shared",
      workspace_id: "ws_alice",
      title: "Geheimprojekt",
      emoji: "lock",
      created_by: "usr_alice",
      created_at: now,
      updated_at: now,
      expires_at: null
    });

    // Share notebook with Charlie as viewer
    await adapter.run(
      "INSERT INTO notebook_shares (notebook_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      ["nb_shared", "usr_charlie", "viewer", now]
    );

    const { rawToken: aliceToken } = await sessionManager.createSession("usr_alice", null, null);
    const { rawToken: charlieToken } = await sessionManager.createSession(
      "usr_charlie",
      null,
      null
    );
    const { rawToken: strangerToken } = await sessionManager.createSession(
      "usr_stranger",
      null,
      null
    );

    // 1. Unauthenticated -> 401
    const unauthNb = await app.request("https://api.example.com/api/notebooks/nb_shared");
    expect(unauthNb.status).toBe(401);

    // 2. Charlie (viewer via share) views notebook -> 200
    const charlieView = await app.request("https://api.example.com/api/notebooks/nb_shared", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${charlieToken}` }
    });
    expect(charlieView.status).toBe(200);

    // 3. Charlie (viewer) tries to edit notebook (requires editor) -> 403
    const charlieEdit = await app.request("https://api.example.com/api/notebooks/nb_shared", {
      method: "PUT",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${charlieToken}` }
    });
    expect(charlieEdit.status).toBe(403);

    // 4. Alice (workspace owner) edits notebook -> 200
    const aliceEdit = await app.request("https://api.example.com/api/notebooks/nb_shared", {
      method: "PUT",
      headers: { cookie: `${SESSION_COOKIE_NAME}=${aliceToken}` }
    });
    expect(aliceEdit.status).toBe(200);

    // 5. Stranger tries to view notebook -> 404 IDOR protected
    const strangerView = await app.request("https://api.example.com/api/notebooks/nb_shared", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${strangerToken}` }
    });
    expect(strangerView.status).toBe(404);

    // 6. Non-existent notebook -> 404
    const nonExistent = await app.request(
      "https://api.example.com/api/notebooks/nb_does_not_exist",
      {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${aliceToken}` }
      }
    );
    expect(nonExistent.status).toBe(404);

    // 7. Missing parameter test -> 400
    const missingNbParamRes = await app.request(
      "https://api.example.com/api/test-missing-param-nb",
      {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${aliceToken}` }
      }
    );
    expect(missingNbParamRes.status).toBe(400);

    close();
  });
});
