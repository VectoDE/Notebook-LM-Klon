import { ProblemDetailsSchema } from "@notebook-lm/shared";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CoreRepository, type DatabaseAdapter } from "../core-repository.js";
import { createJobRoutes, forwardToJobDO, registerJobRoutes } from "../job-routes.js";

function createMockDatabaseAdapter(options?: {
  notebookMissing?: boolean;
  userNotMember?: boolean;
}): DatabaseAdapter {
  return {
    exec: async () => {},
    query: async <T = unknown>(sql: string): Promise<T[]> => {
      if (sql.includes("notebook_shares")) {
        return (options?.userNotMember ? [] : [{ role: "editor" }]) as T[];
      }
      return [] as T[];
    },
    queryOne: async <T = unknown>(sql: string): Promise<T | null> => {
      if (sql.includes("FROM notebooks")) {
        if (options?.notebookMissing) {
          return null;
        }
        return {
          id: "nb-1",
          workspace_id: "ws-1",
          title: "Test Notebook",
          created_at: 1000,
          updated_at: 1000
        } as T;
      }
      if (sql.includes("workspace_members")) {
        if (options?.userNotMember) {
          return null;
        }
        return { role: "owner" } as T;
      }
      return null;
    },
    run: async () => ({ changes: 1 })
  };
}

describe("Job API Routes (POST /api/v1/jobs/enqueue, GET /api/v1/jobs/:id, etc.)", () => {
  const testUserId = "usr_123";

  it("handles POST /api/v1/jobs/enqueue, validation, auth checks and forwarding", async () => {
    let forwardedRequest: Request | null = null;
    const mockEnv = {
      JOB_DO: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: async (req: Request) => {
            forwardedRequest = req;
            return Response.json(
              { id: "job-1", status: "queued", notebookId: "nb-1" },
              { status: 201 }
            );
          }
        })
      }
    } as unknown as Env;

    const coreRepo = new CoreRepository(createMockDatabaseAdapter());
    const app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();

    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerJobRoutes(app, { coreRepo });

    // 1. Valid enqueue
    const res = await app.request(
      "http://localhost/api/v1/jobs/enqueue",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          notebookId: "nb-1",
          kind: "audio_overview",
          payload: { prompt: "test" }
        })
      },
      mockEnv
    );
    expect(res.status).toBe(201);
    expect(forwardedRequest).not.toBeNull();

    // 2. Missing auth (unauthorized)
    const unauthApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    registerJobRoutes(unauthApp, { coreRepo });
    const unauthRes = await unauthApp.request(
      "http://localhost/api/v1/jobs/enqueue",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notebookId: "nb-1", kind: "audio_overview" })
      },
      mockEnv
    );
    expect(unauthRes.status).toBe(401);

    // 3. Invalid JSON
    const badJsonRes = await app.request(
      "http://localhost/api/v1/jobs/enqueue",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "bad-json"
      },
      mockEnv
    );
    expect(badJsonRes.status).toBe(400);

    // 4. Validation error (invalid body schema)
    const valErrRes = await app.request(
      "http://localhost/api/v1/jobs/enqueue",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notebookId: "", kind: "unknown_kind" })
      },
      mockEnv
    );
    expect(valErrRes.status).toBe(422);

    // 5. Notebook not found
    const missingNbRepo = new CoreRepository(createMockDatabaseAdapter({ notebookMissing: true }));
    const missingNbApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    missingNbApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerJobRoutes(missingNbApp, { coreRepo: missingNbRepo });
    const missingNbRes = await missingNbApp.request(
      "http://localhost/api/v1/jobs/enqueue",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notebookId: "nb-missing", kind: "audio_overview" })
      },
      mockEnv
    );
    expect(missingNbRes.status).toBe(404);

    // 6. User not member of notebook or workspace
    const notMemberRepo = new CoreRepository(createMockDatabaseAdapter({ userNotMember: true }));
    const notMemberApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    notMemberApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerJobRoutes(notMemberApp, { coreRepo: notMemberRepo });
    const notMemberRes = await notMemberApp.request(
      "http://localhost/api/v1/jobs/enqueue",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notebookId: "nb-1", kind: "audio_overview" })
      },
      mockEnv
    );
    expect(notMemberRes.status).toBe(404);

    // 7. User role resolved via notebook_shares
    const shareAdapter: DatabaseAdapter = {
      exec: async () => {},
      query: async <T = unknown>(sql: string): Promise<T[]> => {
        if (sql.includes("notebook_shares")) {
          return [{ role: "viewer" }] as T[];
        }
        return [] as T[];
      },
      queryOne: async <T = unknown>(sql: string): Promise<T | null> => {
        if (sql.includes("FROM notebooks")) {
          return { id: "nb-1", workspace_id: "ws-1" } as T;
        }
        if (sql.includes("workspace_members")) {
          return null; // Not member of workspace directly
        }
        return null;
      },
      run: async () => ({ changes: 1 })
    };
    const shareRepo = new CoreRepository(shareAdapter);
    const shareApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    shareApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerJobRoutes(shareApp, { coreRepo: shareRepo });
    const dummyApp = createJobRoutes({ coreRepo: shareRepo });
    expect(dummyApp).toBeDefined();
    const shareRes = await shareApp.request(
      "http://localhost/api/v1/jobs/enqueue",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notebookId: "nb-1", kind: "audio_overview" })
      },
      mockEnv
    );
    expect(shareRes.status).toBe(201);
  });

  it("handles GET /api/v1/jobs listing with query filters and authorization", async () => {
    const mockEnv = {
      JOB_DO: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: async () => Response.json({ jobs: [], count: 0 }, { status: 200 })
        })
      }
    } as unknown as Env;

    const coreRepo = new CoreRepository(createMockDatabaseAdapter());
    const app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerJobRoutes(app, { coreRepo });

    // Unauthorized
    const unauthApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    registerJobRoutes(unauthApp, { coreRepo });
    const unauthRes = await unauthApp.request("http://localhost/api/v1/jobs", {}, mockEnv);
    expect(unauthRes.status).toBe(401);

    // Filter query
    const res = await app.request(
      "http://localhost/api/v1/jobs?status=queued&kind=quiz&notebookId=nb-1",
      {},
      mockEnv
    );
    expect(res.status).toBe(200);

    // Missing notebook in list query
    const missingNbRepo = new CoreRepository(createMockDatabaseAdapter({ notebookMissing: true }));
    const missingNbApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    missingNbApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerJobRoutes(missingNbApp, { coreRepo: missingNbRepo });
    const missingRes = await missingNbApp.request(
      "http://localhost/api/v1/jobs?notebookId=nb-missing",
      {},
      mockEnv
    );
    expect(missingRes.status).toBe(404);

    // List without coreRepo or notebookId query params
    const noCoreApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    noCoreApp.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerJobRoutes(noCoreApp, {});
    const noCoreRes = await noCoreApp.request("http://localhost/api/v1/jobs", {}, mockEnv);
    expect(noCoreRes.status).toBe(200);

    // Enqueue without coreRepo
    const noCoreEnqueueRes = await noCoreApp.request(
      "http://localhost/api/v1/jobs/enqueue",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notebookId: "nb-nocore", kind: "audio_overview" })
      },
      mockEnv
    );
    expect(noCoreEnqueueRes.status).toBe(200);
  });

  it("handles GET and cancel under /api/v1/notebooks/:id/jobs/:jobId with ownership check", async () => {
    const calls: Array<{ notebookId: string; path: string; method: string }> = [];
    const jobs: Record<string, unknown> = {
      "job-1": { id: "job-1", notebookId: "nb-1", status: "running", progress: 50 },
      "job-other": { id: "job-other", notebookId: "nb-2", status: "running" },
      "job-garbled": "not-json"
    };
    const mockEnv = {
      JOB_DO: {
        idFromName: (name: string) => name,
        get: (notebookId: string) => ({
          fetch: async (req: Request) => {
            const url = new URL(req.url);
            calls.push({ notebookId, path: url.pathname, method: req.method });
            const id = decodeURIComponent(url.pathname.split("/")[2] ?? "");
            if (id === "job-down") {
              return Response.json({ code: "BROKEN" }, { status: 500 });
            }
            const job = jobs[id];
            if (job === undefined) {
              return Response.json({ code: "JOB_NOT_FOUND" }, { status: 404 });
            }
            if (url.pathname.endsWith("/cancel")) {
              return Response.json({ id, status: "cancelled" }, { status: 200 });
            }
            return typeof job === "string" ? new Response(job) : Response.json(job);
          }
        })
      }
    } as unknown as Env;

    const app = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    app.use("*", async (c, next) => {
      c.set("sessionUser", { id: testUserId });
      await next();
    });
    registerJobRoutes(app);
    const base = "http://localhost/api/v1/notebooks/nb-1/jobs";

    const getRes = await app.request(`${base}/job-1`, {}, mockEnv);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("cache-control")).toBe("no-store");
    expect(((await getRes.json()) as { status: string }).status).toBe("running");
    expect(calls.at(-1)).toEqual({ notebookId: "nb-1", path: "/jobs/job-1", method: "GET" });

    // Job of another notebook, unknown job and unparsable record: 404 JOB_NOT_FOUND
    for (const jobId of ["job-other", "job-missing", "job-garbled"]) {
      const res = await app.request(`${base}/${jobId}`, {}, mockEnv);
      expect(res.status, jobId).toBe(404);
      expect(ProblemDetailsSchema.parse(await res.json()).code).toBe("JOB_NOT_FOUND");
    }

    // JobDO failures are passed through unchanged
    expect((await app.request(`${base}/job-down`, {}, mockEnv)).status).toBe(500);

    // Cancel: ownership verified first, then forwarded to the same notebook's JobDO
    calls.length = 0;
    const cancelRes = await app.request(`${base}/job-1/cancel`, { method: "POST" }, mockEnv);
    expect(cancelRes.status).toBe(200);
    expect(((await cancelRes.json()) as { status: string }).status).toBe("cancelled");
    expect(calls).toEqual([
      { notebookId: "nb-1", path: "/jobs/job-1", method: "GET" },
      { notebookId: "nb-1", path: "/jobs/job-1/cancel", method: "POST" }
    ]);

    calls.length = 0;
    const foreignCancel = await app.request(
      `${base}/job-other/cancel`,
      { method: "POST" },
      mockEnv
    );
    expect(foreignCancel.status).toBe(404);
    expect(calls.some((call) => call.path.endsWith("/cancel"))).toBe(false);

    // Old routes without notebook are gone
    expect((await app.request("http://localhost/api/v1/jobs/job-1", {}, mockEnv)).status).toBe(404);

    // Unauthenticated
    const unauthApp = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
    registerJobRoutes(unauthApp);
    expect((await unauthApp.request(`${base}/job-1`, {}, mockEnv)).status).toBe(401);
    expect(
      (await unauthApp.request(`${base}/job-1/cancel`, { method: "POST" }, mockEnv)).status
    ).toBe(401);
  });

  it("handles forwardToJobDO when binding is unavailable or throws (503 Service Unavailable)", async () => {
    // Missing JOB_DO binding
    const resNoEnv = await forwardToJobDO(undefined, new Request("http://localhost/jobs/1"), "1");
    expect(resNoEnv.status).toBe(503);
    const prob1 = ProblemDetailsSchema.parse(await resNoEnv.json());
    expect(prob1.code).toBe("JOB_DO_UNAVAILABLE");

    // Throwing JOB_DO binding
    const faultyEnv = {
      JOB_DO: {
        idFromName: () => {
          throw new Error("DO cluster panic");
        }
      }
    } as unknown as Env;
    const resFault = await forwardToJobDO(faultyEnv, new Request("http://localhost/jobs/1"), "1");
    expect(resFault.status).toBe(503);
  });
});
