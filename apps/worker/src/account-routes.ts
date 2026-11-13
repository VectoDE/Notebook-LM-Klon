import { createProblemDetails } from "@notebook-lm/shared";
import type { Hono } from "hono";
import { type MinimalR2Bucket, purgeUsers } from "./cleanup.js";
import type { CoreRepository } from "./core-repository.js";
import { buildClearSessionCookie } from "./session.js";

/** Value the client must send as {"confirm": ...} so an account is never deleted by accident. */
export const ACCOUNT_DELETE_CONFIRMATION = "DELETE_MY_ACCOUNT";

export interface AccountRoutesDependencies {
  readonly coreRepo: CoreRepository;
  readonly isProduction: boolean;
}

const PROBLEM_HEADERS = { "content-type": "application/problem+json; charset=utf-8" } as const;

/**
 * Self-service account routes (Art. 17 DSGVO).
 *
 * DELETE /api/v1/me removes the account immediately: all D1 rows of the user and
 * everything they own (cascading), plus all R2 objects under users/{id}/ and
 * notebooks/{id}/. Backups are not touched here; see docs/loeschkonzept.md for the
 * 30-day D1 Time Travel window.
 */
export function registerAccountRoutes(
  app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>,
  deps: AccountRoutesDependencies
): void {
  app.delete("/api/v1/me", async (c) => {
    const sessionUser = c.get("sessionUser");
    if (!sessionUser) {
      return c.json(
        createProblemDetails({
          status: 401,
          title: "Unauthorized",
          detail: "Authentifizierung erforderlich.",
          instance: c.req.path,
          code: "UNAUTHORIZED"
        }),
        401,
        PROBLEM_HEADERS
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = null;
    }
    const confirm = (body as { confirm?: unknown } | null)?.confirm;
    if (confirm !== ACCOUNT_DELETE_CONFIRMATION) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: `Bestätigung fehlt: Body {"confirm":"${ACCOUNT_DELETE_CONFIRMATION}"} erforderlich.`,
          instance: c.req.path,
          code: "CONFIRMATION_REQUIRED"
        }),
        400,
        PROBLEM_HEADERS
      );
    }

    const mediaBucket = (c.env.MEDIA ?? null) as MinimalR2Bucket | null;
    const result = await purgeUsers(deps.coreRepo.db, mediaBucket, [sessionUser.id]);

    return c.json(
      {
        deleted: result.deletedUsers === 1,
        deletedNotebooks: result.deletedNotebooks,
        deletedR2Objects: result.deletedR2Objects
      },
      200,
      {
        "cache-control": "no-store",
        "set-cookie": buildClearSessionCookie(deps.isProduction)
      }
    );
  });
}
