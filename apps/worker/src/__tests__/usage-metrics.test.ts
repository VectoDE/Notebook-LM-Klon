import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createD1DatabaseAdapter } from "../d1-adapter.js";
import { createApp } from "../index.js";
import { createNodeEnv, runSqliteMigrations } from "../node-server.js";
import { clearRateLimitMemory } from "../rate-limiter.js";
import {
  USAGE_METRICS,
  isUsageMetric,
  registerUsageMetricsRoutes,
  usageDay
} from "../usage-metrics.js";

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
    for (const table of ["sessions", "users", "audit_log", "rate_limits"]) {
      const n = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      expect(Number(n.n), table).toBe(0);
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

  it("legt je UTC-Tag eine eigene Zeile an", async () => {
    let now = Date.UTC(2026, 10, 13, 23, 59, 0);
    const local = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    registerUsageMetricsRoutes(local, {
      db: createD1DatabaseAdapter(env.DB),
      now: () => now
    });
    const send = () =>
      local.request("/api/v1/metrics", {
        method: "POST",
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
