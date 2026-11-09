import {
  HealthResponseSchema,
  type ServiceStatus,
  WORKSPACE_VERSION,
  createProblemDetails
} from "@notebook-lm/shared";
import { Hono } from "hono";
import { resolveAppConfig } from "./config.js";

export const WORKER_VERSION = WORKSPACE_VERSION;

export function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/api/v1/health", async (c) => {
    const config = resolveAppConfig(c.env);

    let d1Status: ServiceStatus = "ok";
    try {
      await c.env.DB.prepare("SELECT 1 AS ok").first();
    } catch {
      d1Status = "down";
    }

    const r2Status: ServiceStatus = c.env.MEDIA ? "ok" : "down";
    const doStatus: ServiceStatus = c.env.NOTEBOOK_DO && c.env.JOB_DO ? "ok" : "down";

    const overallStatus: ServiceStatus =
      d1Status === "ok" && r2Status === "ok" && doStatus === "ok" ? "ok" : "degraded";

    const payload = HealthResponseSchema.parse({
      status: overallStatus,
      version: WORKER_VERSION,
      profile: config.profile,
      timestamp: new Date().toISOString(),
      services: {
        d1: d1Status,
        r2: r2Status,
        durableObjects: doStatus
      }
    });

    return c.json(payload, overallStatus === "ok" ? 200 : 503, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
  });

  app.notFound((c) => {
    const problem = createProblemDetails({
      status: 404,
      title: "Not Found",
      detail: `Endpunkt '${c.req.path}' wurde nicht gefunden.`,
      instance: c.req.path,
      code: "NOT_FOUND"
    });
    return c.json(problem, 404, {
      "content-type": "application/problem+json; charset=utf-8"
    });
  });

  return app;
}

const app = createApp();
export default app;
export {
  JobDO,
  NotebookDO,
  type DurableObjectHealthReport,
  type SqliteDurableObjectState
} from "./durable-objects.js";
