import type { Context, MiddlewareHandler } from "hono";

export const CSP_HEADER_VALUE =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' http://localhost:11434 https://challenges.cloudflare.com https://generativelanguage.googleapis.com; frame-src https://challenges.cloudflare.com; media-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests;";

export const HSTS_HEADER_VALUE = "max-age=63072000; includeSubDomains; preload";
export const X_CONTENT_TYPE_OPTIONS_VALUE = "nosniff";
export const REFERRER_POLICY_VALUE = "strict-origin-when-cross-origin";
export const PERMISSIONS_POLICY_VALUE =
  "camera=(), microphone=(self), geolocation=(), interest-cohort=()";
export const COOP_HEADER_VALUE = "same-origin";
export const CORP_HEADER_VALUE = "same-origin";

/**
 * Applies strict security headers to all responses.
 * Follows Sub-Issue #77 requirements.
 */
export function applySecurityHeaders(headers: Headers): void {
  headers.set("Content-Security-Policy", CSP_HEADER_VALUE);
  headers.set("Strict-Transport-Security", HSTS_HEADER_VALUE);
  headers.set("X-Content-Type-Options", X_CONTENT_TYPE_OPTIONS_VALUE);
  headers.set("Referrer-Policy", REFERRER_POLICY_VALUE);
  headers.set("Permissions-Policy", PERMISSIONS_POLICY_VALUE);
  headers.set("Cross-Origin-Opener-Policy", COOP_HEADER_VALUE);
  headers.set("Cross-Origin-Resource-Policy", CORP_HEADER_VALUE);
}

/**
 * Hono middleware to append strict security headers.
 */
export function securityHeadersMiddleware(): MiddlewareHandler {
  return async (c: Context, next: () => Promise<void>) => {
    await next();
    applySecurityHeaders(c.res.headers);
  };
}
