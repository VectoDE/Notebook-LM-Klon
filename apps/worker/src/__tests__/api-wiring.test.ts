import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreRepository } from "../core-repository.js";
import { createD1DatabaseAdapter } from "../d1-adapter.js";
import { createApp } from "../index.js";
import { createNodeEnv, runSqliteMigrations } from "../node-server.js";
import { RagRepository } from "../rag-repository.js";
import { clearRateLimitMemory } from "../rate-limiter.js";
import { recordQuotaUsage } from "../route-guards.js";
import { SessionManager, computeDailySaltedHash } from "../session.js";

const ORIGIN = "http://localhost:8787";
const KEK = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const TEST_SALT = "test-only-session-salt-api-wiring";

interface Fixture {
  env: Env;
  sqlite: DatabaseSync;
  coreRepo: CoreRepository;
  ragRepo: RagRepository;
  cookies: Record<"alice" | "bob" | "carol" | "mallory", string>;
  dataDir: string;
}

/** In-memory R2 mock that accepts streamed bodies like the real binding. */
function createStreamingR2Mock(): R2Bucket {
  const store = new Map<string, Uint8Array>();
  return {
    put: async (key: string, value: BodyInit) => {
      const data = new Uint8Array(await new Response(value).arrayBuffer());
      store.set(key, data);
      return { key, etag: `"${data.byteLength}"` };
    },
    get: async (key: string) => {
      const data = store.get(key);
      if (!data) return null;
      return {
        key,
        arrayBuffer: async () => data.slice().buffer,
        body: new Response(data).body
      };
    }
  } as unknown as R2Bucket;
}

async function createFixture(extraEnv: Record<string, unknown> = {}): Promise<Fixture> {
  const dataDir = mkdtempSync(join(tmpdir(), "api-wiring-"));
  const sqlite = new DatabaseSync(":memory:");
  runSqliteMigrations(sqlite, resolve(process.cwd(), "apps/worker/migrations"));
  // Explicit test salt: production has no fallback, a missing salt blocks login (503).
  const { env: baseEnv } = createNodeEnv({ db: sqlite, dataDir, sessionSaltSecret: TEST_SALT });
  const env = Object.assign(baseEnv, { MEDIA: createStreamingR2Mock() }, extraEnv) as Env;

  const coreRepo = new CoreRepository(createD1DatabaseAdapter(env.DB));
  const ragRepo = new RagRepository(createD1DatabaseAdapter(env.DB));
  const now = Date.now();

  for (const id of ["alice", "bob", "carol", "mallory"]) {
    await coreRepo.createUser({
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
  // alice owns ws_a/nb_a, bob is workspace viewer, carol has an editor share on nb_a,
  // mallory has no access at all.
  await coreRepo.createWorkspace({ id: "ws_a", name: "A", owner_id: "alice", created_at: now });
  await coreRepo.db.run(
    "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, 'viewer', ?)",
    ["ws_a", "bob", now]
  );
  await coreRepo.createNotebook({
    id: "nb_a",
    workspace_id: "ws_a",
    title: "Notebook A",
    emoji: "book",
    created_by: "alice",
    created_at: now,
    updated_at: now,
    expires_at: null
  });
  await coreRepo.db.run(
    "INSERT INTO notebook_shares (notebook_id, user_id, role, created_at) VALUES (?, ?, 'editor', ?)",
    ["nb_a", "carol", now]
  );

  const sessions = new SessionManager({ repo: coreRepo, saltSecret: TEST_SALT });
  const cookies = {} as Fixture["cookies"];
  for (const id of ["alice", "bob", "carol", "mallory"] as const) {
    const session = await sessions.createSession(id, null, null);
    cookies[id] = `sid=${session.rawToken}`;
  }

  return { env, sqlite, coreRepo, ragRepo, cookies, dataDir };
}

describe("API wiring in index.ts (security chain, auth, RBAC)", () => {
  const app = createApp();
  let fx: Fixture;

  function call(
    path: string,
    init: {
      method?: string;
      cookie?: string;
      json?: unknown;
      body?: BodyInit;
      headers?: Record<string, string>;
    } = {},
    env: Env = fx.env
  ): Promise<Response> {
    const headers: Record<string, string> = { ...init.headers };
    if (init.cookie) headers.cookie = init.cookie;
    let body = init.body;
    if (init.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.json);
    }
    const requestInit: RequestInit = { method: init.method ?? "GET", headers };
    if (body !== undefined) requestInit.body = body;
    return Promise.resolve(app.request(`${ORIGIN}${path}`, requestInit, env));
  }

  beforeEach(async () => {
    clearRateLimitMemory();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network disabled in tests");
      })
    );
    fx = await createFixture();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fx.sqlite.close();
    rmSync(fx.dataDir, { recursive: true, force: true });
  });

  describe("global security chain", () => {
    it("adds security headers to API responses, 404s and Durable Object responses", async () => {
      const health = await call("/api/v1/health");
      expect(health.headers.get("content-security-policy")).toContain("default-src 'self'");
      expect(health.headers.get("x-content-type-options")).toBe("nosniff");
      expect(health.headers.get("x-ratelimit-limit")).toBe("120");

      const unknown = await call("/api/v1/does-not-exist");
      expect(unknown.status).toBe(404);
      expect(((await unknown.json()) as { code: string }).code).toBe("NOT_FOUND");
      expect(unknown.headers.get("strict-transport-security")).toContain("max-age");

      const outside = await call("/not-api");
      expect(outside.status).toBe(404);
      expect(outside.headers.get("cross-origin-opener-policy")).toBe("same-origin");

      const jobs = await call("/api/v1/jobs?notebookId=nb_a", { cookie: fx.cookies.alice });
      expect(jobs.status).toBe(200);
      expect(jobs.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    });

    it("rejects cross-site and foreign-origin mutations before any route (CSRF)", async () => {
      const crossSite = await call("/api/v1/auth/guest", {
        method: "POST",
        json: {},
        headers: { "sec-fetch-site": "cross-site" }
      });
      expect(crossSite.status).toBe(403);
      expect(((await crossSite.json()) as { code: string }).code).toBe("CSRF_CROSS_SITE_FORBIDDEN");

      const foreign = await call("/api/v1/notebooks/nb_a/sources", {
        method: "POST",
        cookie: fx.cookies.alice,
        json: { filename: "a.pdf", mimeType: "application/pdf", byteSize: 10 },
        headers: { origin: "https://evil.example" }
      });
      expect(foreign.status).toBe(403);
      expect(((await foreign.json()) as { code: string }).code).toBe("CSRF_ORIGIN_FORBIDDEN");

      const sameOrigin = await call("/api/v1/notebooks/nb_a/sources", {
        method: "POST",
        cookie: fx.cookies.alice,
        json: { filename: "a.pdf", mimeType: "application/pdf", byteSize: 10 },
        headers: { origin: ORIGIN }
      });
      expect(sameOrigin.status).toBe(201);
    });

    it("rate-limits the auth category (5 requests per minute)", async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await call("/api/v1/auth/magic-link", {
          method: "POST",
          json: { email: "invalid" },
          headers: { "cf-connecting-ip": "203.0.113.7" }
        });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
      expect(statuses[5]).toBe(429);
    });

    it("passes a real execution context through to the API app", async () => {
      const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} };
      const res = await app.fetch(
        new Request(`${ORIGIN}/api/v1/demo/info`),
        fx.env,
        ctx as unknown as ExecutionContext
      );
      expect(res.status).toBeLessThan(500);
    });
  });

  describe("auth routes (public)", () => {
    /** Fixture with TURNSTILE_SECRET_KEY and a Siteverify stub that accepts every token. */
    async function withTurnstile(): Promise<Fixture> {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input).includes("turnstile")) {
            return Response.json({ success: true });
          }
          throw new Error("network disabled in tests");
        })
      );
      return createFixture({ TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" });
    }

    function disposeFixture(other: Fixture): void {
      other.sqlite.close();
      rmSync(other.dataDir, { recursive: true, force: true });
    }

    it("fails closed with 503 on guest and magic-link when TURNSTILE_SECRET_KEY is missing", async () => {
      const guest = await call("/api/v1/auth/guest", {
        method: "POST",
        json: { turnstileToken: "tok" }
      });
      expect(guest.status).toBe(503);
      expect(((await guest.json()) as { code: string }).code).toBe("TURNSTILE_NOT_CONFIGURED");

      const magic = await call("/api/v1/auth/magic-link", {
        method: "POST",
        json: { email: "user@example.test", turnstileToken: "tok" }
      });
      expect(magic.status).toBe(503);
      expect(((await magic.json()) as { code: string }).code).toBe("TURNSTILE_NOT_CONFIGURED");
    });

    it("creates a guest session that unlocks protected routes", async () => {
      const turnstileFx = await withTurnstile();
      const res = await call(
        "/api/v1/auth/guest",
        { method: "POST", json: { turnstileToken: "tok" } },
        turnstileFx.env
      );
      expect(res.status).toBe(201);
      const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
      expect(cookie).toMatch(/^sid=/);
      const body = (await res.json()) as { demoNotebookId: string };

      const jobs = await call(
        `/api/v1/jobs?notebookId=${body.demoNotebookId}`,
        { cookie },
        turnstileFx.env
      );
      expect(jobs.status).toBe(200);
      disposeFixture(turnstileFx);
    });

    it("rejects a guest login without a Turnstile token", async () => {
      const turnstileFx = await withTurnstile();
      const res = await call("/api/v1/auth/guest", { method: "POST", json: {} }, turnstileFx.env);
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe("BOT_VERIFICATION_REQUIRED");
      disposeFixture(turnstileFx);
    });

    it("reports a mail delivery error when no mail provider is configured", async () => {
      const turnstileFx = await withTurnstile();
      const res = await call(
        "/api/v1/auth/magic-link",
        { method: "POST", json: { email: "user@example.test", turnstileToken: "tok" } },
        turnstileFx.env
      );
      expect(res.status).toBe(500);
      expect(((await res.json()) as { code: string }).code).toBe("EMAIL_DELIVERY_FAILED");
      disposeFixture(turnstileFx);
    });

    it("sends the magic link via Resend and uses configured Turnstile/salt secrets", async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("turnstile")) {
          return Response.json({ success: true });
        }
        return Response.json({ id: "mail_1" });
      });
      vi.stubGlobal("fetch", fetchMock);
      const mailFx = await createFixture({
        RESEND_API_KEY: "re_test",
        MAIL_FROM: "noreply@example.test",
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
        SESSION_SALT_SECRET: "salt"
      });
      const res = await call(
        "/api/v1/auth/magic-link",
        { method: "POST", json: { email: "user@example.test", turnstileToken: "tok" } },
        mailFx.env
      );
      mailFx.sqlite.close();
      rmSync(mailFx.dataDir, { recursive: true, force: true });
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.resend.com/emails",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("rejects invalid magic-link callbacks", async () => {
      expect((await call("/api/v1/auth/magic-link/callback")).status).toBe(400);
      expect((await call("/api/v1/auth/magic-link/callback?token=nope")).status).toBe(401);
    });

    it("requires a session for passkey registration but not for login options", async () => {
      const register = await call("/api/v1/auth/passkey/register/options", { method: "POST" });
      expect(register.status).toBe(401);
      const login = await call("/api/v1/auth/passkey/login/options", { method: "POST" });
      expect(login.status).toBe(200);
      expect(((await login.json()) as { rpId?: string }).rpId).toBe("localhost");
    });
  });

  describe("chat", () => {
    const chatBody = { message: "Was steht im Notebook?" };

    it("requires a session and notebook access", async () => {
      const anon = await call("/api/v1/notebooks/nb_a/chat", { method: "POST", json: chatBody });
      expect(anon.status).toBe(401);
      const foreign = await call("/api/v1/notebooks/nb_a/chat", {
        method: "POST",
        cookie: fx.cookies.mallory,
        json: chatBody
      });
      expect(foreign.status).toBe(404);
    });

    it("streams for a viewer and records the LLM quota usage", async () => {
      const res = await call("/api/v1/notebooks/nb_a/chat", {
        method: "POST",
        cookie: fx.cookies.bob,
        json: chatBody
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      expect(res.headers.get("content-security-policy")).toBeTruthy();
      await res.text();
      const quota = fx.sqlite
        .prepare("SELECT llm_calls_day FROM quotas WHERE user_id = ?")
        .get("bob") as { llm_calls_day: number };
      expect(quota.llm_calls_day).toBe(1);
    });

    it("blocks the call when the daily LLM quota is exhausted", async () => {
      fx.sqlite
        .prepare(
          "INSERT INTO quotas (user_id, notebooks_count, sources_count, storage_bytes, llm_calls_day, quota_day) VALUES (?, 0, 0, 0, 50, ?)"
        )
        .run("bob", new Date().toISOString().slice(0, 10));
      const res = await call("/api/v1/notebooks/nb_a/chat", {
        method: "POST",
        cookie: fx.cookies.bob,
        json: chatBody
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe("QUOTA_MAX_LLM_CALLS_EXCEEDED");
    });

    it("serves chat history only with a session", async () => {
      await fx.ragRepo.createChat({
        id: "chat_1",
        notebook_id: "nb_a",
        user_id: "alice",
        title: "t",
        model_used: "auto",
        created_at: 1,
        updated_at: 1
      });
      expect((await call("/api/v1/chats/chat_1/messages")).status).toBe(401);
      const res = await call("/api/v1/chats/chat_1/messages", { cookie: fx.cookies.alice });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { chatId: string }).chatId).toBe("chat_1");
    });
  });

  describe("search and audio", () => {
    it("search: 401 without session, 404 without access, 200 for a viewer", async () => {
      const json = { query: "Notebook" };
      expect((await call("/api/v1/notebooks/nb_a/search", { method: "POST", json })).status).toBe(
        401
      );
      expect(
        (
          await call("/api/v1/notebooks/nb_a/search", {
            method: "POST",
            json,
            cookie: fx.cookies.mallory
          })
        ).status
      ).toBe(404);
      const ok = await call("/api/v1/notebooks/nb_a/search", {
        method: "POST",
        json,
        cookie: fx.cookies.bob
      });
      expect(ok.status).toBe(200);
      expect(((await ok.json()) as { notebookId: string }).notebookId).toBe("nb_a");
    });

    it("audio-interject: 401/404 at the guard, viewer reaches validation", async () => {
      const path = "/api/v1/notebooks/nb_a/audio-interject";
      expect((await call(path, { method: "POST", json: {} })).status).toBe(401);
      expect(
        (await call(path, { method: "POST", json: {}, cookie: fx.cookies.mallory })).status
      ).toBe(404);
      expect((await call(path, { method: "POST", json: {}, cookie: fx.cookies.bob })).status).toBe(
        422
      );
    });
  });

  describe("sources", () => {
    const pdfInit = { filename: "a.pdf", mimeType: "application/pdf", byteSize: 9 };

    it("upload init: 401 anonymous, 403 for viewers, 201 for owner and shared editor", async () => {
      const path = "/api/v1/notebooks/nb_a/sources";
      expect((await call(path, { method: "POST", json: pdfInit })).status).toBe(401);
      const viewer = await call(path, { method: "POST", json: pdfInit, cookie: fx.cookies.bob });
      expect(viewer.status).toBe(403);
      expect(((await viewer.json()) as { code: string }).code).toBe("INSUFFICIENT_ROLE");
      expect(
        (await call(path, { method: "POST", json: pdfInit, cookie: fx.cookies.alice })).status
      ).toBe(201);
      expect(
        (await call(path, { method: "POST", json: pdfInit, cookie: fx.cookies.carol })).status
      ).toBe(201);
      const quota = fx.sqlite
        .prepare("SELECT sources_count FROM quotas WHERE user_id = ?")
        .get("alice") as { sources_count: number };
      expect(quota.sources_count).toBe(1);
    });

    it("upload init: quota and body validation still apply behind the guard", async () => {
      const path = "/api/v1/notebooks/nb_a/sources";
      const tooBig = await call(path, {
        method: "POST",
        cookie: fx.cookies.alice,
        json: { ...pdfInit, byteSize: 51 * 1024 * 1024 }
      });
      expect(tooBig.status).toBe(403);
      expect(((await tooBig.json()) as { code: string }).code).toBe(
        "QUOTA_MAX_SOURCE_BYTES_EXCEEDED"
      );
      const invalidJson = await call(path, {
        method: "POST",
        cookie: fx.cookies.alice,
        body: "{",
        headers: { "content-type": "application/json" }
      });
      expect(invalidJson.status).toBe(400);
      const noSize = await call(path, {
        method: "POST",
        cookie: fx.cookies.alice,
        json: { filename: "a.pdf", mimeType: "application/pdf" }
      });
      expect(noSize.status).toBe(413);
    });

    it("upload, complete and download are bound to the source's notebook role", async () => {
      const init = await call("/api/v1/notebooks/nb_a/sources", {
        method: "POST",
        cookie: fx.cookies.alice,
        json: pdfInit
      });
      const { sourceId } = (await init.json()) as { sourceId: string };
      const uploadPath = `/api/v1/sources/${sourceId}/upload`;
      const pdf = "%PDF-1.7";

      expect((await call(uploadPath, { method: "PUT", body: pdf })).status).toBe(401);
      expect(
        (await call(uploadPath, { method: "PUT", body: pdf, cookie: fx.cookies.mallory })).status
      ).toBe(404);
      expect(
        (await call(uploadPath, { method: "PUT", body: pdf, cookie: fx.cookies.bob })).status
      ).toBe(403);
      expect(
        (
          await call(uploadPath, {
            method: "PUT",
            body: pdf,
            cookie: fx.cookies.alice,
            headers: { "content-length": String(pdf.length) }
          })
        ).status
      ).toBe(200);

      const completePath = `${uploadPath}/complete`;
      expect((await call(completePath, { method: "POST", cookie: fx.cookies.bob })).status).toBe(
        403
      );
      const complete = await call(completePath, { method: "POST", cookie: fx.cookies.alice });
      expect(complete.status).toBe(200);
      expect(((await complete.json()) as { status: string }).status).toBe("ready");

      const filePath = `/api/v1/sources/${sourceId}/file`;
      expect((await call(filePath)).status).toBe(401);
      expect((await call(filePath, { cookie: fx.cookies.mallory })).status).toBe(404);
      const download = await call(filePath, { cookie: fx.cookies.bob });
      expect(download.status).toBe(200);
      expect(await download.text()).toBe(pdf);

      const missing = await call("/api/v1/sources/unknown/file", { cookie: fx.cookies.alice });
      expect(missing.status).toBe(404);
      expect(((await missing.json()) as { code: string }).code).toBe("SOURCE_NOT_FOUND");
    });

    it("url import: 401 anonymous, 403 viewer, editor reaches validation", async () => {
      const path = "/api/v1/notebooks/nb_a/sources/url";
      const json = { url: "not-a-url" };
      expect((await call(path, { method: "POST", json })).status).toBe(401);
      expect((await call(path, { method: "POST", json, cookie: fx.cookies.bob })).status).toBe(403);
      const editor = await call(path, { method: "POST", json, cookie: fx.cookies.alice });
      expect(editor.status).toBe(400);
      expect(((await editor.json()) as { code: string }).code).toBe("VALIDATION_FAILED");
    });
  });

  describe("providers", () => {
    it("serves the catalog publicly and protects the Ollama probe", async () => {
      const catalog = await call("/api/v1/providers");
      expect(catalog.status).toBe(200);
      const route = await call("/api/v1/providers/route", { method: "POST", json: {} });
      expect(route.status).toBe(200);
      expect((await call("/api/v1/providers/ollama/probe")).status).toBe(401);
      const probe = await call("/api/v1/providers/ollama/probe", { cookie: fx.cookies.alice });
      expect(probe.status).not.toBe(401);
    });
  });

  describe("jobs", () => {
    it("enqueue: 401 anonymous, 404 foreign notebook, 200 with access", async () => {
      const json = { notebookId: "nb_a", kind: "mindmap" };
      expect((await call("/api/v1/jobs/enqueue", { method: "POST", json })).status).toBe(401);
      expect(
        (await call("/api/v1/jobs/enqueue", { method: "POST", json, cookie: fx.cookies.mallory }))
          .status
      ).toBe(404);
      expect(
        (await call("/api/v1/jobs/enqueue", { method: "POST", json, cookie: fx.cookies.alice }))
          .status
      ).toBe(200);
    });

    it("list: requires session, notebookId and notebook access", async () => {
      expect((await call("/api/v1/jobs?notebookId=nb_a")).status).toBe(401);
      expect((await call("/api/v1/jobs", { cookie: fx.cookies.alice })).status).toBe(400);
      expect(
        (await call("/api/v1/jobs?notebookId=nb_missing", { cookie: fx.cookies.alice })).status
      ).toBe(404);
      expect(
        (await call("/api/v1/jobs?notebookId=nb_a", { cookie: fx.cookies.mallory })).status
      ).toBe(404);
      expect((await call("/api/v1/jobs?notebookId=nb_a", { cookie: fx.cookies.bob })).status).toBe(
        200
      );
    });

    it("does not expose job status/cancel without an ownership check", async () => {
      const status = await call("/api/v1/jobs/job_1", { cookie: fx.cookies.alice });
      expect(status.status).toBe(501);
      expect(((await status.json()) as { code: string }).code).toBe("ENDPOINT_NOT_EXPOSED");
      const cancel = await call("/api/v1/jobs/job_1/cancel", {
        method: "POST",
        cookie: fx.cookies.alice
      });
      expect(cancel.status).toBe(501);
    });
  });

  describe("BYOK keys", () => {
    it("requires a session and refuses to run without a configured KEK", async () => {
      expect((await call("/api/v1/keys")).status).toBe(401);
      expect((await call("/api/v1/keys/google", { method: "DELETE" })).status).toBe(401);
      const noKek = await call("/api/v1/keys", { cookie: fx.cookies.alice });
      expect(noKek.status).toBe(503);
      expect(((await noKek.json()) as { code: string }).code).toBe("BYOK_NOT_CONFIGURED");
    });

    it("lists keys for an authenticated user when a KEK is configured", async () => {
      const kekFx = await createFixture({ KEK_V1: KEK });
      const res = await call("/api/v1/keys", { cookie: kekFx.cookies.alice }, kekFx.env);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { keys: unknown[] }).keys).toEqual([]);
      kekFx.sqlite.close();
      rmSync(kekFx.dataDir, { recursive: true, force: true });
    });
  });

  describe("SESSION_SALT_SECRET (fail-closed, no fallback)", () => {
    async function codeOf(res: Response): Promise<string> {
      return ((await res.json()) as { code: string }).code;
    }

    it.each([undefined, "", "   "])(
      "blocks every session-creating route with 503 when the salt is %j",
      async (salt) => {
        const noSaltFx = await createFixture({
          SESSION_SALT_SECRET: salt,
          TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
          KEK_V1: KEK
        });
        const requests: Array<[string, { method?: string; json?: unknown; cookie?: string }]> = [
          ["/api/v1/auth/guest", { method: "POST", json: { turnstileToken: "tok" } }],
          [
            "/api/v1/auth/magic-link",
            { method: "POST", json: { email: "user@example.test", turnstileToken: "tok" } }
          ],
          ["/api/v1/auth/magic-link/callback?token=abc", {}],
          ["/api/v1/auth/passkey/login/options", { method: "POST", json: {} }],
          ["/api/v1/auth/passkey/login/verify", { method: "POST", json: {} }],
          ["/api/v1/keys", { cookie: noSaltFx.cookies.alice }],
          ["/api/v1/keys/google", { method: "DELETE", cookie: noSaltFx.cookies.alice }]
        ];
        for (const [path, init] of requests) {
          const res = await call(path, init, noSaltFx.env);
          expect(res.status, path).toBe(503);
          expect(await codeOf(res), path).toBe("SESSION_SALT_NOT_CONFIGURED");
        }
        // Routes without session creation stay available.
        expect((await call("/api/v1/health", {}, noSaltFx.env)).status).toBeLessThan(600);
        expect((await call("/api/v1/demo/info", {}, noSaltFx.env)).status).toBeLessThan(500);
        noSaltFx.sqlite.close();
        rmSync(noSaltFx.dataDir, { recursive: true, force: true });
      }
    );

    it("hashes the session IP with the configured secret, not with an origin-derived salt", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ success: true }))
      );
      const saltFx = await createFixture({
        SESSION_SALT_SECRET: "configured-secret-salt",
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA"
      });
      const res = await call(
        "/api/v1/auth/guest",
        {
          method: "POST",
          json: { turnstileToken: "tok" },
          headers: { "cf-connecting-ip": "198.51.100.23" }
        },
        saltFx.env
      );
      expect(res.status).toBe(201);
      const row = await saltFx.coreRepo.db.queryOne<{ ip_hash: string | null }>(
        "SELECT s.ip_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.is_guest = 1"
      );
      expect(row?.ip_hash).toBe(
        await computeDailySaltedHash("198.51.100.23", "configured-secret-salt")
      );
      expect(row?.ip_hash).not.toBe(
        await computeDailySaltedHash("198.51.100.23", `relationnotes-session:${ORIGIN}`)
      );
      saltFx.sqlite.close();
      rmSync(saltFx.dataDir, { recursive: true, force: true });
    });
  });

  describe("production origin", () => {
    it("accepts the configured https origin and rejects others", async () => {
      const prodFx = await createFixture({ APP_ORIGIN: "https://notes.example" });
      const allowed = await call(
        "/api/v1/notebooks/nb_a/sources",
        {
          method: "POST",
          cookie: prodFx.cookies.alice,
          json: pdfInitProd,
          headers: { origin: "https://notes.example" }
        },
        prodFx.env
      );
      expect(allowed.status).toBe(201);
      const denied = await call(
        "/api/v1/notebooks/nb_a/sources",
        {
          method: "POST",
          cookie: prodFx.cookies.alice,
          json: pdfInitProd,
          headers: { origin: "https://other.example" }
        },
        prodFx.env
      );
      expect(denied.status).toBe(403);
      prodFx.sqlite.close();
      rmSync(prodFx.dataDir, { recursive: true, force: true });
    });
  });
});

const pdfInitProd = { filename: "p.pdf", mimeType: "application/pdf", byteSize: 9 };

describe("recordQuotaUsage", () => {
  it("does not touch the database when the resolver yields no action", async () => {
    const prepare = vi.fn();
    const app = new Hono<{ Bindings: Env }>();
    app.use("*", async (c, next) => {
      c.set("sessionUser", {
        id: "u1",
        email: null,
        displayName: "u1",
        locale: "de",
        isGuest: false
      });
      await next();
    });
    app.post(
      "/x",
      recordQuotaUsage(() => null),
      (c) => c.json({ ok: true })
    );
    const res = await app.request("/x", { method: "POST" }, { DB: { prepare } } as unknown as Env);
    expect(res.status).toBe(200);
    expect(prepare).not.toHaveBeenCalled();
  });
});
