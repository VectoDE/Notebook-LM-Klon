import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import {
  DEMO_WORKSPACE_ID,
  DEMO_WORKSPACE_NAME,
  createGuestAndMagicLinkRoutes
} from "../guest-magic-link-routes.js";
import { CloudflareMailAdapter, ConsoleMailAdapter, HttpMailAdapter } from "../mail-adapter.js";
import { DEV_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME, SessionManager } from "../session.js";
import {
  DEFAULT_TURNSTILE_SITEVERIFY_URL,
  TURNSTILE_TEST_SECRET_ALWAYS_FAILS,
  TURNSTILE_TEST_SECRET_ALWAYS_PASSES,
  TURNSTILE_TEST_SECRET_TOKEN_ALREADY_SPENT,
  verifyTurnstileToken
} from "../turnstile.js";

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

interface SiteverifyCall {
  url: string;
  secret: string | null;
  response: string | null;
}

/** Siteverify mock that records the submitted form fields. */
function createSiteverifyMock(success: boolean): { fetch: typeof fetch; calls: SiteverifyCall[] } {
  const calls: SiteverifyCall[] = [];
  const mock = async (input: RequestInfo | URL, init?: RequestInit) => {
    const form = init?.body as FormData;
    calls.push({
      url: String(input),
      secret: form.get("secret") as string | null,
      response: form.get("response") as string | null
    });
    const payload = success
      ? { success: true }
      : { success: false, "error-codes": ["invalid-input-response"] };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  return { fetch: mock as unknown as typeof fetch, calls };
}

const passingTurnstile = (): { turnstileSecretKey: string; customFetch: typeof fetch } => ({
  turnstileSecretKey: TURNSTILE_TEST_SECRET_ALWAYS_PASSES,
  customFetch: createSiteverifyMock(true).fetch
});

describe("Turnstile Bot Verification Client (Sub-Issue #71)", () => {
  it("verifies tokens successfully with test secret key and handles all response metadata", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          success: true,
          challenge_ts: "2026-11-09T16:00:00Z",
          hostname: "localhost",
          action: "guest_login",
          cdata: "session_data_123"
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );

    const result = await verifyTurnstileToken(
      {
        secretKey: TURNSTILE_TEST_SECRET_ALWAYS_PASSES,
        token: "mock_turnstile_token",
        remoteIp: "127.0.0.1",
        idempotencyKey: "idem_123"
      },
      mockFetch as unknown as typeof fetch
    );

    expect(result.success).toBe(true);
    expect(result.challengeTs).toBe("2026-11-09T16:00:00Z");
    expect(result.hostname).toBe("localhost");
    expect(result.action).toBe("guest_login");
    expect(result.cdata).toBe("session_data_123");
    expect(DEFAULT_TURNSTILE_SITEVERIFY_URL).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    );
    expect(TURNSTILE_TEST_SECRET_TOKEN_ALREADY_SPENT).toBe("3x0000000000000000000000000000000AA");
    expect(DEMO_WORKSPACE_NAME).toBe("RelationFlow & KI im Mittelstand");
  });

  it("handles failing tokens, non-200 HTTP responses and network errors", async () => {
    // Failing response from Turnstile
    const failFetch = async () =>
      new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });

    const failResult = await verifyTurnstileToken(
      { secretKey: TURNSTILE_TEST_SECRET_ALWAYS_FAILS, token: "bad_token" },
      failFetch as unknown as typeof fetch
    );
    expect(failResult.success).toBe(false);
    expect(failResult.errorCodes).toContain("invalid-input-response");

    // HTTP 500 status from endpoint
    const http500Fetch = async () => new Response("Internal Server Error", { status: 500 });
    const http500Result = await verifyTurnstileToken(
      { secretKey: "secret", token: "token" },
      http500Fetch as unknown as typeof fetch
    );
    expect(http500Result.success).toBe(false);
    expect(http500Result.errorCodes).toContain("http-status-500");

    // Network / exception error
    const netErrFetch = async () => {
      throw new Error("DNS resolution failed");
    };
    const netErrResult = await verifyTurnstileToken(
      { secretKey: "secret", token: "token" },
      netErrFetch as unknown as typeof fetch
    );
    expect(netErrResult.success).toBe(false);
    expect(netErrResult.errorCodes).toContain("network-error");
  });
});

describe("MailAdapter Implementations (Sub-Issue #73)", () => {
  it("tests ConsoleMailAdapter", async () => {
    const adapter = new ConsoleMailAdapter();
    expect(adapter.providerName).toBe("console");
    const res = await adapter.send({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Hi</p>",
      text: "Hi"
    });
    expect(res.success).toBe(true);
    expect(adapter.lastSentEmail?.to).toBe("test@example.com");
  });

  it("tests CloudflareMailAdapter with and without binding", async () => {
    const withoutBinding = new CloudflareMailAdapter();
    expect(withoutBinding.providerName).toBe("cloudflare");
    const failRes = await withoutBinding.send({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Hi</p>",
      text: "Hi"
    });
    expect(failRes.success).toBe(false);

    let sent = false;
    const withBinding = new CloudflareMailAdapter({
      send: async () => {
        sent = true;
      }
    });
    const okRes = await withBinding.send({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Hi</p>",
      text: "Hi"
    });
    expect(okRes.success).toBe(true);
    expect(sent).toBe(true);

    const throwingBinding = new CloudflareMailAdapter({
      send: async () => {
        throw new Error("Quota exceeded");
      }
    });
    const throwRes = await throwingBinding.send({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Hi</p>",
      text: "Hi"
    });
    expect(throwRes.success).toBe(false);
    expect(throwRes.error).toBe("Quota exceeded");
  });

  it("tests HttpMailAdapter for Resend and Brevo including error handling", async () => {
    // Resend success
    const resendOkFetch = async () =>
      new Response(JSON.stringify({ id: "resend_msg_01" }), { status: 200 });
    const resendAdapter = new HttpMailAdapter(
      "resend",
      "re_key_123",
      "sender@example.com",
      resendOkFetch as unknown as typeof fetch
    );
    const resendOk = await resendAdapter.send({
      to: "user@example.com",
      subject: "S",
      html: "H",
      text: "T"
    });
    expect(resendOk.success).toBe(true);
    expect(resendOk.messageId).toBe("resend_msg_01");

    // Resend fail
    const resendFailFetch = async () => new Response("Unauthorized", { status: 401 });
    const resendFailAdapter = new HttpMailAdapter(
      "resend",
      "bad_key",
      "sender@example.com",
      resendFailFetch as unknown as typeof fetch
    );
    const resendFail = await resendFailAdapter.send({
      to: "user@example.com",
      subject: "S",
      html: "H",
      text: "T"
    });
    expect(resendFail.success).toBe(false);

    // Resend network error
    const resendNetErr = new HttpMailAdapter("resend", "k", "from", (() => {
      throw new Error("timeout");
    }) as unknown as typeof fetch);
    expect((await resendNetErr.send({ to: "u", subject: "s", html: "h", text: "t" })).success).toBe(
      false
    );

    // Brevo success
    const brevoOkFetch = async () =>
      new Response(JSON.stringify({ messageId: "brevo_msg_01" }), { status: 200 });
    const brevoAdapter = new HttpMailAdapter(
      "brevo",
      "br_key_123",
      "sender@example.com",
      brevoOkFetch as unknown as typeof fetch
    );
    const brevoOk = await brevoAdapter.send({
      to: "user@example.com",
      subject: "S",
      html: "H",
      text: "T"
    });
    expect(brevoOk.success).toBe(true);
    expect(brevoOk.messageId).toBe("brevo_msg_01");

    // Brevo fail
    const brevoFailFetch = async () => new Response("Bad Request", { status: 400 });
    const brevoFailAdapter = new HttpMailAdapter(
      "brevo",
      "bad_key",
      "sender@example.com",
      brevoFailFetch as unknown as typeof fetch
    );
    const brevoFail = await brevoFailAdapter.send({
      to: "user@example.com",
      subject: "S",
      html: "H",
      text: "T"
    });
    expect(brevoFail.success).toBe(false);

    // Brevo net error
    const brevoNetErr = new HttpMailAdapter("brevo", "k", "from", (() => {
      throw new Error("offline");
    }) as unknown as typeof fetch);
    expect((await brevoNetErr.send({ to: "u", subject: "s", html: "h", text: "t" })).success).toBe(
      false
    );
  });
});

describe("1-Click Guest Login & Magic-Link Endpoints (Sub-Issues #72 & #73)", () => {
  it("handles guest login, 24h expiration, turnstile checks, workspace seeding and production cookies", async () => {
    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);
    const sessionManager = new SessionManager({ repo, saltSecret: "guest-salt" });
    const consoleMail = new ConsoleMailAdapter();

    const mockTurnstileFetch = async () =>
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });

    const app = new Hono<{ Bindings: Env }>();
    app.route(
      "/api/v1/auth",
      createGuestAndMagicLinkRoutes({
        repo,
        sessionManager,
        mailAdapter: consoleMail,
        appBaseUrl: "https://relationnotes.example.com",
        isProduction: true,
        turnstileSecretKey: TURNSTILE_TEST_SECRET_ALWAYS_PASSES,
        customFetch: mockTurnstileFetch as unknown as typeof fetch
      })
    );

    // 1. Success guest login with Turnstile token in production mode
    const guestRes = await app.request("https://api.example.com/api/v1/auth/guest", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" },
      body: JSON.stringify({ turnstileToken: "token_abc", locale: "de" })
    });
    expect(guestRes.status).toBe(201);
    expect(guestRes.headers.get("set-cookie")).toContain(SESSION_COOKIE_NAME);
    const guestData = (await guestRes.json()) as {
      user: { id: string; isGuest: boolean; expiresAt: number; locale: string };
      defaultWorkspaceId: string;
      demoWorkspaceId: string;
      demoNotebookId: string;
    };
    expect(guestData.user.isGuest).toBe(true);
    expect(guestData.user.locale).toBe("de");
    expect(guestData.demoWorkspaceId).toBe(DEMO_WORKSPACE_ID);
    expect(guestData.user.expiresAt).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);

    // Check default workspace & demo workspace membership in DB
    const ownRole = await repo.getWorkspaceMemberRole(
      guestData.defaultWorkspaceId,
      guestData.user.id
    );
    expect(ownRole).toBe("owner");

    const demoRole = await repo.getWorkspaceMemberRole(DEMO_WORKSPACE_ID, guestData.user.id);
    expect(demoRole).toBe("viewer");

    const demoNotebook = await repo.getNotebookById(guestData.demoNotebookId);
    expect(demoNotebook?.title).toBe("Willkommen zu RelationNotes");

    // 2. Second guest login re-uses existing demo workspace
    const guest2Res = await app.request("https://api.example.com/api/v1/auth/guest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnstileToken: "token_def" })
    });
    expect(guest2Res.status).toBe(201);
    const guest2Data = (await guest2Res.json()) as {
      demoWorkspaceId: string;
      user: { id: string };
    };
    expect(guest2Data.demoWorkspaceId).toBe(DEMO_WORKSPACE_ID);
    const demoRole2 = await repo.getWorkspaceMemberRole(DEMO_WORKSPACE_ID, guest2Data.user.id);
    expect(demoRole2).toBe("viewer");

    // 3. Failing turnstile token
    const mockTurnstileFail = async () =>
      new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });

    const failApp = new Hono<{ Bindings: Env }>();
    failApp.route(
      "/api/v1/auth",
      createGuestAndMagicLinkRoutes({
        repo,
        sessionManager,
        mailAdapter: consoleMail,
        appBaseUrl: "https://relationnotes.example.com",
        isProduction: false,
        turnstileSecretKey: TURNSTILE_TEST_SECRET_ALWAYS_FAILS,
        customFetch: mockTurnstileFail as unknown as typeof fetch
      })
    );

    const failGuestRes = await failApp.request("https://api.example.com/api/v1/auth/guest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnstileToken: "failing_token" })
    });
    expect(failGuestRes.status).toBe(403);
    expect(((await failGuestRes.json()) as { code: string }).code).toBe("BOT_VERIFICATION_FAILED");

    close();
  });

  it("handles magic-link request, validation, callback login and single-use expiration", async () => {
    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);
    const sessionManager = new SessionManager({ repo, saltSecret: "magic-salt" });
    const consoleMail = new ConsoleMailAdapter();

    const app = new Hono<{ Bindings: Env }>();
    app.route(
      "/api/v1/auth",
      createGuestAndMagicLinkRoutes({
        repo,
        sessionManager,
        mailAdapter: consoleMail,
        appBaseUrl: "https://relationnotes.example.com",
        isProduction: false,
        ...passingTurnstile()
      })
    );

    // 1. Invalid JSON body
    const badJsonRes = await app.request("https://api.example.com/api/v1/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json"
    });
    expect(badJsonRes.status).toBe(400);

    // 2. Invalid email format
    const badEmailRes = await app.request("https://api.example.com/api/v1/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "invalid-email" })
    });
    expect(badEmailRes.status).toBe(400);

    // 3. Turnstile failure on magic-link
    const mockTurnstileFail = async () =>
      new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    const failTurnstileApp = new Hono<{ Bindings: Env }>();
    failTurnstileApp.route(
      "/api/v1/auth",
      createGuestAndMagicLinkRoutes({
        repo,
        sessionManager,
        mailAdapter: consoleMail,
        appBaseUrl: "https://relationnotes.example.com",
        isProduction: false,
        turnstileSecretKey: TURNSTILE_TEST_SECRET_ALWAYS_FAILS,
        customFetch: mockTurnstileFail as unknown as typeof fetch
      })
    );
    const failTurnstileRes = await failTurnstileApp.request(
      "https://api.example.com/api/v1/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "turnstile@example.com", turnstileToken: "bad" })
      }
    );
    expect(failTurnstileRes.status).toBe(403);

    // 4. MailAdapter error
    const failMailAdapter = new ConsoleMailAdapter();
    failMailAdapter.send = async () => ({ success: false, error: "SMTP down" });
    const failMailApp = new Hono<{ Bindings: Env }>();
    failMailApp.route(
      "/api/v1/auth",
      createGuestAndMagicLinkRoutes({
        repo,
        sessionManager,
        mailAdapter: failMailAdapter,
        appBaseUrl: "https://relationnotes.example.com",
        isProduction: false,
        ...passingTurnstile()
      })
    );
    const mailErrRes = await failMailApp.request("https://api.example.com/api/v1/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "user@example.com", turnstileToken: "tok" })
    });
    expect(mailErrRes.status).toBe(500);

    // 5. Successful magic-link dispatch with passing Turnstile token
    const passTurnstileFetch = async () =>
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    const passTurnstileApp = new Hono<{ Bindings: Env }>();
    passTurnstileApp.route(
      "/api/v1/auth",
      createGuestAndMagicLinkRoutes({
        repo,
        sessionManager,
        mailAdapter: consoleMail,
        appBaseUrl: "https://relationnotes.example.com",
        turnstileSecretKey: TURNSTILE_TEST_SECRET_ALWAYS_PASSES,
        customFetch: passTurnstileFetch as unknown as typeof fetch
      })
    );
    const sendRes = await passTurnstileApp.request(
      "https://api.example.com/api/v1/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "bernd@example.com", turnstileToken: "passing_token" })
      }
    );
    expect(sendRes.status).toBe(200);
    expect(consoleMail.lastSentEmail).toBeDefined();

    // Extract token from sent email text
    expect(consoleMail.lastSentEmail).toBeDefined();
    const sentText = consoleMail.lastSentEmail?.text ?? "";
    const tokenMatch = sentText.match(/token=([a-zA-Z0-9_-]+)/);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch?.[1] ?? "";

    // 6. Callback without token parameter -> 400
    const noTokenRes = await app.request("https://api.example.com/api/v1/auth/magic-link/callback");
    expect(noTokenRes.status).toBe(400);

    // 7. Callback with invalid / unknown token -> 401
    const invalidTokenRes = await app.request(
      "https://api.example.com/api/v1/auth/magic-link/callback?token=unknown_token"
    );
    expect(invalidTokenRes.status).toBe(401);

    // 8. Successful Callback login
    const callbackRes = await app.request(
      `https://api.example.com/api/v1/auth/magic-link/callback?token=${token}`,
      {
        headers: { "cf-connecting-ip": "1.2.3.4" }
      }
    );
    expect(callbackRes.status).toBe(200);
    expect(callbackRes.headers.get("set-cookie")).toContain(DEV_SESSION_COOKIE_NAME);
    const callbackData = (await callbackRes.json()) as {
      user: { email: string; isGuest: boolean };
    };
    expect(callbackData.user.email).toBe("bernd@example.com");
    expect(callbackData.user.isGuest).toBe(false);

    // 9. Replay attack: calling same token again -> 401 (single-use enforced)
    const replayRes = await app.request(
      `https://api.example.com/api/v1/auth/magic-link/callback?token=${token}`
    );
    expect(replayRes.status).toBe(401);

    // 10. Existing user login via Magic-Link
    const secondSendRes = await app.request("https://api.example.com/api/v1/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bernd@example.com", turnstileToken: "tok" })
    });
    expect(secondSendRes.status).toBe(200);
    const secondSentText = consoleMail.lastSentEmail?.text ?? "";
    const secondToken = secondSentText.match(/token=([a-zA-Z0-9_-]+)/)?.[1] ?? "";
    const existingUserCallback = await app.request(
      `https://api.example.com/api/v1/auth/magic-link/callback?token=${secondToken}`
    );
    expect(existingUserCallback.status).toBe(200);

    close();
  });

  it("strips trailing slashes from appBaseUrl in the magic-link callback URL", async () => {
    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);
    const sessionManager = new SessionManager({ repo, saltSecret: "magic-salt" });
    const sent: string[] = [];
    const capturingMail = {
      send: async (opts: { text: string }) => {
        sent.push(opts.text);
        return { success: true as const };
      }
    };
    const app = new Hono<{ Bindings: Env }>();
    app.route(
      "/api/v1/auth",
      createGuestAndMagicLinkRoutes({
        repo,
        sessionManager,
        mailAdapter: capturingMail as unknown as ConsoleMailAdapter,
        appBaseUrl: "https://relationnotes.example.com//",
        isProduction: false,
        ...passingTurnstile()
      })
    );
    const res = await app.request("https://api.example.com/api/v1/auth/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "slash@example.com", turnstileToken: "tok" })
    });
    expect(res.status).toBe(200);
    expect(sent[0]).toContain(
      "https://relationnotes.example.com/api/v1/auth/magic-link/callback?token="
    );
    close();
  });
});

describe("Turnstile fail-closed on guest login and magic-link (Issue #233)", () => {
  type Opts = Parameters<typeof createGuestAndMagicLinkRoutes>[0];
  const PROD_LIKE_SECRET = "0x4AAAAAAA-production-like-secret";

  function buildApp(extra: Partial<Opts>): {
    app: Hono<{ Bindings: Env }>;
    repo: CoreRepository;
    mail: ConsoleMailAdapter;
    close: () => void;
  } {
    const { adapter, close } = createSqliteAdapter();
    const repo = new CoreRepository(adapter);
    const mail = new ConsoleMailAdapter();
    const app = new Hono<{ Bindings: Env }>();
    app.route(
      "/api/v1/auth",
      createGuestAndMagicLinkRoutes({
        repo,
        sessionManager: new SessionManager({ repo, saltSecret: "fail-closed-salt" }),
        mailAdapter: mail,
        appBaseUrl: "https://relationnotes.example.com",
        isProduction: false,
        ...extra
      })
    );
    return { app, repo, mail, close };
  }

  const post = (app: Hono<{ Bindings: Env }>, path: string, body: unknown) =>
    app.request(`https://api.example.com/api/v1/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.4" },
      body: JSON.stringify(body)
    });

  async function codeOf(res: Response): Promise<string> {
    return ((await res.json()) as { code: string }).code;
  }

  async function countUsers(repo: CoreRepository): Promise<number> {
    const row = await repo.db.queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM users");
    return Number(row?.n ?? 0);
  }

  it.each([
    ["undefined", undefined],
    ["empty", ""],
    ["whitespace", "   "]
  ])(
    "returns 503 on both routes when the secret is %s and never calls Siteverify",
    async (_label, secret) => {
      const siteverify = createSiteverifyMock(true);
      const { app, repo, mail, close } = buildApp({
        turnstileSecretKey: secret,
        customFetch: siteverify.fetch
      });

      const guest = await post(app, "guest", { turnstileToken: "valid_token" });
      expect(guest.status).toBe(503);
      expect(guest.headers.get("content-type")).toContain("application/problem+json");
      expect(await codeOf(guest)).toBe("TURNSTILE_NOT_CONFIGURED");

      const magic = await post(app, "magic-link", {
        email: "nosecret@example.com",
        turnstileToken: "valid_token"
      });
      expect(magic.status).toBe(503);
      expect(await codeOf(magic)).toBe("TURNSTILE_NOT_CONFIGURED");

      expect(siteverify.calls).toHaveLength(0);
      expect(await countUsers(repo)).toBe(0);
      expect(mail.lastSentEmail).toBeUndefined();
      close();
    }
  );

  it.each([
    ["missing", {}],
    ["empty", { turnstileToken: "" }],
    ["whitespace", { turnstileToken: "  " }],
    ["non-string", { turnstileToken: 42 }]
  ])("returns 403 on both routes when the token is %s", async (_label, tokenPart) => {
    const siteverify = createSiteverifyMock(true);
    const { app, repo, mail, close } = buildApp({
      turnstileSecretKey: TURNSTILE_TEST_SECRET_ALWAYS_PASSES,
      customFetch: siteverify.fetch
    });

    const guest = await post(app, "guest", { ...tokenPart });
    expect(guest.status).toBe(403);
    expect(await codeOf(guest)).toBe("BOT_VERIFICATION_REQUIRED");

    const magic = await post(app, "magic-link", { email: "notoken@example.com", ...tokenPart });
    expect(magic.status).toBe(403);
    expect(await codeOf(magic)).toBe("BOT_VERIFICATION_REQUIRED");

    expect(siteverify.calls).toHaveLength(0);
    expect(await countUsers(repo)).toBe(0);
    expect(mail.lastSentEmail).toBeUndefined();
    close();
  });

  it("returns 403 for a guest request without any JSON body", async () => {
    const { app, close } = buildApp(passingTurnstile());
    const res = await app.request("https://api.example.com/api/v1/auth/guest", { method: "POST" });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("BOT_VERIFICATION_REQUIRED");
    close();
  });

  it("returns 403 when Siteverify rejects the token", async () => {
    const siteverify = createSiteverifyMock(false);
    const { app, repo, mail, close } = buildApp({
      turnstileSecretKey: PROD_LIKE_SECRET,
      customFetch: siteverify.fetch
    });

    const guest = await post(app, "guest", { turnstileToken: "forged" });
    expect(guest.status).toBe(403);
    expect(await codeOf(guest)).toBe("BOT_VERIFICATION_FAILED");

    const magic = await post(app, "magic-link", {
      email: "forged@example.com",
      turnstileToken: "forged"
    });
    expect(magic.status).toBe(403);
    expect(await codeOf(magic)).toBe("BOT_VERIFICATION_FAILED");

    expect(siteverify.calls).toEqual([
      { url: DEFAULT_TURNSTILE_SITEVERIFY_URL, secret: PROD_LIKE_SECRET, response: "forged" },
      { url: DEFAULT_TURNSTILE_SITEVERIFY_URL, secret: PROD_LIKE_SECRET, response: "forged" }
    ]);
    expect(await countUsers(repo)).toBe(0);
    expect(mail.lastSentEmail).toBeUndefined();
    close();
  });

  it("accepts a valid token and sends the configured secret to Siteverify", async () => {
    const siteverify = createSiteverifyMock(true);
    const { app, mail, close } = buildApp({
      turnstileSecretKey: PROD_LIKE_SECRET,
      customFetch: siteverify.fetch
    });

    const guest = await post(app, "guest", { turnstileToken: "good_guest" });
    expect(guest.status).toBe(201);

    const magic = await post(app, "magic-link", {
      email: "good@example.com",
      turnstileToken: "good_magic"
    });
    expect(magic.status).toBe(200);
    expect(mail.lastSentEmail?.to).toBe("good@example.com");

    expect(siteverify.calls.map((call) => [call.secret, call.response])).toEqual([
      [PROD_LIKE_SECRET, "good_guest"],
      [PROD_LIKE_SECRET, "good_magic"]
    ]);
    close();
  });
});
