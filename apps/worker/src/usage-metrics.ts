import { createProblemDetails } from "@notebook-lm/shared";
import type { Hono } from "hono";
import type { DatabaseAdapter } from "./core-repository.js";

/**
 * Cookie-free usage measurement (Issue #262).
 *
 * The worker keeps one counter per UTC day and metric. The handler reads nothing from
 * the request except the metric name: no IP address, no User-Agent, no cookie, no
 * session. Nothing is set on the client. Only metrics from this allowlist are counted,
 * so free text cannot end up in the table.
 */
export const USAGE_METRICS = ["page_view"] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export function isUsageMetric(value: unknown): value is UsageMetric {
  return typeof value === "string" && (USAGE_METRICS as readonly string[]).includes(value);
}

/** UTC calendar day (YYYY-MM-DD) used as counter key. */
export function usageDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Upper bound per UTC day and metric. The route runs without the IP-based rate limiter
 * (it must not read the IP), so the counter itself is capped: a flood of requests can at
 * most push one day's value to this limit, never beyond.
 */
export const USAGE_DAILY_CAP = 1_000_000;

export async function incrementUsageCounter(
  db: DatabaseAdapter,
  metric: UsageMetric,
  now: number,
  cap: number = USAGE_DAILY_CAP
): Promise<void> {
  await db.run(
    `INSERT INTO usage_counters (day, metric, count) VALUES (?, ?, 1)
     ON CONFLICT(day, metric) DO UPDATE SET count = count + 1 WHERE usage_counters.count < ?`,
    [usageDay(now), metric, cap]
  );
}

/**
 * Global token bucket per isolate, independent of the client: no IP, no identifier.
 * It limits how many counter writes one worker instance accepts per second, so the
 * route cannot be used to hammer the database.
 */
export interface UsageThrottle {
  tryTake(now: number): boolean;
}

export function createUsageThrottle(capacity = 50, refillPerSecond = 50): UsageThrottle {
  let tokens = capacity;
  let last: number | undefined;
  return {
    tryTake(now: number): boolean {
      if (last !== undefined && now > last) {
        tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSecond);
      }
      last = now;
      if (tokens < 1) {
        return false;
      }
      tokens -= 1;
      return true;
    }
  };
}

export interface UsageMetricsRoutesDependencies {
  readonly db: DatabaseAdapter;
  /** The app's own origin. Only requests with exactly this Origin header are counted. */
  readonly allowedOrigin: string;
  readonly now?: () => number;
  readonly throttle?: UsageThrottle;
  readonly dailyCap?: number;
}

/** One bucket per isolate (module scope), shared by every app instance built in it. */
const sharedUsageThrottle = createUsageThrottle();

const PROBLEM_HEADERS = {
  "content-type": "application/problem+json; charset=utf-8",
  "cache-control": "no-store"
} as const;

export function registerUsageMetricsRoutes(
  app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>,
  deps: UsageMetricsRoutesDependencies
): void {
  const throttle = deps.throttle ?? sharedUsageThrottle;
  const now = deps.now ?? Date.now;
  app.post("/api/v1/metrics", async (c) => {
    // Exact origin match: the general CSRF check lets requests without an Origin header
    // through; this route does not, so only the app's own pages can count.
    if (c.req.header("origin") !== deps.allowedOrigin) {
      return c.json(
        createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: "Zählung nur von der eigenen Origin.",
          instance: c.req.path,
          code: "METRICS_ORIGIN_FORBIDDEN"
        }),
        403,
        PROBLEM_HEADERS
      );
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = null;
    }
    const metric = (body as { metric?: unknown } | null)?.metric;
    if (!isUsageMetric(metric)) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: `Unbekannte Messgröße. Erlaubt: ${USAGE_METRICS.join(", ")}.`,
          instance: c.req.path,
          code: "UNKNOWN_METRIC"
        }),
        400,
        { "content-type": "application/problem+json; charset=utf-8", "cache-control": "no-store" }
      );
    }
    const at = now();
    if (!throttle.tryTake(at)) {
      return c.json(
        createProblemDetails({
          status: 429,
          title: "Too Many Requests",
          detail: "Zu viele Zählanfragen, bitte später erneut.",
          instance: c.req.path,
          code: "METRICS_THROTTLED"
        }),
        429,
        { ...PROBLEM_HEADERS, "retry-after": "1" }
      );
    }
    await incrementUsageCounter(deps.db, metric, at, deps.dailyCap);
    return c.body(null, 204, { "cache-control": "no-store" });
  });
}
