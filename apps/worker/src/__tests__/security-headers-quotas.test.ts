import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveAppConfig } from "../config.js";
import {
  type QuotaAction,
  getOrInitUserQuota,
  incrementUserQuota,
  quotaGuardMiddleware,
  verifyQuotaAction
} from "../quota-guard.js";
import {
  checkRateLimit,
  clearRateLimitMemory,
  extractClientIdentifier,
  rateLimiterMiddleware,
  resolveCategoryFromPath
} from "../rate-limiter.js";
import {
  COOP_HEADER_VALUE,
  CORP_HEADER_VALUE,
  CSP_HEADER_VALUE,
  HSTS_HEADER_VALUE,
  PERMISSIONS_POLICY_VALUE,
  REFERRER_POLICY_VALUE,
  X_CONTENT_TYPE_OPTIONS_VALUE,
  applySecurityHeaders,
  securityHeadersMiddleware
} from "../security-headers.js";

/**
 * Creates an in-memory SQLite wrapper mocking Cloudflare D1.
 */
function createMockD1(): { db: D1Database; close: () => void } {
  const sqlite = new DatabaseSync(":memory:");
  const migrationPath = resolve(process.cwd(), "apps/worker/migrations/0001_initial_core.sql");
  const sql = readFileSync(migrationPath, "utf-8");
  sqlite.exec(sql);
  sqlite.exec(
    readFileSync(resolve(process.cwd(), "apps/worker/migrations/0002_rag_and_studio.sql"), "utf-8")
  );

  const db: unknown = {
    prepare(query: string) {
      let boundParams: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          boundParams = args;
          return this;
        },
        async first<T = unknown>(): Promise<T | null> {
          const stmt = sqlite.prepare(query);
          const row = stmt.get(...(boundParams as (string | number | bigint | null)[]));
          return (row as T) ?? null;
        },
        async all<T = unknown>(): Promise<{ results: T[] }> {
          const stmt = sqlite.prepare(query);
          const results = stmt.all(...(boundParams as (string | number | bigint | null)[])) as T[];
          return { results };
        },
        async run(): Promise<{ meta: { changes: number } }> {
          const stmt = sqlite.prepare(query);
          const info = stmt.run(...(boundParams as (string | number | bigint | null)[]));
          return { meta: { changes: Number(info.changes) } };
        }
      };
    }
  };

  return { db: db as D1Database, close: () => sqlite.close() };
}

/**
 * Seeds a user, workspace and notebook plus `count` sources of `bytesEach` bytes
 * (metadata only, no real files).
 */
async function seedNotebookWithSources(
  db: D1Database,
  userId: string,
  notebookId: string,
  count: number,
  bytesEach: number
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      "INSERT INTO users (id, display_name, locale, is_guest, created_at) VALUES (?, 'Seed', 'de', 0, ?)"
    )
    .bind(userId, now)
    .run();
  await db
    .prepare("INSERT INTO workspaces (id, name, owner_id, created_at) VALUES (?, 'WS', ?, ?)")
    .bind(`ws_${notebookId}`, userId, now)
    .run();
  await db
    .prepare(
      "INSERT INTO notebooks (id, workspace_id, title, emoji, created_by, created_at, updated_at) VALUES (?, ?, 'NB', '', ?, ?, ?)"
    )
    .bind(notebookId, `ws_${notebookId}`, userId, now, now)
    .run();
  for (let i = 0; i < count; i++) {
    await db
      .prepare(
        `INSERT INTO sources (id, notebook_id, title, original_name, mime_type, source_type, byte_size, status, created_at, updated_at)
         VALUES (?, ?, 't', 't', 'application/pdf', 'pdf', ?, 'ready', ?, ?)`
      )
      .bind(`${notebookId}_s${i}`, notebookId, bytesEach, now, now)
      .run();
  }
}

describe("Security Headers (Sub-Issue #77)", () => {
  it("sets all required strict security headers correctly via applySecurityHeaders", () => {
    const headers = new Headers();
    applySecurityHeaders(headers);

    expect(headers.get("Content-Security-Policy")).toBe(CSP_HEADER_VALUE);
    expect(headers.get("Strict-Transport-Security")).toBe(HSTS_HEADER_VALUE);
    expect(headers.get("X-Content-Type-Options")).toBe(X_CONTENT_TYPE_OPTIONS_VALUE);
    expect(headers.get("Referrer-Policy")).toBe(REFERRER_POLICY_VALUE);
    expect(headers.get("Permissions-Policy")).toBe(PERMISSIONS_POLICY_VALUE);
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe(COOP_HEADER_VALUE);
    expect(headers.get("Cross-Origin-Resource-Policy")).toBe(CORP_HEADER_VALUE);
  });

  it("applies headers via Hono securityHeadersMiddleware to responses", async () => {
    const app = new Hono();
    app.use("*", securityHeadersMiddleware());
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request("http://localhost/test");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(res.headers.get("strict-transport-security")).toBe(
      "max-age=63072000; includeSubDomains; preload"
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(self), geolocation=(), interest-cohort=()"
    );
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });
});

describe("Rate Limiting (Sub-Issue #78)", () => {
  beforeEach(() => {
    clearRateLimitMemory();
  });

  it("resolves route categories accurately", () => {
    expect(resolveCategoryFromPath("/api/v1/auth/passkey/register")).toBe("auth");
    expect(resolveCategoryFromPath("/api/v1/auth/magic-link")).toBe("auth");
    expect(resolveCategoryFromPath("/api/v1/chat/message")).toBe("chat");
    expect(resolveCategoryFromPath("/api/v1/notebook/ask")).toBe("chat");
    expect(resolveCategoryFromPath("/api/v1/sources/file/upload")).toBe("uploads");
    expect(resolveCategoryFromPath("/api/v1/health")).toBe("general");
  });

  it("extracts client identifiers accurately from headers or context", () => {
    const c1 = {
      get: () => ({ id: "user_42" }),
      req: { header: () => undefined }
    } as unknown as Parameters<typeof extractClientIdentifier>[0];
    expect(extractClientIdentifier(c1)).toBe("usr:user_42");

    const c2 = {
      get: () => undefined,
      req: {
        header: (name: string) => (name === "cf-connecting-ip" ? "1.2.3.4" : undefined)
      }
    } as unknown as Parameters<typeof extractClientIdentifier>[0];
    expect(extractClientIdentifier(c2)).toBe("ip:1.2.3.4");

    const c3 = {
      get: () => undefined,
      req: {
        header: (name: string) => (name === "x-forwarded-for" ? "5.6.7.8, 9.10.11.12" : undefined)
      }
    } as unknown as Parameters<typeof extractClientIdentifier>[0];
    expect(extractClientIdentifier(c3)).toBe("ip:5.6.7.8");

    const cXffEmpty = {
      get: () => undefined,
      req: {
        header: (name: string) => (name === "x-forwarded-for" ? "   " : undefined)
      }
    } as unknown as Parameters<typeof extractClientIdentifier>[0];
    expect(extractClientIdentifier(cXffEmpty)).toBe("ip:127.0.0.1");

    const c4 = {
      get: () => undefined,
      req: {
        header: () => undefined
      }
    } as unknown as Parameters<typeof extractClientIdentifier>[0];
    expect(extractClientIdentifier(c4)).toBe("ip:127.0.0.1");
  });

  it("enforces in-memory limits and blocks with 429 when limit is reached", async () => {
    const config = { limit: 3, windowMs: 10_000 };
    const key = "test:bucket1";

    const r1 = await checkRateLimit(key, config);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = await checkRateLimit(key, config);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await checkRateLimit(key, config);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    const r4 = await checkRateLimit(key, config);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("falls back to D1 storage if provided, including count exceeding limit and null responses", async () => {
    const { db, close } = createMockD1();
    const config = { limit: 2, windowMs: 60_000 };
    const key = "test:d1_bucket";

    // First call
    const r1 = await checkRateLimit(key, config, db);
    expect(r1.allowed).toBe(true);

    // Second call
    const r2 = await checkRateLimit(key, config, db);
    expect(r2.allowed).toBe(true);

    // Third call - limit exceeded in D1
    clearRateLimitMemory(); // Clear memory to force D1 path
    await db.prepare("UPDATE rate_limits SET count = 5 WHERE bucket = ?").bind(key).run();
    const r3 = await checkRateLimit(key, config, db);
    expect(r3.allowed).toBe(false);
    expect(r3.retryAfterSeconds).toBeGreaterThan(0);

    // D1 returning empty row (null)
    const nullDb: unknown = {
      prepare() {
        return {
          bind() {
            return this;
          },
          async first() {
            return null;
          }
        };
      }
    };
    clearRateLimitMemory();
    const rNull = await checkRateLimit("null_key", config, nullDb as D1Database);
    expect(rNull.allowed).toBe(true);
    expect(rNull.remaining).toBe(1);

    // Test D1 error resilience / fallback
    const faultyDb: unknown = {
      prepare() {
        throw new Error("D1 connection lost");
      }
    };
    clearRateLimitMemory();
    const rFallback = await checkRateLimit("fallback_key", config, faultyDb as D1Database);
    expect(rFallback.allowed).toBe(true);

    close();
  });

  it("serves RFC 9457 Problem Details and Retry-After header on 429 in Hono middleware", async () => {
    // 1. App without explicit options (tests default category and keyExtractor branches)
    const defaultApp = new Hono();
    defaultApp.use("/api/v1/auth/default-login", rateLimiterMiddleware());
    defaultApp.post("/api/v1/auth/default-login", (c) => c.text("ok"));

    const defRes = await defaultApp.request("http://localhost/api/v1/auth/default-login", {
      method: "POST"
    });
    expect(defRes.status).toBe(200);

    const app = new Hono();
    // Rule with custom keyExtractor
    app.use(
      "/api/v1/auth/login",
      rateLimiterMiddleware({
        category: "auth",
        keyExtractor: (c) => c.req.header("cf-connecting-ip") ?? "default-ip"
      })
    );
    app.post("/api/v1/auth/login", (c) => c.text("ok"));

    const clientHeaders = { "cf-connecting-ip": "198.51.100.1" };

    // Limit is 5
    for (let i = 0; i < 5; i++) {
      const res = await app.request("http://localhost/api/v1/auth/login", {
        method: "POST",
        headers: clientHeaders
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
    }

    // 6th request must yield 429
    const blockedRes = await app.request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: clientHeaders
    });
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get("content-type")).toContain("application/problem+json");
    expect(blockedRes.headers.get("Retry-After")).toBeDefined();

    const body = (await blockedRes.json()) as {
      status: number;
      title: string;
      code: string;
      detail: string;
    };
    expect(body.status).toBe(429);
    expect(body.title).toBe("Too Many Requests");
    expect(body.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(body.detail).toContain("5 Requests / Minute");
  });
});

describe("Quota Guard (Sub-Issue #79)", () => {
  it("initializes user quota in D1 and handles UTC day rollover", async () => {
    const { db, close } = createMockD1();

    await db
      .prepare(
        "INSERT INTO users (id, display_name, locale, is_guest, created_at) VALUES ('u1', 'User 1', 'de', 0, ?)"
      )
      .bind(Date.now())
      .run();

    const d1 = new Date("2026-11-09T10:00:00Z");
    const q1 = await getOrInitUserQuota(db, "u1", d1);
    expect(q1.userId).toBe("u1");
    expect(q1.notebooksCount).toBe(0);
    expect(q1.llmCallsDay).toBe(0);
    expect(q1.quotaDay).toBe("2026-11-09");

    // Increment LLM call
    await incrementUserQuota(db, "u1", { type: "llm_call" }, d1);
    const q2 = await getOrInitUserQuota(db, "u1", d1);
    expect(q2.llmCallsDay).toBe(1);

    // Next day rollover
    const d2 = new Date("2026-11-10T02:00:00Z");
    const q3 = await getOrInitUserQuota(db, "u1", d2);
    expect(q3.quotaDay).toBe("2026-11-10");
    expect(q3.llmCallsDay).toBe(0); // Successfully reset!

    close();
  });

  it("enforces notebook count quota (maxNotebooksPerUser)", async () => {
    const { db, close } = createMockD1();
    await db
      .prepare(
        "INSERT INTO users (id, display_name, locale, is_guest, created_at) VALUES ('u2', 'User 2', 'de', 0, ?)"
      )
      .bind(Date.now())
      .run();

    const config = resolveAppConfig({ APP_PROFILE: "demo" }); // maxNotebooksPerUser = 3
    const action: QuotaAction = { type: "create_notebook" };

    // Allow 3 notebooks
    for (let i = 0; i < 3; i++) {
      const check = await verifyQuotaAction(db, "u2", action, config.quotas);
      expect(check.allowed).toBe(true);
      await incrementUserQuota(db, "u2", action);
    }

    // 4th notebook blocked
    const denied = await verifyQuotaAction(db, "u2", action, config.quotas);
    expect(denied.allowed).toBe(false);
    expect(denied.code).toBe("QUOTA_MAX_NOTEBOOKS_EXCEEDED");

    close();
  });

  it("enforces max source bytes per file (demo: 50 MB, 50 MB + 1 byte denied)", async () => {
    const { db, close } = createMockD1();
    const config = resolveAppConfig({ APP_PROFILE: "demo" });
    const mb = 1024 * 1024;
    await db
      .prepare(
        "INSERT INTO users (id, display_name, locale, is_guest, created_at) VALUES ('u3', 'User 3', 'de', 0, ?)"
      )
      .bind(Date.now())
      .run();

    const atLimit = await verifyQuotaAction(
      db,
      "u3",
      { type: "add_source", notebookId: "nb1", byteSize: 50 * mb },
      config.quotas
    );
    expect(atLimit.allowed).toBe(true);

    const over = await verifyQuotaAction(
      db,
      "u3",
      { type: "add_source", notebookId: "nb1", byteSize: 50 * mb + 1 },
      config.quotas
    );
    expect(over.allowed).toBe(false);
    expect(over.code).toBe("QUOTA_MAX_SOURCE_BYTES_EXCEEDED");

    close();
  });

  it("enforces max 50 sources per notebook in the demo profile", async () => {
    const { db, close } = createMockD1();
    const config = resolveAppConfig({ APP_PROFILE: "demo" });
    await seedNotebookWithSources(db, "u5", "nb_count", 49, 1);
    const action: QuotaAction = { type: "add_source", notebookId: "nb_count", byteSize: 1 };

    // 49 existing sources: the 50th is allowed
    expect((await verifyQuotaAction(db, "u5", action, config.quotas)).allowed).toBe(true);

    // 50 existing sources: the 51st is denied
    await db
      .prepare(
        `INSERT INTO sources (id, notebook_id, title, original_name, mime_type, source_type, byte_size, status, created_at, updated_at)
         VALUES ('nb_count_s49', 'nb_count', 't', 't', 'application/pdf', 'pdf', 1, 'ready', 1, 1)`
      )
      .run();
    const denied = await verifyQuotaAction(db, "u5", action, config.quotas);
    expect(denied.allowed).toBe(false);
    expect(denied.code).toBe("QUOTA_MAX_SOURCES_PER_NOTEBOOK_EXCEEDED");

    // Another notebook of the same user is not affected by the count
    expect(
      (
        await verifyQuotaAction(
          db,
          "u5",
          { type: "add_source", notebookId: "nb_other", byteSize: 1 },
          config.quotas
        )
      ).allowed
    ).toBe(true);

    close();
  });

  it.each(["demo", "full"])(
    "enforces the 200 MB notebook limit in profile %s (exactly 200 MB allowed, +1 byte denied)",
    async (profile) => {
      const { db, close } = createMockD1();
      const config = resolveAppConfig({ APP_PROFILE: profile });
      const mb = 1024 * 1024;
      // 4 x 40 MB = 160 MB already in the notebook (metadata only)
      await seedNotebookWithSources(db, "u6", "nb_size", 4, 40 * mb);

      const exact = await verifyQuotaAction(
        db,
        "u6",
        { type: "add_source", notebookId: "nb_size", byteSize: 40 * mb },
        config.quotas
      );
      expect(exact.allowed).toBe(true);

      const over = await verifyQuotaAction(
        db,
        "u6",
        { type: "add_source", notebookId: "nb_size", byteSize: 40 * mb + 1 },
        config.quotas
      );
      expect(over.allowed).toBe(false);
      expect(over.code).toBe("NOTEBOOK_SIZE_LIMIT");
      expect(over.reason).toContain("200 MB");
      expect(over.reason).toContain("160 MB");

      close();
    }
  );

  it("treats a missing totals row as an empty notebook", async () => {
    const { db } = createMockD1();
    const stub = {
      prepare(query: string) {
        if (query.includes("FROM sources")) {
          return { bind: () => ({ first: async () => null }) };
        }
        return db.prepare(query);
      }
    } as unknown as D1Database;
    await db
      .prepare(
        "INSERT INTO users (id, display_name, locale, is_guest, created_at) VALUES ('u8', 'User 8', 'de', 0, ?)"
      )
      .bind(Date.now())
      .run();
    const config = resolveAppConfig({ APP_PROFILE: "demo" });
    const check = await verifyQuotaAction(
      stub,
      "u8",
      { type: "add_source", notebookId: "nb_none", byteSize: 1 },
      config.quotas
    );
    expect(check.allowed).toBe(true);
  });

  it("answers the notebook size limit with 413 RFC 9457 problem details in the middleware", async () => {
    const { db, close } = createMockD1();
    const mb = 1024 * 1024;
    await seedNotebookWithSources(db, "u7", "nb_mw", 4, 50 * mb);

    const app = new Hono<{
      Bindings: { DB: D1Database };
      Variables: { user?: { id: string } };
    }>();
    app.use("/nb", async (c, next) => {
      c.set("user", { id: "u7" });
      await next();
    });
    app.use(
      "/nb",
      quotaGuardMiddleware(() => ({ type: "add_source", notebookId: "nb_mw", byteSize: 1 }))
    );
    app.post("/nb", (c) => c.text("ok"));

    // 4 x 50 MB = exactly 200 MB: one more byte exceeds the limit
    const res = await app.request("http://localhost/nb", { method: "POST" }, { DB: db });
    expect(res.status).toBe(413);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const problem = (await res.json()) as { code: string; status: number; detail: string };
    expect(problem.status).toBe(413);
    expect(problem.code).toBe("NOTEBOOK_SIZE_LIMIT");
    expect(problem.detail).toContain("200 MB");

    close();
  });

  it("enforces daily LLM calls limit and integrates with quotaGuardMiddleware", async () => {
    const { db, close } = createMockD1();
    await db
      .prepare(
        "INSERT INTO users (id, display_name, locale, is_guest, created_at) VALUES ('u4', 'User 4', 'de', 0, ?)"
      )
      .bind(Date.now())
      .run();

    const app = new Hono<{
      Bindings: { DB: D1Database };
      Variables: { user?: { id: string } };
    }>();
    app.use("/api/v1/generate", async (c, next) => {
      c.set("user", { id: "u4" });
      await next();
    });
    app.use(
      "/api/v1/generate",
      quotaGuardMiddleware(() => ({ type: "llm_call" }))
    );
    app.post("/api/v1/generate", async (c) => {
      await incrementUserQuota(c.env.DB, "u4", { type: "llm_call" });
      return c.text("generated");
    });

    const env = { DB: db, APP_PROFILE: "demo" }; // demo profile: 50 LLM calls / day

    // Fill up to 50 calls
    for (let i = 0; i < 50; i++) {
      const res = await app.request("http://localhost/api/v1/generate", { method: "POST" }, env);
      expect(res.status).toBe(200);
    }

    // 51st call must return 403 Forbidden RFC 9457 problem details
    const blockedRes = await app.request(
      "http://localhost/api/v1/generate",
      { method: "POST" },
      env
    );
    expect(blockedRes.status).toBe(403);
    expect(blockedRes.headers.get("content-type")).toContain("application/problem+json");

    const problem = (await blockedRes.json()) as { code: string; status: number };
    expect(problem.status).toBe(403);
    expect(problem.code).toBe("QUOTA_MAX_LLM_CALLS_EXCEEDED");

    close();
  });

  it("handles unauthenticated or missing DB or null action gracefully in middleware", async () => {
    // 1. Unauthenticated user
    const app1 = new Hono<{ Bindings: { DB?: D1Database } }>();
    app1.use(
      "/no-user",
      quotaGuardMiddleware(() => ({ type: "llm_call" }))
    );
    app1.get("/no-user", (c) => c.text("ok-no-user"));

    const res1 = await app1.request("http://localhost/no-user");
    expect(res1.status).toBe(200);

    // 2. Authenticated user but missing DB binding
    const app2 = new Hono<{
      Bindings: { DB?: D1Database };
      Variables: { user?: { id: string } };
    }>();
    app2.use("/no-db", async (c, next) => {
      c.set("user", { id: "usr_any" });
      await next();
    });
    app2.use(
      "/no-db",
      quotaGuardMiddleware(() => ({ type: "llm_call" }))
    );
    app2.get("/no-db", (c) => c.text("ok-no-db"));

    const res2 = await app2.request("http://localhost/no-db");
    expect(res2.status).toBe(200);

    // 3. Null action resolver
    const { db, close } = createMockD1();
    const app3 = new Hono<{
      Bindings: { DB?: D1Database };
      Variables: { user?: { id: string } };
    }>();
    app3.use("/null-action", async (c, next) => {
      c.set("user", { id: "usr_any" });
      await next();
    });
    app3.use(
      "/null-action",
      quotaGuardMiddleware(() => null)
    );
    app3.get("/null-action", (c) => c.text("ok-null-action"));

    const res3 = await app3.request("http://localhost/null-action", {}, { DB: db });
    expect(res3.status).toBe(200);

    close();
  });
});
