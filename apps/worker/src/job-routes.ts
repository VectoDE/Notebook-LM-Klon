import { EnqueueJobBodySchema, createProblemDetails } from "@notebook-lm/shared";
import { Hono } from "hono";
import type { CoreRepository } from "./core-repository.js";

export interface JobRoutesDependencies {
  readonly coreRepo?: CoreRepository | undefined;
}

/**
 * Helper to obtain or construct a JobDO stub / handler.
 * In Cloudflare Worker, this uses env.JOB_DO.
 * In native Node.js runtime, it interacts via the mock namespace or memory instance.
 */
export async function forwardToJobDO(
  env: Env | undefined,
  request: Request,
  jobIdOrNotebookId: string
): Promise<Response> {
  if (env?.JOB_DO) {
    try {
      const doId = env.JOB_DO.idFromName(jobIdOrNotebookId);
      const doStub = env.JOB_DO.get(doId);
      return await doStub.fetch(request);
    } catch {
      // Fall through to error
    }
  }

  const problem = createProblemDetails({
    status: 503,
    title: "Service Unavailable",
    detail: "Job-Warteschlange (JobDO) ist derzeit nicht verfügbar.",
    instance: new URL(request.url).pathname,
    code: "JOB_DO_UNAVAILABLE"
  });
  return Response.json(problem, {
    status: 503,
    headers: { "content-type": "application/problem+json; charset=utf-8" }
  });
}

const PROBLEM_HEADERS = { "content-type": "application/problem+json; charset=utf-8" } as const;

function unauthorized(instance: string): Response {
  return Response.json(
    createProblemDetails({
      status: 401,
      title: "Unauthorized",
      detail: "Authentifizierung erforderlich.",
      instance,
      code: "UNAUTHORIZED"
    }),
    { status: 401, headers: PROBLEM_HEADERS }
  );
}

function jobNotFound(jobId: string, instance: string): Response {
  return Response.json(
    createProblemDetails({
      status: 404,
      title: "Not Found",
      detail: `Job '${jobId}' wurde in diesem Notebook nicht gefunden.`,
      instance,
      code: "JOB_NOT_FOUND"
    }),
    { status: 404, headers: PROBLEM_HEADERS }
  );
}

/**
 * Loads a job from the notebook's own JobDO and checks that it belongs to that notebook.
 * A job of another notebook (or an unknown id) yields 404, so job ids cannot be probed
 * across notebooks (IDOR). Errors of the JobDO itself (503) are passed through.
 */
export async function fetchNotebookJob(
  env: Env | undefined,
  notebookId: string,
  jobId: string,
  instance: string
): Promise<Record<string, unknown> | Response> {
  const doRequest = new Request(`http://internal/jobs/${encodeURIComponent(jobId)}`, {
    method: "GET"
  });
  const res = await forwardToJobDO(env, doRequest, notebookId);
  if (res.status === 404) {
    return jobNotFound(jobId, instance);
  }
  if (!res.ok) {
    return res;
  }
  const job = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!job || job.notebookId !== notebookId) {
    return jobNotFound(jobId, instance);
  }
  return job;
}

/**
 * Creates a standalone Hono router for Job Queue & Status API:
 * - POST /api/v1/jobs/enqueue
 * - GET /api/v1/jobs
 * - GET /api/v1/notebooks/:id/jobs/:jobId
 * - POST /api/v1/notebooks/:id/jobs/:jobId/cancel
 */
export function createJobRoutes(
  deps: JobRoutesDependencies = {}
): Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }> {
  const router = new Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>();
  registerJobRoutes(router, deps);
  return router;
}

/**
 * Registers the Job Queue & Status API routes:
 * - POST /api/v1/jobs/enqueue (Enqueue new job)
 * - GET /api/v1/jobs (List jobs, filterable by status/kind/notebookId)
 * - GET /api/v1/notebooks/:id/jobs/:jobId (Job status & progress, only jobs of that notebook)
 * - POST /api/v1/notebooks/:id/jobs/:jobId/cancel (Cancel a job of that notebook)
 */
export function registerJobRoutes(
  app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>,
  deps: JobRoutesDependencies = {}
): void {
  const { coreRepo } = deps;

  // 1. POST /api/v1/jobs/enqueue
  app.post("/api/v1/jobs/enqueue", async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser) {
      const problem = createProblemDetails({
        status: 401,
        title: "Unauthorized",
        detail: "Authentifizierung erforderlich.",
        instance: c.req.path,
        code: "UNAUTHORIZED"
      });
      return c.json(problem, 401, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: "Ungültiges JSON im Request-Body.",
        instance: c.req.path,
        code: "INVALID_JSON"
      });
      return c.json(problem, 400, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    const parseResult = EnqueueJobBodySchema.safeParse(rawBody);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message
      }));
      const problem = createProblemDetails({
        status: 422,
        title: "Unprocessable Content",
        detail: "Validierungsfehler bei den Job-Parametern.",
        instance: c.req.path,
        code: "VALIDATION_ERROR",
        errors
      });
      return c.json(problem, 422, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    const body = parseResult.data;

    // Check authorization to notebook if coreRepo is present
    if (coreRepo) {
      const notebook = await coreRepo.getNotebookById(body.notebookId);
      if (!notebook) {
        const problem = createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: `Notebook '${body.notebookId}' wurde nicht gefunden.`,
          instance: c.req.path,
          code: "NOTEBOOK_NOT_FOUND"
        });
        return c.json(problem, 404, {
          "content-type": "application/problem+json; charset=utf-8"
        });
      }

      let userRole = await coreRepo.getWorkspaceMemberRole(notebook.workspace_id, sessionUser.id);
      if (!userRole) {
        const shares = await coreRepo.db.query<{ role: "editor" | "viewer" }>(
          "SELECT role FROM notebook_shares WHERE notebook_id = ? AND user_id = ?",
          [body.notebookId, sessionUser.id]
        );
        if (shares.length > 0 && shares[0]) {
          userRole = shares[0].role;
        }
      }

      if (!userRole) {
        const problem = createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: `Notebook '${body.notebookId}' wurde nicht gefunden.`,
          instance: c.req.path,
          code: "NOTEBOOK_NOT_FOUND"
        });
        return c.json(problem, 404, {
          "content-type": "application/problem+json; charset=utf-8"
        });
      }
    }

    // Attach userId into job payload for auditing / artifact authorship
    const enrichedPayload = {
      ...body.payload,
      userId: sessionUser.id
    };

    const doRequest = new Request("http://internal/jobs/enqueue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...body,
        payload: enrichedPayload
      })
    });

    return forwardToJobDO(c.env, doRequest, body.notebookId);
  });

  // 2. GET /api/v1/jobs
  app.get("/api/v1/jobs", async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser) {
      const problem = createProblemDetails({
        status: 401,
        title: "Unauthorized",
        detail: "Authentifizierung erforderlich.",
        instance: c.req.path,
        code: "UNAUTHORIZED"
      });
      return c.json(problem, 401, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    const notebookId = c.req.query("notebookId");
    const status = c.req.query("status");
    const kind = c.req.query("kind");

    if (coreRepo && notebookId) {
      const notebook = await coreRepo.getNotebookById(notebookId);
      if (!notebook) {
        const problem = createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: `Notebook '${notebookId}' wurde nicht gefunden.`,
          instance: c.req.path,
          code: "NOTEBOOK_NOT_FOUND"
        });
        return c.json(problem, 404, {
          "content-type": "application/problem+json; charset=utf-8"
        });
      }
    }

    const queryParams = new URLSearchParams();
    if (status) queryParams.set("status", status);
    if (kind) queryParams.set("kind", kind);
    if (notebookId) queryParams.set("notebookId", notebookId);

    const doUrl = `http://internal/jobs?${queryParams.toString()}`;
    const doRequest = new Request(doUrl, { method: "GET" });
    return forwardToJobDO(c.env, doRequest, notebookId || "global");
  });

  // 3. GET /api/v1/notebooks/:id/jobs/:jobId
  // Notebook role (viewer) is enforced by the API app before this handler runs.
  app.get("/api/v1/notebooks/:id/jobs/:jobId", async (c) => {
    if (!c.get("sessionUser")) {
      return unauthorized(c.req.path);
    }
    const lookup = await fetchNotebookJob(
      c.env,
      c.req.param("id"),
      c.req.param("jobId"),
      c.req.path
    );
    if (lookup instanceof Response) {
      return lookup;
    }
    return Response.json(lookup, {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  });

  // 4. POST /api/v1/notebooks/:id/jobs/:jobId/cancel
  // Notebook role (editor) is enforced by the API app before this handler runs.
  app.post("/api/v1/notebooks/:id/jobs/:jobId/cancel", async (c) => {
    if (!c.get("sessionUser")) {
      return unauthorized(c.req.path);
    }
    const notebookId = c.req.param("id");
    const jobId = c.req.param("jobId");
    const lookup = await fetchNotebookJob(c.env, notebookId, jobId, c.req.path);
    if (lookup instanceof Response) {
      return lookup;
    }
    const doRequest = new Request(`http://internal/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST"
    });
    return forwardToJobDO(c.env, doRequest, notebookId);
  });
}
