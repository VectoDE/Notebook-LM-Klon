import { createProblemDetails } from "@notebook-lm/shared";
import type { Context, MiddlewareHandler } from "hono";

export type RateLimitCategory = "auth" | "chat" | "uploads" | "comments" | "general";

export interface RateLimitConfig {
  readonly limit: number; // Max requests allowed per window
  readonly windowMs: number; // Window duration in milliseconds (default 60,000ms = 1 min)
}

export const RATE_LIMIT_RULES: Record<RateLimitCategory, RateLimitConfig> = {
  auth: { limit: 5, windowMs: 60_000 },
  chat: { limit: 20, windowMs: 60_000 },
  uploads: { limit: 10, windowMs: 60_000 },
  // Comments (Issue #353): own bucket so a burst of comments cannot use up the general budget
  comments: { limit: 60, windowMs: 60_000 },
  general: { limit: 120, windowMs: 60_000 }
};

interface MemoryBucket {
  count: number;
  resetAt: number;
}

// In-Memory store for fast rate limiting across warm worker invocations
const inMemoryStore = new Map<string, MemoryBucket>();

export function clearRateLimitMemory(): void {
  inMemoryStore.clear();
}

export interface RateLimitOptions {
  readonly category: RateLimitCategory;
  readonly keyExtractor?: (c: Context) => string | Promise<string>;
}

/**
 * Socket addresses registered by the Node server per request. Clients cannot write to this map,
 * unlike request headers.
 */
const socketAddresses = new WeakMap<Request, string>();

/** Records the TCP peer address of a request (called by the Node server only). */
export function registerSocketAddress(request: Request, address: string | undefined): void {
  const trimmed = address?.trim();
  if (trimmed) {
    socketAddresses.set(request, trimmed);
  }
}

/** Identifier shared by all requests whose client address cannot be determined. */
export const UNKNOWN_CLIENT_IDENTIFIER = "ip:unknown";

/** True when running inside the Cloudflare Workers runtime. */
export function isCloudflareRuntime(): boolean {
  const nav = (globalThis as { navigator?: { userAgent?: string } }).navigator;
  return nav?.userAgent === "Cloudflare-Workers";
}

/**
 * Returns the header the operator trusts for the client IP (env TRUSTED_PROXY_HEADER),
 * lowercased, or undefined when none is configured.
 */
export function resolveTrustedProxyHeader(env: unknown): string | undefined {
  const raw = (env as { TRUSTED_PROXY_HEADER?: unknown } | undefined)?.TRUSTED_PROXY_HEADER;
  if (typeof raw !== "string") return undefined;
  const name = raw.trim().toLowerCase();
  return name.length > 0 ? name : undefined;
}

/**
 * Takes the last entry of a comma-separated header. A trusted proxy appends the address it saw,
 * so earlier entries can come from the client and must not be used.
 */
function lastHeaderEntry(value: string | undefined): string | undefined {
  const last = value?.split(",").pop()?.trim();
  return last ? last : undefined;
}

/**
 * Resolves the client IP from a source the operator trusts, in this order:
 * 1. TRUSTED_PROXY_HEADER, if configured (e.g. "x-forwarded-for" behind a reverse proxy)
 * 2. cf-connecting-ip, only inside the Cloudflare runtime (set by the Cloudflare edge)
 * 3. The socket address recorded by the Node server
 * Client-supplied headers are never read without one of these guarantees.
 */
export function resolveClientIp(c: Context): string | undefined {
  const trustedHeader = resolveTrustedProxyHeader(c.env);
  if (trustedHeader) {
    return lastHeaderEntry(c.req.header(trustedHeader));
  }

  if (isCloudflareRuntime()) {
    return c.req.header("cf-connecting-ip")?.trim() || undefined;
  }

  return socketAddresses.get(c.req.raw);
}

/**
 * Extracts a client identifier: the session user if present, otherwise the trusted client IP.
 */
export function extractClientIdentifier(c: Context): string {
  // 1. If authenticated session exists in context, use that
  const user = c.get("user") as { id?: string } | undefined;
  if (user?.id) {
    return `usr:${user.id}`;
  }

  // 2. Client IP from a trusted source only
  const ip = resolveClientIp(c);
  return ip ? `ip:${ip}` : UNKNOWN_CLIENT_IDENTIFIER;
}

/**
 * Resolves rate limit category for standard paths if not explicitly configured.
 */
export function resolveCategoryFromPath(path: string): RateLimitCategory {
  if (
    path.startsWith("/api/v1/auth") ||
    path.includes("/passkey") ||
    path.includes("/magic-link")
  ) {
    return "auth";
  }
  if (
    path.includes("/chat") ||
    path.includes("/llm") ||
    path.includes("/generate") ||
    path.includes("/ask")
  ) {
    return "chat";
  }
  if (path.includes("/upload") || path.includes("/sources/file") || path.includes("/media")) {
    return "uploads";
  }
  if (path.includes("/comments") || path.endsWith("/mentions") || path.endsWith("/members")) {
    return "comments";
  }
  return "general";
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
  readonly resetAt: number;
}

/**
 * Checks and increments rate limit counter.
 * Uses In-Memory with sliding window / fixed window reset, with optional D1 persistence fallback.
 */
export async function checkRateLimit(
  bucketKey: string,
  config: RateLimitConfig,
  db?: D1Database
): Promise<RateLimitResult> {
  const now = Date.now();
  const bucket = inMemoryStore.get(bucketKey);

  // If memory bucket exists and still within window:
  if (bucket && now < bucket.resetAt) {
    if (bucket.count >= config.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      return {
        allowed: false,
        limit: config.limit,
        remaining: 0,
        retryAfterSeconds,
        resetAt: bucket.resetAt
      };
    }
    bucket.count += 1;
    const remaining = Math.max(0, config.limit - bucket.count);
    return {
      allowed: true,
      limit: config.limit,
      remaining,
      retryAfterSeconds: 0,
      resetAt: bucket.resetAt
    };
  }

  // If D1 is available and in-memory is empty/expired, check D1 fallback
  if (db) {
    try {
      const windowStart = Math.floor(now / config.windowMs) * config.windowMs;
      const resetAt = windowStart + config.windowMs;

      const query = `
        INSERT INTO rate_limits (bucket, count, window_start)
        VALUES (?, 1, ?)
        ON CONFLICT(bucket) DO UPDATE SET
          count = CASE WHEN window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
          window_start = excluded.window_start
        RETURNING count, window_start;
      `;
      const res = await db.prepare(query).bind(bucketKey, windowStart).first<{
        count: number;
        window_start: number;
      }>();

      const count = res ? res.count : 1;
      inMemoryStore.set(bucketKey, { count, resetAt });

      if (count > config.limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
        return {
          allowed: false,
          limit: config.limit,
          remaining: 0,
          retryAfterSeconds,
          resetAt
        };
      }

      return {
        allowed: true,
        limit: config.limit,
        remaining: Math.max(0, config.limit - count),
        retryAfterSeconds: 0,
        resetAt
      };
    } catch {
      // Fallback silently to memory-only if D1 query fails or tables not yet ready
    }
  }

  // New in-memory window
  const resetAt = now + config.windowMs;
  inMemoryStore.set(bucketKey, { count: 1, resetAt });
  return {
    allowed: true,
    limit: config.limit,
    remaining: config.limit - 1,
    retryAfterSeconds: 0,
    resetAt
  };
}

/**
 * Creates rate limiting middleware for Hono routes.
 */
export function rateLimiterMiddleware(options?: Partial<RateLimitOptions>): MiddlewareHandler {
  return async (c: Context, next: () => Promise<void>) => {
    const category = options?.category ?? resolveCategoryFromPath(c.req.path);
    const rule = RATE_LIMIT_RULES[category];

    const identifier = options?.keyExtractor
      ? await options.keyExtractor(c)
      : extractClientIdentifier(c);

    const bucketKey = `rl:${category}:${identifier}`;
    const db = (c.env as { DB?: D1Database } | undefined)?.DB;

    const result = await checkRateLimit(bucketKey, rule, db);

    c.header("X-RateLimit-Limit", rule.limit.toString());
    c.header("X-RateLimit-Remaining", result.remaining.toString());
    c.header("X-RateLimit-Reset", Math.ceil(result.resetAt / 1000).toString());

    if (!result.allowed) {
      c.header("Retry-After", result.retryAfterSeconds.toString());
      const problem = createProblemDetails({
        status: 429,
        title: "Too Many Requests",
        detail: `Ratenbegrenzung für Kategorie '${category}' überschritten (${rule.limit} Requests / Minute). Bitte versuchen Sie es in ${result.retryAfterSeconds} Sekunden erneut.`,
        instance: c.req.path,
        code: "RATE_LIMIT_EXCEEDED"
      });

      return c.json(problem, 429, {
        "content-type": "application/problem+json; charset=utf-8",
        "Retry-After": result.retryAfterSeconds.toString()
      });
    }

    await next();
  };
}
