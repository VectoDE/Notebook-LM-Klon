/**
 * Demo Key Resolver, Rate Limiter & Security Guard.
 *
 * Implements Sub-Issue #109 (Decision #45):
 * - Resolves central DEMO_GEMINI_KEY only for demo notebooks when BYOK key is absent
 * - Blocks DEMO_GEMINI_KEY usage for private notebooks
 * - Enforces strict Demo-Key rate limits:
 *   - max 5 requests / minute
 *   - max 20 requests / day per client (IP or Guest)
 * - Returns transparent rate limit headers
 * - Returns privacy disclaimer header:
 *   "Demo-Modus: Bitte keine vertraulichen Kundendaten eingeben (Free-Tier)"
 */

import { isDemoNotebookId } from "@notebook-lm/shared";
import type { Context } from "hono";
import { type RateLimitConfig, checkRateLimit, extractClientIdentifier } from "./rate-limiter.js";

export const DEMO_HEADER_DISCLAIMER_KEY = "X-Demo-Notice";
export const DEMO_DISCLAIMER_TEXT =
  "Demo-Modus: Bitte keine vertraulichen Kundendaten eingeben (Free-Tier)";

export const DEMO_RATE_LIMIT_PER_MINUTE: RateLimitConfig = {
  limit: 5,
  windowMs: 60_000 // 1 minute
};

export const DEMO_RATE_LIMIT_PER_DAY: RateLimitConfig = {
  limit: 20,
  windowMs: 24 * 60 * 60 * 1000 // 24 hours
};

export interface ResolveDemoKeyOptions {
  notebookId: string;
  hasUserKey: boolean;
  demoApiKey?: string | undefined;
  env?:
    | {
        DEMO_GEMINI_KEY?: string | undefined;
      }
    | undefined;
}

export interface DemoKeyResolution {
  useDemoKey: boolean;
  apiKey: string | null;
  isDemoNotebook: boolean;
  warningHeader?: string | undefined;
}

/**
 * Resolves whether the DEMO_GEMINI_KEY can be used for the requested notebook.
 * Enforces rule: DEMO_GEMINI_KEY is ONLY permitted for official demo notebooks!
 */
export function resolveDemoGeminiKey(opts: ResolveDemoKeyOptions): DemoKeyResolution {
  const isDemo = isDemoNotebookId(opts.notebookId);
  const demoKey =
    opts.demoApiKey ?? opts.env?.DEMO_GEMINI_KEY ?? process.env.DEMO_GEMINI_KEY ?? null;

  if (opts.hasUserKey) {
    return {
      useDemoKey: false,
      apiKey: null,
      isDemoNotebook: isDemo
    };
  }

  // If this is a demo notebook and demoKey is present:
  if (isDemo && demoKey) {
    return {
      useDemoKey: true,
      apiKey: demoKey,
      isDemoNotebook: true,
      warningHeader: DEMO_DISCLAIMER_TEXT
    };
  }

  return {
    useDemoKey: false,
    apiKey: null,
    isDemoNotebook: isDemo
  };
}

export interface DemoRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
  reason?: "minute" | "day" | undefined;
}

/**
 * Checks dual-window rate limiting for the shared Demo-Key:
 * 1. 5 req / minute
 * 2. 20 req / day
 */
export async function checkDemoKeyRateLimit(
  c: Context,
  d1?: D1Database
): Promise<DemoRateLimitResult> {
  const clientId = extractClientIdentifier(c);

  // 1. Check minute window
  const minuteBucket = `rl:demo:min:${clientId}`;
  const minuteRes = await checkRateLimit(minuteBucket, DEMO_RATE_LIMIT_PER_MINUTE, d1);
  if (!minuteRes.allowed) {
    return {
      ...minuteRes,
      reason: "minute"
    };
  }

  // 2. Check daily window
  const dayBucket = `rl:demo:day:${clientId}`;
  const dayRes = await checkRateLimit(dayBucket, DEMO_RATE_LIMIT_PER_DAY, d1);
  if (!dayRes.allowed) {
    return {
      ...dayRes,
      reason: "day"
    };
  }

  return {
    allowed: true,
    limit: DEMO_RATE_LIMIT_PER_MINUTE.limit,
    remaining: Math.min(minuteRes.remaining, dayRes.remaining),
    retryAfterSeconds: 0,
    resetAt: minuteRes.resetAt
  };
}

/**
 * Attaches demo privacy & rate-limit headers to a response.
 */
export function attachDemoHeaders(c: Context, rateLimit?: DemoRateLimitResult): void {
  c.header(DEMO_HEADER_DISCLAIMER_KEY, DEMO_DISCLAIMER_TEXT);
  if (rateLimit !== undefined) {
    c.header("X-Demo-RateLimit-Limit", rateLimit.limit.toString());
    c.header("X-Demo-RateLimit-Remaining", rateLimit.remaining.toString());
    c.header("X-Demo-RateLimit-Reset", Math.ceil(rateLimit.resetAt / 1000).toString());
  }
}
