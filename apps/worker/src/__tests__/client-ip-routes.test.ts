/**
 * #342: every route that records or forwards a client IP must resolve it through
 * resolveClientIp(). On Node, client-supplied proxy headers (cf-connecting-ip,
 * x-forwarded-for) are forgeable and must be ignored; inside the Cloudflare runtime
 * cf-connecting-ip is set by the edge and is trusted; TRUSTED_PROXY_HEADER always wins.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionMiddleware } from "../auth-middleware.js";
import { registerBYOKRoutes } from "../byok-routes.js";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import { createGuestAndMagicLinkRoutes } from "../guest-magic-link-routes.js";
import { KeyVault } from "../key-vault.js";
import { ConsoleMailAdapter } from "../mail-adapter.js";
import { createPasskeyRoutes } from "../passkey-routes.js";
import { PasskeyService } from "../passkey-service.js";
import { RagRepository } from "../rag-repository.js";
import { SessionManager, computeDailySaltedHash } from "../session.js";
import { TURNSTILE_TEST_SECRET_ALWAYS_PASSES } from "../turnstile.js";

const SPOOFED_HEADERS = {
  "cf-connecting-ip": "6.6.6.6",
  "x-forwarded-for": "7.7.7.7, 8.8.8.8"
};

function createDb(withRag = false): { adapter: DatabaseAdapter; close: () => void } {
  const db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(resolve(process.cwd(), "apps/worker/migrations/0001_initial_core.sql"), "utf-8")
  );
  if (withRag) {
    db.exec(
      readFileSync(
        resolve(process.cwd(), "apps/worker/migrations/0002_rag_and_studio.sql"),
        "utf-8"
      )
    );
  }
  const params = (p: unknown[]) => p as (string | number | bigint | null)[];
  const adapter: DatabaseAdapter = {
    async exec(sql: string) {
      db.exec(sql);
    },
    async query<T>(sql: string, p: unknown[] = []) {
      return db.prepare(sql).all(...params(p)) as T[];
    },
    async queryOne<T>(sql: string, p: unknown[] = []) {
      return (db.prepare(sql).get(...params(p)) as T) ?? null;
    },
    async run(sql: string, p: unknown[] = []) {
      return { changes: Number(db.prepare(sql).run(...params(p)).changes) };
    }
  };
  return { adapter, close: () => db.close() };
}

/** Env with an operator-configured trusted proxy header (not part of the generated Env type). */
function proxyEnv(header: string): Env {
  return { TRUSTED_PROXY_HEADER: header } as unknown as Env;
}

function useCloudflareRuntime(): void {
  vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Guest login + magic-link callback (Turnstile remoteip and session IP)
// ---------------------------------------------------------------------------

function buildGuestApp() {
  const { adapter, close } = createDb();
  const repo = new CoreRepository(adapter);
  const sessionManager = new SessionManager({ repo, saltSecret: "client-ip-salt" });
  const createSession = vi.spyOn(sessionManager, "createSession");
  const remoteIps: (string | null)[] = [];
  const siteverify = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    remoteIps.push((init?.body as FormData).get("remoteip") as string | null);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as unknown as typeof fetch;
  const mail = new ConsoleMailAdapter();
  const app = new Hono<{ Bindings: Env }>();
  app.route(
    "/api/v1/auth",
    createGuestAndMagicLinkRoutes({
      repo,
      sessionManager,
      mailAdapter: mail,
      appBaseUrl: "https://relationnotes.example.com",
      isProduction: false,
      turnstileSecretKey: TURNSTILE_TEST_SECRET_ALWAYS_PASSES,
      customFetch: siteverify
    })
  );

  const guestLogin = (headers: Record<string, string>, env?: Env) =>
    app.request(
      "https://api.example.com/api/v1/auth/guest",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ turnstileToken: "tok" })
      },
      env
    );

  const magicLinkCallback = async (headers: Record<string, string>, env?: Env) => {
    const send = await app.request(
      "https://api.example.com/api/v1/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ip@example.com", turnstileToken: "tok" })
      },
      env
    );
    expect(send.status).toBe(200);
    const token = mail.lastSentEmail?.text.match(/token=([a-zA-Z0-9_-]+)/)?.[1] ?? "";
    return app.request(
      `https://api.example.com/api/v1/auth/magic-link/callback?token=${token}`,
      { headers },
      env
    );
  };

  return { guestLogin, magicLinkCallback, createSession, remoteIps, close };
}

describe("guest login and magic-link callback resolve the client IP via resolveClientIp (#342)", () => {
  it("ignores forged proxy headers on Node: no remoteip to Siteverify, no IP on the session", async () => {
    const t = buildGuestApp();
    const guest = await t.guestLogin(SPOOFED_HEADERS);
    expect(guest.status).toBe(201);
    expect(t.remoteIps).toEqual([null]);
    expect(t.createSession.mock.calls[0]?.[1]).toBeNull();

    const callback = await t.magicLinkCallback(SPOOFED_HEADERS);
    expect(callback.status).toBe(200);
    expect(t.createSession.mock.calls[1]?.[1]).toBeNull();
    t.close();
  });

  it("uses cf-connecting-ip inside the Cloudflare runtime, never x-forwarded-for", async () => {
    useCloudflareRuntime();
    const t = buildGuestApp();
    expect((await t.guestLogin(SPOOFED_HEADERS)).status).toBe(201);
    expect(t.remoteIps).toEqual(["6.6.6.6"]);
    expect(t.createSession.mock.calls[0]?.[1]).toBe("6.6.6.6");

    expect((await t.magicLinkCallback({ "x-forwarded-for": "7.7.7.7" })).status).toBe(200);
    expect(t.createSession.mock.calls[1]?.[1]).toBeNull();
    t.close();
  });

  it("uses only the last entry of the operator's TRUSTED_PROXY_HEADER on Node", async () => {
    const env = proxyEnv("x-forwarded-for");
    const t = buildGuestApp();
    expect((await t.guestLogin(SPOOFED_HEADERS, env)).status).toBe(201);
    expect(t.remoteIps).toEqual(["8.8.8.8"]);
    expect(t.createSession.mock.calls[0]?.[1]).toBe("8.8.8.8");

    expect((await t.magicLinkCallback(SPOOFED_HEADERS, env)).status).toBe(200);
    expect(t.createSession.mock.calls[1]?.[1]).toBe("8.8.8.8");
    t.close();
  });
});

// ---------------------------------------------------------------------------
// Passkey login (session IP)
// ---------------------------------------------------------------------------

async function buildPasskeyApp() {
  const { adapter, close } = createDb();
  const repo = new CoreRepository(adapter);
  const sessionManager = new SessionManager({ repo, saltSecret: "client-ip-salt" });
  const createSession = vi.spyOn(sessionManager, "createSession");
  const passkeyService = new PasskeyService({
    repo,
    rpName: "RelationNotes",
    rpID: "localhost",
    expectedOrigin: "http://localhost:5173"
  });
  await repo.createUser({
    id: "usr_pk",
    email: "pk@example.com",
    display_name: "PK",
    locale: "de",
    is_guest: 0,
    created_at: Date.now(),
    expires_at: null,
    deleted_at: null
  });
  const user = await repo.getUserById("usr_pk");
  if (!user) throw new Error("user not found");
  passkeyService.verifyLogin = async () => ({ verified: true, user, signCountUpdated: true });

  const app = new Hono<{ Bindings: Env }>();
  app.use("*", sessionMiddleware(sessionManager));
  app.route(
    "/api/v1/auth/passkey",
    createPasskeyRoutes({ repo, passkeyService, sessionManager, isProduction: false })
  );
  const login = (headers: Record<string, string>, env?: Env) =>
    app.request(
      "https://api.example.com/api/v1/auth/passkey/login/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ id: "cred", response: {} })
      },
      env
    );
  return { login, createSession, close };
}

describe("passkey login resolves the client IP via resolveClientIp (#342)", () => {
  it("ignores forged proxy headers on Node", async () => {
    const t = await buildPasskeyApp();
    expect((await t.login(SPOOFED_HEADERS)).status).toBe(200);
    expect(t.createSession.mock.calls[0]?.[1]).toBeNull();
    t.close();
  });

  it("uses cf-connecting-ip inside the Cloudflare runtime", async () => {
    useCloudflareRuntime();
    const t = await buildPasskeyApp();
    expect((await t.login(SPOOFED_HEADERS)).status).toBe(200);
    expect(t.createSession.mock.calls[0]?.[1]).toBe("6.6.6.6");
    t.close();
  });

  it("uses the configured TRUSTED_PROXY_HEADER on Node", async () => {
    const t = await buildPasskeyApp();
    const env = proxyEnv("X-Forwarded-For");
    expect((await t.login(SPOOFED_HEADERS, env)).status).toBe(200);
    expect(t.createSession.mock.calls[0]?.[1]).toBe("8.8.8.8");
    t.close();
  });
});

// ---------------------------------------------------------------------------
// BYOK audit log (salted IP hash)
// ---------------------------------------------------------------------------

const KEK = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SALT = "byok-ip-salt";

async function buildByokApp() {
  const { adapter, close } = createDb(true);
  const coreRepo = new CoreRepository(adapter);
  await coreRepo.createUser({
    id: "usr_byok",
    email: "byok@example.com",
    display_name: "BYOK",
    locale: "de",
    is_guest: 0,
    created_at: Date.now(),
    expires_at: null,
    deleted_at: null
  });
  const app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
  app.use("*", async (c, next) => {
    c.set("sessionUser", { id: "usr_byok" });
    await next();
  });
  registerBYOKRoutes(app, {
    ragRepo: new RagRepository(adapter),
    coreRepo,
    keyVault: new KeyVault({ keks: { 1: KEK }, currentVersion: 1 }),
    saltSecret: SALT
  });
  const saveKey = async (headers: Record<string, string>, env?: Env) => {
    const res = await app.request(
      "/api/v1/keys/anthropic",
      {
        method: "PUT",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ apiKey: "sk-ant-api03-abcdef1234567890-clientip" })
      },
      env
    );
    expect(res.status).toBe(200);
    const row = await adapter.queryOne<{ ip_hash: string }>(
      "SELECT ip_hash FROM audit_log WHERE action = 'byok_key_saved' ORDER BY created_at DESC"
    );
    return row?.ip_hash;
  };
  return { saveKey, close };
}

describe("BYOK audit log hashes only a trusted client IP (#342)", () => {
  it("stores no IP hash on Node when only forged proxy headers are present", async () => {
    const t = await buildByokApp();
    expect(await t.saveKey(SPOOFED_HEADERS)).toBe("unknown-ip");
    t.close();
  });

  it("hashes cf-connecting-ip inside the Cloudflare runtime", async () => {
    useCloudflareRuntime();
    const t = await buildByokApp();
    expect(await t.saveKey(SPOOFED_HEADERS)).toBe(await computeDailySaltedHash("6.6.6.6", SALT));
    t.close();
  });

  it("hashes the last entry of the configured TRUSTED_PROXY_HEADER on Node", async () => {
    const t = await buildByokApp();
    const env = proxyEnv("x-forwarded-for");
    expect(await t.saveKey(SPOOFED_HEADERS, env)).toBe(
      await computeDailySaltedHash("8.8.8.8", SALT)
    );
    t.close();
  });
});
