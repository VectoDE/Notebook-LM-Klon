import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createD1DatabaseAdapter } from "@/db/d1-adapter.js";
import { createApp } from "@/index.js";
import { createNodeEnv, runSqliteMigrations } from "@/node-server.js";
import {
  createUsageThrottle,
  incrementUsageCounter,
  isUsageMetric,
  registerUsageMetricsRoutes,
  USAGE_METRICS,
  usageDay
} from "@/routes/usage-metrics.js";
import { DELETED_USER_ID } from "@/scheduled/cleanup.js";
import { clearRateLimitMemory } from "@/security/rate-limiter.js";

const ORIGIN = "http://localhost:8787";

describe("Cookielose aggregierte Nutzungszähler (Issue #262)", () => {
  const app = createApp();
  let sqlite: DatabaseSync;
  let env: Env;
  let dataDir: string;

  beforeEach(() => {
    clearRateLimitMemory();
    dataDir = mkdtempSync(join(tmpdir(), "usage-metrics-"));
    sqlite = new DatabaseSync(":memory:");
    runSqliteMigrations(sqlite, resolve(process.cwd(), "apps/worker/migrations"));
    env = createNodeEnv({ db: sqlite, dataDir, sessionSaltSecret: "usage-test-salt" }).env;
  });

  afterEach(() => {
    sqlite.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function post(body: string, headers: Record<string, string> = {}): Promise<Response> {
    return Promise.resolve(
      app.request(
        `${ORIGIN}/api/v1/metrics`,
        {
          method: "POST",
          headers: {
            origin: ORIGIN,
            "content-type": "application/json",
            "user-agent": "Mozilla/5.0 Testbrowser",
            "cf-connecting-ip": "198.51.100.23",
            ...headers
          },
          body
        },
        env
      )
    );
  }

  it("zählt einen Seitenaufruf, setzt kein Cookie und speichert weder IP noch Kennung", async () => {
    const first = await post(JSON.stringify({ metric: "page_view" }));
    const second = await post(JSON.stringify({ metric: "page_view" }));

    for (const res of [first, second]) {
      expect(res.status).toBe(204);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store");
      // the rate limiter (which keys on the client IP) never sees this request
      expect(res.headers.get("x-ratelimit-limit")).toBeNull();
      expect(await res.text()).toBe("");
    }

    const rows = sqlite.prepare("SELECT * FROM usage_counters").all();
    expect(rows).toEqual([{ day: usageDay(Date.now()), metric: "page_view", count: 2 }]);

    // the table has no column that could hold personal data
    const columns = (
      sqlite.prepare("PRAGMA table_info(usage_counters)").all() as { name: string }[]
    )
      .map((c) => c.name)
      .sort();
    expect(columns).toEqual(["count", "day", "metric"]);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain("198.51.100.23");
    expect(dump).not.toContain("Testbrowser");

    // nothing was written to session or rate-limit tables
    // (users: the placeholder account from migration 0009 does not count)
    for (const query of [
      "SELECT COUNT(*) AS n FROM sessions",
      `SELECT COUNT(*) AS n FROM users WHERE id != '${DELETED_USER_ID}'`,
      "SELECT COUNT(*) AS n FROM audit_log",
      "SELECT COUNT(*) AS n FROM rate_limits"
    ]) {
      const n = sqlite.prepare(query).get() as { n: number };
      expect(Number(n.n), query).toBe(0);
    }
  });

  it("lehnt unbekannte Messgrößen und Freitext ab", async () => {
    for (const body of [
      JSON.stringify({ metric: "user:alice@example.test" }),
      JSON.stringify({ metric: 42 }),
      JSON.stringify({}),
      "null",
      "kein json"
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(((await res.json()) as { code: string }).code).toBe("UNKNOWN_METRIC");
    }
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM usage_counters").get()).toEqual({ n: 0 });
  });

  it("nimmt keine Zählungen von fremden Origins an (CSRF-Schutz)", async () => {
    const res = await post(JSON.stringify({ metric: "page_view" }), {
      origin: "https://evil.example"
    });
    expect(res.status).toBe(403);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM usage_counters").get()).toEqual({ n: 0 });
  });

  it("zählt nur mit exakt passender Origin, auch ohne Origin-Header nicht", async () => {
    const missing = await app.request(
      `${ORIGIN}/api/v1/metrics`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metric: "page_view" })
      },
      env
    );
    expect(missing.status).toBe(403);
    expect(((await missing.json()) as { code: string }).code).toBe("METRICS_ORIGIN_FORBIDDEN");
    const lookalike = await post(JSON.stringify({ metric: "page_view" }), {
      origin: `${ORIGIN}.evil.example`
    });
    expect(lookalike.status).toBe(403);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM usage_counters").get()).toEqual({ n: 0 });
  });

  it("drosselt je Isolate ohne Client-Merkmal und antwortet mit 429", async () => {
    const now = Date.UTC(2026, 10, 16, 12, 0, 0);
    const local = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    registerUsageMetricsRoutes(local, {
      db: createD1DatabaseAdapter(env.DB),
      allowedOrigin: ORIGIN,
      now: () => now,
      throttle: createUsageThrottle(2, 1)
    });
    const send = () =>
      local.request("/api/v1/metrics", {
        method: "POST",
        headers: { origin: ORIGIN },
        body: JSON.stringify({ metric: "page_view" })
      });
    expect((await send()).status).toBe(204);
    expect((await send()).status).toBe(204);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1");
    expect(((await limited.json()) as { code: string }).code).toBe("METRICS_THROTTLED");
    expect(sqlite.prepare("SELECT count FROM usage_counters").get()).toEqual({ count: 2 });
  });

  it("füllt den Token-Eimer mit der Zeit wieder auf", () => {
    const bucket = createUsageThrottle(1, 1);
    expect(bucket.tryTake(1000)).toBe(true);
    expect(bucket.tryTake(1000)).toBe(false);
    expect(bucket.tryTake(1500)).toBe(false);
    expect(bucket.tryTake(2600)).toBe(true);
    // time running backwards never adds tokens
    expect(bucket.tryTake(100)).toBe(false);
  });

  it("deckelt den Tageszähler", async () => {
    const db = createD1DatabaseAdapter(env.DB);
    const at = Date.UTC(2026, 10, 16, 8, 0, 0);
    for (let i = 0; i < 5; i++) {
      await incrementUsageCounter(db, "page_view", at, 3);
    }
    expect(sqlite.prepare("SELECT count FROM usage_counters").get()).toEqual({ count: 3 });
  });

  it("legt je UTC-Tag eine eigene Zeile an", async () => {
    let now = Date.UTC(2026, 10, 13, 23, 59, 0);
    const local = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    registerUsageMetricsRoutes(local, {
      db: createD1DatabaseAdapter(env.DB),
      allowedOrigin: ORIGIN,
      now: () => now
    });
    const send = () =>
      local.request("/api/v1/metrics", {
        method: "POST",
        headers: { origin: ORIGIN },
        body: JSON.stringify({ metric: "page_view" })
      });

    expect((await send()).status).toBe(204);
    now += 2 * 60 * 1000;
    expect((await send()).status).toBe(204);
    expect((await send()).status).toBe(204);

    expect(sqlite.prepare("SELECT day, count FROM usage_counters ORDER BY day").all()).toEqual([
      { day: "2026-11-13", count: 1 },
      { day: "2026-11-14", count: 2 }
    ]);
  });

  it("kennt nur Messgrößen aus der Liste", () => {
    expect(USAGE_METRICS).toEqual(["page_view"]);
    expect(isUsageMetric("page_view")).toBe(true);
    expect(isUsageMetric("PAGE_VIEW")).toBe(false);
    expect(isUsageMetric(undefined)).toBe(false);
  });
});
