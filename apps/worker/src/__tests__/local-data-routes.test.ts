import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { sessionMiddleware } from "../auth-middleware.js";
import { CoreRepository } from "../core-repository.js";
import { createD1DatabaseAdapter } from "../d1-adapter.js";
import {
  LOCAL_KEY_BYTES,
  deriveLocalKeyMaterial,
  registerLocalDataRoutes
} from "../local-data-routes.js";
import { createNodeEnv, runSqliteMigrations } from "../node-server.js";
import { SessionManager, sha256Hex } from "../session.js";

const SALT = "test-only-salt-local-data-routes";

async function setup(saltSecret: string | undefined = SALT, isProduction = false) {
  const sqlite = new DatabaseSync(":memory:");
  runSqliteMigrations(sqlite, resolve(process.cwd(), "apps/worker/migrations"));
  const handle = createNodeEnv({
    db: sqlite,
    dataDir: mkdtempSync(join(tmpdir(), "local-data-")),
    sessionSaltSecret: SALT
  });
  const repo = new CoreRepository(createD1DatabaseAdapter(handle.env.DB));
  const now = Date.now();
  for (const id of ["alice", "bob"]) {
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
  const sessionManager = new SessionManager({ repo, saltSecret: SALT });
  const app = new Hono();
  app.use("*", sessionMiddleware(sessionManager));
  registerLocalDataRoutes(app, { sessionManager, saltSecret, isProduction });
  const session = async (user: string) =>
    (await sessionManager.createSession(user, null, null)).rawToken;
  return { app, repo, session, close: handle.close };
}

describe("Lokale Verschlüsselung: Schlüssel und Abmelden (Issue #348)", () => {
  let fx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    fx = await setup();
    return () => fx.close();
  });

  const keyFor = async (token: string) => {
    const res = await fx.app.request("http://localhost/api/v1/auth/local-key", {
      headers: { cookie: `sid=${token}` }
    });
    return { res, body: (await res.json()) as { version: number; keyMaterial: string } };
  };

  it("liefert ohne Sitzung 401", async () => {
    const res = await fx.app.request("http://localhost/api/v1/auth/local-key");
    expect(res.status).toBe(401);
  });

  it("liefert je Sitzung stabiles, nicht cachebares Material", async () => {
    const token = await fx.session("alice");
    const a = await keyFor(token);
    const b = await keyFor(token);
    expect(a.res.status).toBe(200);
    expect(a.res.headers.get("cache-control")).toContain("no-store");
    expect(a.body.version).toBe(1);
    expect(a.body.keyMaterial).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b.body.keyMaterial).toBe(a.body.keyMaterial);
  });

  it("andere Sitzung oder anderer Nutzer: anderes Material", async () => {
    const a1 = await keyFor(await fx.session("alice"));
    const a2 = await keyFor(await fx.session("alice"));
    const b1 = await keyFor(await fx.session("bob"));
    expect(new Set([a1.body.keyMaterial, a2.body.keyMaterial, b1.body.keyMaterial]).size).toBe(3);
  });

  it("Ableitung hängt von Salz, Nutzer und Sitzung ab", async () => {
    const base = await deriveLocalKeyMaterial("s1", "u", "h");
    expect(base.byteLength).toBe(LOCAL_KEY_BYTES);
    for (const other of [
      await deriveLocalKeyMaterial("s2", "u", "h"),
      await deriveLocalKeyMaterial("s1", "v", "h"),
      await deriveLocalKeyMaterial("s1", "u", "i")
    ]) {
      expect(other).not.toEqual(base);
    }
  });

  it("Abmelden beendet die Sitzung: danach kein Schlüssel mehr", async () => {
    const token = await fx.session("alice");
    const res = await fx.app.request("http://localhost/api/v1/auth/logout", {
      method: "POST",
      headers: { cookie: `sid=${token}` }
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(/^sid=;.*Max-Age=0/);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await fx.repo.getSession(await sha256Hex(token))).toBeFalsy();
    const after = await fx.app.request("http://localhost/api/v1/auth/local-key", {
      headers: { cookie: `sid=${token}` }
    });
    expect(after.status).toBe(401);
  });

  it("Abmelden ohne Sitzung antwortet ebenfalls 204", async () => {
    const res = await fx.app.request("http://localhost/api/v1/auth/logout", { method: "POST" });
    expect(res.status).toBe(204);
  });

  it("in Produktion wird das __Host-Cookie entwertet", async () => {
    const prod = await setup(SALT, true);
    const res = await prod.app.request("https://app.example/api/v1/auth/logout", {
      method: "POST"
    });
    expect(res.headers.get("set-cookie")).toMatch(/^__Host-sid=;.*Secure/);
    prod.close();
  });

  it("ohne SESSION_SALT_SECRET: 503 statt Schlüssel", async () => {
    const noSalt = await setup("");
    const token = await noSalt.session("alice");
    const res = await noSalt.app.request("http://localhost/api/v1/auth/local-key", {
      headers: { cookie: `sid=${token}` }
    });
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(((await res.json()) as { code: string }).code).toBe("LOCAL_KEY_UNAVAILABLE");
    noSalt.close();
  });

  it("ohne Sitzungs-Hash im Kontext: 503", async () => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("sessionUser", {
        id: "alice",
        email: null,
        displayName: "a",
        locale: "de",
        isGuest: false
      });
      await next();
    });
    registerLocalDataRoutes(app, {
      sessionManager: {} as SessionManager,
      saltSecret: SALT,
      isProduction: false
    });
    const res = await app.request("http://localhost/api/v1/auth/local-key");
    expect(res.status).toBe(503);
  });
});
