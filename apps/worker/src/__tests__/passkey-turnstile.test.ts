/**
 * #343: passkey registration requires a confirmed Turnstile check, fail-closed exactly
 * like guest login and magic-link: no secret -> 503, no or rejected token -> 403,
 * and no challenge is issued in either case.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { sessionMiddleware } from "../auth-middleware.js";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import { createPasskeyRoutes } from "../passkey-routes.js";
import { PasskeyService } from "../passkey-service.js";
import { SESSION_COOKIE_NAME, SessionManager } from "../session.js";
import { TURNSTILE_TEST_SECRET_ALWAYS_PASSES } from "../turnstile.js";

function createDb(): { adapter: DatabaseAdapter; close: () => void } {
  const db = new DatabaseSync(":memory:");
  for (const migration of ["0001_initial_core.sql", "0003_webauthn_challenges.sql"]) {
    db.exec(readFileSync(resolve(process.cwd(), "apps/worker/migrations", migration), "utf-8"));
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

interface SiteverifyCall {
  readonly secret: string | null;
  readonly response: string | null;
}

function siteverifyMock(success: boolean): { fetch: typeof fetch; calls: SiteverifyCall[] } {
  const calls: SiteverifyCall[] = [];
  const fn = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const form = init?.body as FormData;
    calls.push({
      secret: form.get("secret") as string | null,
      response: form.get("response") as string | null
    });
    return new Response(
      JSON.stringify(success ? { success: true } : { success: false, "error-codes": ["x"] }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  return { fetch: fn as unknown as typeof fetch, calls };
}

async function buildApp(turnstileSecretKey: string | undefined, success = true) {
  const { adapter, close } = createDb();
  const repo = new CoreRepository(adapter);
  const sessionManager = new SessionManager({ repo, saltSecret: "passkey-turnstile-salt" });
  const passkeyService = new PasskeyService({
    repo,
    rpName: "RelationNotes",
    rpID: "localhost",
    expectedOrigin: "http://localhost:5173"
  });
  const generate = vi.spyOn(passkeyService, "generateRegistrationOptions");
  const siteverify = siteverifyMock(success);

  const app = new Hono<{ Bindings: Env }>();
  app.use("*", sessionMiddleware(sessionManager));
  app.route(
    "/api/v1/auth/passkey",
    createPasskeyRoutes({
      repo,
      passkeyService,
      sessionManager,
      turnstileSecretKey,
      customFetch: siteverify.fetch
    })
  );

  await repo.createUser({
    id: "usr_guest_pk",
    email: null,
    display_name: "Gast",
    locale: "de",
    is_guest: 1,
    created_at: Date.now(),
    expires_at: Date.now() + 86_400_000,
    deleted_at: null
  });
  const { rawToken } = await sessionManager.createSession("usr_guest_pk", null, null);

  const options = (body: string | undefined, withSession = true) =>
    app.request("https://api.example.com/api/v1/auth/passkey/register/options", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(withSession ? { cookie: `${SESSION_COOKIE_NAME}=${rawToken}` } : {})
      },
      ...(body === undefined ? {} : { body })
    });

  return { options, generate, siteverify, close };
}

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { code: string }).code;
}

describe("Turnstile before passkey registration (#343)", () => {
  it.each([
    ["undefined", undefined],
    ["empty", ""],
    ["whitespace", "   "]
  ])("returns 503 when the secret is %s, without calling Siteverify", async (_l, secret) => {
    const t = await buildApp(secret);
    const res = await t.options(JSON.stringify({ turnstileToken: "tok" }));
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(await codeOf(res)).toBe("TURNSTILE_NOT_CONFIGURED");
    expect(t.siteverify.calls).toHaveLength(0);
    expect(t.generate).not.toHaveBeenCalled();
    t.close();
  });

  it.each([
    ["no body", undefined],
    ["invalid JSON", "not-json"],
    ["JSON null", "null"],
    ["no token", "{}"],
    ["blank token", JSON.stringify({ turnstileToken: "  " })],
    ["non-string token", JSON.stringify({ turnstileToken: 42 })]
  ])("returns 403 with %s, without issuing a challenge", async (_l, body) => {
    const t = await buildApp(TURNSTILE_TEST_SECRET_ALWAYS_PASSES);
    const res = await t.options(body);
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("BOT_VERIFICATION_REQUIRED");
    expect(t.siteverify.calls).toHaveLength(0);
    expect(t.generate).not.toHaveBeenCalled();
    t.close();
  });

  it("returns 403 when Siteverify rejects the token", async () => {
    const t = await buildApp(TURNSTILE_TEST_SECRET_ALWAYS_PASSES, false);
    const res = await t.options(JSON.stringify({ turnstileToken: "bad" }));
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("BOT_VERIFICATION_FAILED");
    expect(t.siteverify.calls).toEqual([
      { secret: TURNSTILE_TEST_SECRET_ALWAYS_PASSES, response: "bad" }
    ]);
    expect(t.generate).not.toHaveBeenCalled();
    t.close();
  });

  it("issues registration options only after Siteverify confirmed the token", async () => {
    const t = await buildApp(TURNSTILE_TEST_SECRET_ALWAYS_PASSES);
    const res = await t.options(JSON.stringify({ turnstileToken: "good" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { challenge?: string }).challenge).toBeTruthy();
    expect(t.siteverify.calls).toEqual([
      { secret: TURNSTILE_TEST_SECRET_ALWAYS_PASSES, response: "good" }
    ]);
    expect(t.generate).toHaveBeenCalledTimes(1);
    t.close();
  });

  it("still requires a session first (401 before any bot check)", async () => {
    const t = await buildApp(TURNSTILE_TEST_SECRET_ALWAYS_PASSES);
    const res = await t.options(JSON.stringify({ turnstileToken: "good" }), false);
    expect(res.status).toBe(401);
    expect(t.siteverify.calls).toHaveLength(0);
    t.close();
  });
});
