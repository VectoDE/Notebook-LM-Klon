import { createProblemDetails } from "@notebook-lm/shared";
import type { Context, MiddlewareHandler } from "hono";
import type { CoreRepository } from "./core-repository.js";
import { type QuotaAction, incrementUserQuota } from "./quota-guard.js";
import type { RagRepository } from "./rag-repository.js";

export type NotebookRole = "viewer" | "editor" | "owner";

const ROLE_RANK: Record<NotebookRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3
};

const PROBLEM_HEADERS = { "content-type": "application/problem+json; charset=utf-8" } as const;

function problemResponse(
  c: Context,
  status: 400 | 401 | 403 | 404 | 501 | 503,
  title: string,
  detail: string,
  code: string
): Response {
  return c.json(
    createProblemDetails({ status, title, detail, instance: c.req.path, code }),
    status,
    PROBLEM_HEADERS
  );
}

/**
 * Resolves the effective role of a user on a notebook: workspace membership first,
 * then direct notebook shares. Returns null if the notebook does not exist or the
 * user has no access (callers answer 404 in both cases to avoid leaking existence).
 */
export async function resolveNotebookRole(
  repo: CoreRepository,
  notebookId: string,
  userId: string
): Promise<NotebookRole | null> {
  const notebook = await repo.getNotebookById(notebookId);
  if (!notebook) {
    return null;
  }
  const memberRole = await repo.getWorkspaceMemberRole(notebook.workspace_id, userId);
  if (memberRole) {
    return memberRole;
  }
  const shares = await repo.db.query<{ role: "editor" | "viewer" }>(
    "SELECT role FROM notebook_shares WHERE notebook_id = ? AND user_id = ?",
    [notebookId, userId]
  );
  return shares[0]?.role ?? null;
}

async function enforceNotebookRole(
  c: Context,
  next: () => Promise<void>,
  repo: CoreRepository,
  notebookId: string,
  userId: string,
  requiredRole: NotebookRole
): Promise<Response | undefined> {
  const role = await resolveNotebookRole(repo, notebookId, userId);
  if (!role) {
    return problemResponse(
      c,
      404,
      "Not Found",
      "Notebook wurde nicht gefunden.",
      "NOTEBOOK_NOT_FOUND"
    );
  }
  if (ROLE_RANK[role] < ROLE_RANK[requiredRole]) {
    return problemResponse(
      c,
      403,
      "Forbidden",
      `Erforderliche Rolle '${requiredRole}' wird von aktueller Rolle '${role}' nicht erfüllt.`,
      "INSUFFICIENT_ROLE"
    );
  }
  await next();
  return undefined;
}

/**
 * RBAC guard for routes addressed by a source id: resolves the owning notebook
 * and requires the given role on it.
 */
export function requireSourceRole(
  coreRepo: CoreRepository,
  ragRepo: RagRepository,
  requiredRole: NotebookRole,
  sourceIdParam = "id"
): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get("sessionUser");
    if (!user) {
      return problemResponse(
        c,
        401,
        "Unauthorized",
        "Authentifizierung erforderlich.",
        "UNAUTHORIZED"
      );
    }
    const source = await ragRepo.getSourceById(c.req.param(sourceIdParam) as string);
    if (!source) {
      return problemResponse(
        c,
        404,
        "Not Found",
        "Quelle wurde nicht gefunden.",
        "SOURCE_NOT_FOUND"
      );
    }
    return enforceNotebookRole(c, next, coreRepo, source.notebook_id, user.id, requiredRole);
  };
}

/**
 * RBAC guard for routes that address a notebook via query parameter.
 * The parameter is mandatory, so no cross-notebook listing is possible.
 */
export function requireNotebookRoleFromQuery(
  coreRepo: CoreRepository,
  requiredRole: NotebookRole,
  queryParam = "notebookId"
): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get("sessionUser");
    if (!user) {
      return problemResponse(
        c,
        401,
        "Unauthorized",
        "Authentifizierung erforderlich.",
        "UNAUTHORIZED"
      );
    }
    const notebookId = c.req.query(queryParam);
    if (!notebookId) {
      return problemResponse(
        c,
        400,
        "Bad Request",
        `Parameter '${queryParam}' fehlt.`,
        "MISSING_PARAMETER"
      );
    }
    return enforceNotebookRole(c, next, coreRepo, notebookId, user.id, requiredRole);
  };
}

/**
 * Increments the user's quota counters after a successful (2xx) response.
 * Pairs with quotaGuardMiddleware, which only checks limits.
 */
export function recordQuotaUsage(
  actionResolver: (c: Context) => QuotaAction | null | Promise<QuotaAction | null>
): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const user = c.get("sessionUser");
    if (!user || !c.res.ok) {
      return;
    }
    const action = await actionResolver(c);
    if (action) {
      await incrementUserQuota((c.env as Env).DB, user.id, action);
    }
  };
}

/**
 * Reads the declared upload size from the JSON body (Hono caches the parsed body,
 * so the route handler can read it again). Invalid bodies yield null and are
 * rejected by the route itself.
 */
export async function resolveAddSourceAction(c: Context): Promise<QuotaAction | null> {
  try {
    const body = (await c.req.json()) as { byteSize?: unknown };
    if (typeof body.byteSize !== "number") {
      return null;
    }
    return { type: "add_source", notebookId: c.req.param("id") as string, byteSize: body.byteSize };
  } catch {
    return null;
  }
}

/**
 * Returns true when at least one real key-encryption key is configured.
 * Without it, createKeyVaultFromEnv would fall back to a public default KEK.
 */
export function hasConfiguredKek(env: Env): boolean {
  const record = env as unknown as Record<string, unknown>;
  const names = ["BYOK_MASTER_KEY", ...Array.from({ length: 10 }, (_, i) => `KEK_V${i + 1}`)];
  return names.some((name) => {
    const value = record[name];
    return typeof value === "string" && value.trim().length > 0;
  });
}

/**
 * Blocks BYOK key management when no KEK is configured (503 instead of encrypting
 * user keys with the public default KEK).
 */
export function requireConfiguredKek(): MiddlewareHandler {
  return async (c, next) => {
    if (!hasConfiguredKek(c.env as Env)) {
      return problemResponse(
        c,
        503,
        "Service Unavailable",
        "BYOK-Schlüsselverwaltung ist nicht konfiguriert (KEK fehlt).",
        "BYOK_NOT_CONFIGURED"
      );
    }
    await next();
  };
}

/**
 * Placeholder for endpoints that exist as modules but are not exposed yet because
 * an access check is missing. Answers 501 instead of serving them unprotected.
 */
export function notExposed(reason: string): MiddlewareHandler {
  return async (c) => problemResponse(c, 501, "Not Implemented", reason, "ENDPOINT_NOT_EXPOSED");
}
