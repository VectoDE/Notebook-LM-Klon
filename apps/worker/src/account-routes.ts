import { createProblemDetails } from "@notebook-lm/shared";
import type { Hono } from "hono";
import { type MinimalR2Bucket, createNotebookStatePurger, purgeUsers } from "./cleanup.js";
import type { CoreRepository } from "./core-repository.js";
import { buildClearSessionCookie } from "./session.js";

/** Value the client must send as {"confirm": ...} so an account is never deleted by accident. */
export const ACCOUNT_DELETE_CONFIRMATION = "DELETE_MY_ACCOUNT";

/**
 * Maximum age of the session for deleting a non-guest account. Both login methods
 * (passkey, magic link) create a new session, so session age is the time since the last
 * proof of identity. Older sessions must sign in again first.
 */
export const REAUTH_MAX_AGE_MS = 5 * 60 * 1000;

export interface AccountRoutesDependencies {
  readonly coreRepo: CoreRepository;
  readonly isProduction: boolean;
}

const PROBLEM_HEADERS = { "content-type": "application/problem+json; charset=utf-8" } as const;

/**
 * Self-service account routes (Art. 17 DSGVO).
 *
 * DELETE /api/v1/me requires a session younger than 5 minutes (non-guests, else 403
 * REAUTH_REQUIRED) and removes the account immediately: all D1 rows of the user and
 * everything they own (cascading), plus all R2 objects under users/{id}/ and
 * notebooks/{id}/. Backups are not touched here; see docs/loeschkonzept.md for the
 * 30-day D1 Time Travel window.
 */
export function registerAccountRoutes(
  app: Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>,
  deps: AccountRoutesDependencies
): void {
  app.delete("/api/v1/me", async (c) => {
    const sessionUser = c.get("sessionUser") as { id: string; isGuest?: boolean } | undefined;
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

    // Fresh proof of identity: a stolen cookie must not be enough for an irreversible deletion.
    // Guest accounts have no e-mail or passkey to prove, they expire after 24 h anyway.
    if (sessionUser.isGuest !== true) {
      const idHash = c.get("sessionIdHash");
      const session = idHash ? await deps.coreRepo.getSession(idHash) : null;
      if (!session || Date.now() - session.created_at > REAUTH_MAX_AGE_MS) {
        return c.json(
          createProblemDetails({
            status: 403,
            title: "Forbidden",
            detail:
              "Zum Löschen des Kontos ist eine frische Anmeldung nötig (höchstens 5 Minuten alt). Bitte melden Sie sich erneut an (Passkey oder Magic-Link) und wiederholen Sie die Löschung.",
            instance: c.req.path,
            code: "REAUTH_REQUIRED"
          }),
          403,
          PROBLEM_HEADERS
        );
      }
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
    const result = await purgeUsers(
      deps.coreRepo.db,
      mediaBucket,
      [sessionUser.id],
      Date.now(),
      createNotebookStatePurger(c.env.NOTEBOOK_DO, c.env.JOB_DO)
    );

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
