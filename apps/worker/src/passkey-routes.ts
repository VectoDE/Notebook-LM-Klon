import { createProblemDetails } from "@notebook-lm/shared";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { Hono } from "hono";
import { requireAuth } from "./auth-middleware.js";
import type { CoreRepository } from "./core-repository.js";
import type { PasskeyService } from "./passkey-service.js";
import { resolveClientIp } from "./rate-limiter.js";
import { type SessionManager, buildSessionCookie } from "./session.js";
import { requireTurnstile } from "./turnstile.js";

export function createPasskeyRoutes(opts: {
  repo: CoreRepository;
  passkeyService: PasskeyService;
  sessionManager: SessionManager;
  isProduction?: boolean;
  /**
   * Turnstile secret (TURNSTILE_SECRET_KEY). Registration options are only issued after a
   * confirmed bot check (#343); without the secret registration is disabled (503, fail-closed).
   */
  turnstileSecretKey?: string | undefined;
  customFetch?: typeof fetch | undefined;
}): Hono<{ Bindings: Env }> {
  const router = new Hono<{ Bindings: Env }>();

  // 1. Registration Options (Requires active authenticated session, e.g. guest or user)
  // and a confirmed Turnstile check (#343). Without options there is no challenge, so
  // /register/verify cannot succeed without passing this gate first.
  router.post("/register/options", requireAuth(), async (c) => {
    let body: { turnstileToken?: unknown } = {};
    try {
      body = (await c.req.json()) as { turnstileToken?: unknown };
    } catch {
      body = {};
    }
    const botCheck = await requireTurnstile(c, body?.turnstileToken, {
      secretKey: opts.turnstileSecretKey,
      customFetch: opts.customFetch
    });
    if (botCheck) {
      return botCheck;
    }

    const sessionUser = c.get("sessionUser");
    /* v8 ignore next */
    const user = sessionUser ? await opts.repo.getUserById(sessionUser.id) : null;
    /* v8 ignore next 4 */
    if (!user) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "Nutzer nicht gefunden.",
          instance: c.req.path,
          code: "USER_NOT_FOUND"
        }),
        404,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    const options = await opts.passkeyService.generateRegistrationOptions(user);
    return c.json(options, 200, { "content-type": "application/json; charset=utf-8" });
  });

  // 2. Registration Verification
  router.post("/register/verify", requireAuth(), async (c) => {
    const sessionUser = c.get("sessionUser");
    /* v8 ignore next */
    const user = sessionUser ? await opts.repo.getUserById(sessionUser.id) : null;
    /* v8 ignore next 4 */
    if (!user) {
      return c.json(
        createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: "Nutzer nicht gefunden.",
          instance: c.req.path,
          code: "USER_NOT_FOUND"
        }),
        404,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    let body: RegistrationResponseJSON;
    try {
      body = (await c.req.json()) as RegistrationResponseJSON;
    } catch {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: "Ungültiges JSON im Request-Body.",
          instance: c.req.path,
          code: "INVALID_JSON"
        }),
        400,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    try {
      const result = await opts.passkeyService.verifyRegistration(user, body);
      if (!result.verified) {
        return c.json(
          createProblemDetails({
            status: 400,
            title: "Bad Request",
            detail: "WebAuthn-Attestierung fehlgeschlagen.",
            instance: c.req.path,
            code: "WEBAUTHN_VERIFICATION_FAILED"
          }),
          400,
          { "content-type": "application/problem+json; charset=utf-8" }
        );
      }

      return c.json({ verified: true, upgradedToPermanent: result.upgradedToPermanent }, 200, {
        "content-type": "application/json; charset=utf-8"
      });
    } catch (err) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: (err as Error).message,
          instance: c.req.path,
          code: "REGISTRATION_ERROR"
        }),
        400,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }
  });

  // 3. Login Options (Public, Discoverable Credentials)
  router.post("/login/options", async (c) => {
    const options = await opts.passkeyService.generateLoginOptions();
    return c.json(options, 200, { "content-type": "application/json; charset=utf-8" });
  });

  // 4. Login Verification (Public)
  router.post("/login/verify", async (c) => {
    let body: AuthenticationResponseJSON;
    try {
      body = (await c.req.json()) as AuthenticationResponseJSON;
    } catch {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: "Ungültiges JSON im Request-Body.",
          instance: c.req.path,
          code: "INVALID_JSON"
        }),
        400,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }

    try {
      const result = await opts.passkeyService.verifyLogin(body);
      if (!result.verified) {
        return c.json(
          createProblemDetails({
            status: 400,
            title: "Bad Request",
            detail: "WebAuthn-Assertion fehlgeschlagen.",
            instance: c.req.path,
            code: "WEBAUTHN_ASSERTION_FAILED"
          }),
          400,
          { "content-type": "application/problem+json; charset=utf-8" }
        );
      }

      // Create new session & rotate
      const ip = resolveClientIp(c) ?? null;
      const ua = c.req.header("user-agent") ?? null;
      const session = await opts.sessionManager.createSession(result.user.id, ip, ua);

      const cookieHeader = buildSessionCookie(
        session.rawToken,
        opts.isProduction === true,
        7 * 24 * 60 * 60
      );

      return c.json(
        {
          verified: true,
          user: {
            id: result.user.id,
            email: result.user.email,
            displayName: result.user.display_name,
            locale: result.user.locale,
            isGuest: Boolean(result.user.is_guest)
          }
        },
        200,
        {
          "content-type": "application/json; charset=utf-8",
          "set-cookie": cookieHeader
        }
      );
    } catch (err) {
      return c.json(
        createProblemDetails({
          status: 400,
          title: "Bad Request",
          detail: (err as Error).message,
          instance: c.req.path,
          code: "AUTH_VERIFICATION_ERROR"
        }),
        400,
        { "content-type": "application/problem+json; charset=utf-8" }
      );
    }
  });

  return router;
}
