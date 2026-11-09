import {
  type DeploymentProfile,
  DeploymentProfileSchema,
  HealthResponseSchema,
  ProblemDetailsSchema
} from "@notebook-lm/shared";
import { describe, expect, it } from "vitest";
import { resolveAppConfig } from "../config.js";
import { createApp } from "../index.js";

function createMockEnv(overrides?: Partial<{ APP_PROFILE: string; d1Fail: boolean }>): Env {
  const shouldFailD1 = overrides?.d1Fail ?? false;
  return {
    APP_PROFILE: (overrides?.APP_PROFILE ?? "demo") as "demo",
    APP_ORIGIN: "http://localhost:8787",
    ASSETS: {
      fetch: async () => new Response("SPA HTML", { status: 200 })
    } as unknown as Fetcher,
    DB: {
      prepare: (_query: string) => ({
        first: async () => {
          if (shouldFailD1) {
            throw new Error("D1 unavailable");
          }
          return { ok: 1 };
        }
      })
    } as unknown as D1Database,
    MEDIA: {
      head: async () => null
    } as unknown as R2Bucket,
    NOTEBOOK_DO: {
      idFromName: (name: string) => ({ toString: () => `nb-${name}` }),
      get: () => ({
        fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
      })
    } as unknown as DurableObjectNamespace,
    JOB_DO: {
      idFromName: (name: string) => ({ toString: () => `job-${name}` }),
      get: () => ({
        fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200 })
      })
    } as unknown as DurableObjectNamespace
  };
}

describe("Configuration Profiles (demo vs. full) & /api/v1/health Endpoint", () => {
  it("resolves demo profile limits with strict Free-Tier quotas and 30-day TTL", () => {
    const demoConfig = resolveAppConfig({ APP_PROFILE: "demo" });
    expect(demoConfig.profile).toBe("demo");
    expect(demoConfig.quotas.maxNotebooksPerUser).toBe(3);
    expect(demoConfig.quotas.maxSourcesPerNotebook).toBe(15);
    expect(demoConfig.quotas.maxChunksPerNotebook).toBe(5_000);
    expect(demoConfig.quotas.maxSourceBytes).toBe(25 * 1024 * 1024);
    expect(demoConfig.quotas.demoNotebookTtlDays).toBe(30);
    expect(demoConfig.quotas.guestTtlHours).toBe(24);
  });

  it("resolves full profile limits according to ADR #16 and falls back to demo on unknown values", () => {
    const fullConfig = resolveAppConfig({ APP_PROFILE: "full" });
    expect(DeploymentProfileSchema.parse(fullConfig.profile)).toBe("full");
    expect(fullConfig.quotas.maxNotebooksPerUser).toBe(100);
    expect(fullConfig.quotas.maxSourcesPerNotebook).toBe(50);
    expect(fullConfig.quotas.maxChunksPerNotebook).toBe(50_000);
    expect(fullConfig.quotas.maxSourceBytes).toBe(200 * 1024 * 1024);
    expect(fullConfig.quotas.demoNotebookTtlDays).toBeNull();

    const fallbackConfig = resolveAppConfig({ APP_PROFILE: "unexpected" as DeploymentProfile });
    expect(fallbackConfig.profile).toBe("demo");
  });

  it("returns 200 OK with validated HealthResponseSchema from GET /api/v1/health", async () => {
    const app = createApp();
    const env = createMockEnv({ APP_PROFILE: "demo" });

    const res = await app.request("/api/v1/health", { method: "GET" }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-type")).toContain("charset=utf-8");

    const json = await res.json();
    const parsed = HealthResponseSchema.parse(json);
    expect(parsed.status).toBe("ok");
    expect(parsed.profile).toBe("demo");
    expect(parsed.services).toEqual({
      d1: "ok",
      r2: "ok",
      durableObjects: "ok"
    });
  });

  it("reports degraded status when D1 ping fails during health check", async () => {
    const app = createApp();
    const env = createMockEnv({ APP_PROFILE: "full", d1Fail: true });

    const res = await app.request("/api/v1/health", { method: "GET" }, env);
    expect(res.status).toBe(503);

    const parsed = HealthResponseSchema.parse(await res.json());
    expect(parsed.status).toBe("degraded");
    expect(parsed.profile).toBe("full");
    expect(parsed.services.d1).toBe("down");
  });

  it("returns RFC 9457 ProblemDetails JSON on unknown /api/* routes", async () => {
    const app = createApp();
    const env = createMockEnv();

    const res = await app.request("/api/v1/non-existent-endpoint", { method: "GET" }, env);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");

    const problem = ProblemDetailsSchema.parse(await res.json());
    expect(problem.status).toBe(404);
    expect(problem.code).toBe("NOT_FOUND");
    expect(problem.instance).toBe("/api/v1/non-existent-endpoint");
  });
});
