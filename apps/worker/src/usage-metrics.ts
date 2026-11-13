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

export async function incrementUsageCounter(
  db: DatabaseAdapter,
  metric: UsageMetric,
  now: number
): Promise<void> {
  await db.run(
    `INSERT INTO usage_counters (day, metric, count) VALUES (?, ?, 1)
     ON CONFLICT(day, metric) DO UPDATE SET count = count + 1`,
    [usageDay(now), metric]
  );
}

export interface UsageMetricsRoutesDependencies {
  readonly db: DatabaseAdapter;
  readonly now?: () => number;
}

export function registerUsageMetricsRoutes(
  app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>,
  deps: UsageMetricsRoutesDependencies
): void {
  app.post("/api/v1/metrics", async (c) => {
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
    await incrementUsageCounter(deps.db, metric, (deps.now ?? Date.now)());
    return c.body(null, 204, { "cache-control": "no-store" });
  });
}
