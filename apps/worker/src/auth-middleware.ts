import { createProblemDetails } from "@notebook-lm/shared";
import type { MiddlewareHandler } from "hono";
import type { CoreRepository } from "./core-repository.js";
import { type SessionManager, extractSessionToken } from "./session.js";

export interface AuthMiddlewareOptions {
  repo: CoreRepository;
  saltSecret: string;
  allowedOrigins?: string[];
  isProduction?: boolean;
}

/**
 * Validates CSRF origin and Sec-Fetch-Site for state-changing HTTP methods.
 */
export function csrfProtection(options: {
  allowedOrigins?: string[];
  isProduction?: boolean;
}): MiddlewareHandler<{ Bindings: Env }> {
  const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

  return async (c, next) => {
    if (!mutatingMethods.has(c.req.method.toUpperCase())) {
      return next();
    }

    const secFetchSite = c.req.header("sec-fetch-site");
    if (secFetchSite && secFetchSite === "cross-site") {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "Cross-site requests are prohibited.",
        instance: c.req.path,
        code: "CSRF_CROSS_SITE_FORBIDDEN"
      });
      return c.json(problem, 403, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    const originHeader = c.req.header("origin");
    if (originHeader) {
      const reqUrl = new URL(c.req.url);
      const isSameOrigin = originHeader === reqUrl.origin;
      const isAllowed = options.allowedOrigins?.includes(originHeader);

      if (!isSameOrigin && !isAllowed) {
        const problem = createProblemDetails({
          status: 403,
          title: "Forbidden",
          detail: `Origin '${originHeader}' ist für mutierende Anfragen nicht autorisiert.`,
          instance: c.req.path,
          code: "CSRF_ORIGIN_FORBIDDEN"
        });
        return c.json(problem, 403, {
          "content-type": "application/problem+json; charset=utf-8"
        });
      }
    }

    return next();
  };
}

/**
 * Middleware that loads active session if present.
 */
export function sessionMiddleware(
  sessionManager: SessionManager
): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const cookieHeader = c.req.header("cookie");
    const rawToken = extractSessionToken(cookieHeader);

    if (rawToken) {
      const sessionData = await sessionManager.validateAndSlideSession(rawToken);
      if (sessionData) {
        c.set("sessionUser", sessionData.user);
        c.set("sessionIdHash", sessionData.sessionIdHash);
      }
    }

    return next();
  };
}

/**
 * Guard that enforces an active authenticated session.
 */
export function requireAuth(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const user = c.get("sessionUser");
    if (!user) {
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

    return next();
  };
}

const ROLE_RANK: Record<"viewer" | "editor" | "owner", number> = {
  viewer: 1,
  editor: 2,
  owner: 3
};

/**
 * RBAC guard that verifies the authenticated user has sufficient role on a workspace.
 */
export function requireWorkspaceRole(
  repo: CoreRepository,
  requiredRole: "viewer" | "editor" | "owner",
  workspaceIdParam = "workspaceId"
): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const user = c.get("sessionUser");
    if (!user) {
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

    const workspaceId = c.req.param(workspaceIdParam);
    if (!workspaceId) {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: `Parameter '${workspaceIdParam}' fehlt.`,
        instance: c.req.path,
        code: "MISSING_PARAMETER"
      });
      return c.json(problem, 400, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    const role = await repo.getWorkspaceMemberRole(workspaceId, user.id);
    if (!role) {
      // IDOR protection: return 404 or 403. Return 404 to avoid leaking workspace existence.
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Workspace wurde nicht gefunden.",
        instance: c.req.path,
        code: "WORKSPACE_NOT_FOUND"
      });
      return c.json(problem, 404, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    if (ROLE_RANK[role] < ROLE_RANK[requiredRole]) {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: `Erforderliche Rolle '${requiredRole}' wird von aktueller Rolle '${role}' nicht erfüllt.`,
        instance: c.req.path,
        code: "INSUFFICIENT_ROLE"
      });
      return c.json(problem, 403, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    return next();
  };
}

/**
 * RBAC guard that verifies the authenticated user has sufficient role on a notebook.
 */
export function requireNotebookRole(
  repo: CoreRepository,
  requiredRole: "viewer" | "editor" | "owner",
  notebookIdParam = "notebookId"
): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const user = c.get("sessionUser");
    if (!user) {
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

    const notebookId = c.req.param(notebookIdParam);
    if (!notebookId) {
      const problem = createProblemDetails({
        status: 400,
        title: "Bad Request",
        detail: `Parameter '${notebookIdParam}' fehlt.`,
        instance: c.req.path,
        code: "MISSING_PARAMETER"
      });
      return c.json(problem, 400, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    const notebook = await repo.getNotebookById(notebookId);
    if (!notebook) {
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Notebook wurde nicht gefunden.",
        instance: c.req.path,
        code: "NOTEBOOK_NOT_FOUND"
      });
      return c.json(problem, 404, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    // First check direct workspace membership role
    let userRole = await repo.getWorkspaceMemberRole(notebook.workspace_id, user.id);

    // If not found in workspace members, check notebook_shares
    if (!userRole) {
      const shares = await repo.db.query<{ role: "editor" | "viewer" }>(
        "SELECT role FROM notebook_shares WHERE notebook_id = ? AND user_id = ?",
        [notebookId, user.id]
      );
      if (shares.length > 0 && shares[0]) {
        userRole = shares[0].role;
      }
    }

    if (!userRole) {
      // IDOR protection: return 404 to avoid leaking notebook existence to unauthenticated/unauthorized users
      const problem = createProblemDetails({
        status: 404,
        title: "Not Found",
        detail: "Notebook wurde nicht gefunden.",
        instance: c.req.path,
        code: "NOTEBOOK_NOT_FOUND"
      });
      return c.json(problem, 404, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    if (ROLE_RANK[userRole] < ROLE_RANK[requiredRole]) {
      const problem = createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: `Erforderliche Rolle '${requiredRole}' wird von aktueller Rolle '${userRole}' nicht erfüllt.`,
        instance: c.req.path,
        code: "INSUFFICIENT_ROLE"
      });
      return c.json(problem, 403, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    return next();
  };
}
