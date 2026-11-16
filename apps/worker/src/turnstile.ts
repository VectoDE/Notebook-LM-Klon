import { createProblemDetails } from "@notebook-lm/shared";
import type { Context } from "hono";
import { resolveClientIp } from "./rate-limiter.js";

export interface TurnstileVerifyOptions {
  secretKey: string;
  token: string;
  remoteIp?: string | null;
  idempotencyKey?: string | null;
  siteverifyEndpoint?: string;
}

export interface TurnstileVerifyResult {
  success: boolean;
  challengeTs?: string | undefined;
  hostname?: string | undefined;
  errorCodes?: string[] | undefined;
  action?: string | undefined;
  cdata?: string | undefined;
}

// Official Cloudflare Turnstile test keys for CI/dev
export const TURNSTILE_TEST_SECRET_ALWAYS_PASSES = "1x0000000000000000000000000000000AA";
export const TURNSTILE_TEST_SECRET_ALWAYS_FAILS = "2x0000000000000000000000000000000AA";
export const TURNSTILE_TEST_SECRET_TOKEN_ALREADY_SPENT = "3x0000000000000000000000000000000AA";

export const DEFAULT_TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verifies a Cloudflare Turnstile response token with the Siteverify API.
 */
export async function verifyTurnstileToken(
  opts: TurnstileVerifyOptions,
  customFetch: typeof fetch = fetch
): Promise<TurnstileVerifyResult> {
  const fetchFn = customFetch;
  const endpoint = opts.siteverifyEndpoint ?? DEFAULT_TURNSTILE_SITEVERIFY_URL;

  const formData = new FormData();
  formData.append("secret", opts.secretKey);
  formData.append("response", opts.token);

  if (opts.remoteIp) {
    formData.append("remoteip", opts.remoteIp);
  }
  if (opts.idempotencyKey) {
    formData.append("idempotency_key", opts.idempotencyKey);
  }

  try {
    const res = await fetchFn(endpoint, {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      return {
        success: false,
        errorCodes: [`http-status-${res.status}`]
      };
    }

    const data = (await res.json()) as {
      success: boolean;
      challenge_ts?: string;
      hostname?: string;
      "error-codes"?: string[];
      action?: string;
      cdata?: string;
    };

    return {
      success: Boolean(data.success),
      challengeTs: data.challenge_ts,
      hostname: data.hostname,
      errorCodes: data["error-codes"],
      action: data.action,
      cdata: data.cdata
    };
  } catch {
    return {
      success: false,
      errorCodes: ["network-error"]
    };
  }
}

export interface TurnstileGuardOptions {
  /** TURNSTILE_SECRET_KEY. Missing or blank means the protected action is disabled (503). */
  secretKey?: string | undefined;
  customFetch?: typeof fetch | undefined;
}

const PROBLEM_HEADERS = { "content-type": "application/problem+json; charset=utf-8" };

/**
 * Fail-closed bot check shared by every Turnstile-protected route:
 * missing secret -> 503, missing or rejected token -> 403.
 * Returns null only when Siteverify confirmed the token. The client IP for `remoteip`
 * comes from resolveClientIp() and is never read from client-supplied headers.
 */
export async function requireTurnstile(
  c: Context,
  token: unknown,
  opts: TurnstileGuardOptions
): Promise<Response | null> {
  const secretKey = opts.secretKey?.trim();
  if (!secretKey) {
    return c.json(
      createProblemDetails({
        status: 503,
        title: "Service Unavailable",
        detail:
          "Bot-Schutz ist nicht konfiguriert (TURNSTILE_SECRET_KEY fehlt). Anmeldung ist deaktiviert.",
        instance: c.req.path,
        code: "TURNSTILE_NOT_CONFIGURED"
      }),
      503,
      PROBLEM_HEADERS
    );
  }

  if (typeof token !== "string" || token.trim() === "") {
    return c.json(
      createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "Turnstile-Token fehlt. Bitte die Bot-Prüfung abschließen.",
        instance: c.req.path,
        code: "BOT_VERIFICATION_REQUIRED"
      }),
      403,
      PROBLEM_HEADERS
    );
  }

  const verifyRes = await verifyTurnstileToken(
    { secretKey, token, remoteIp: resolveClientIp(c) ?? null },
    opts.customFetch
  );

  if (!verifyRes.success) {
    return c.json(
      createProblemDetails({
        status: 403,
        title: "Forbidden",
        detail: "Turnstile Bot-Verifikation fehlgeschlagen.",
        instance: c.req.path,
        code: "BOT_VERIFICATION_FAILED"
      }),
      403,
      PROBLEM_HEADERS
    );
  }

  return null;
}
