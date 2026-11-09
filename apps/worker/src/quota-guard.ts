import { createProblemDetails } from "@notebook-lm/shared";
import type { Context, MiddlewareHandler } from "hono";
import { type ProfileQuotas, resolveAppConfig } from "./config.js";

export interface QuotaState {
  readonly userId: string;
  readonly notebooksCount: number;
  readonly sourcesCount: number;
  readonly storageBytes: number;
  readonly llmCallsDay: number;
  readonly quotaDay: string;
}

export type QuotaAction =
  | { type: "create_notebook" }
  | { type: "add_source"; notebookId: string; byteSize: number }
  | { type: "llm_call" };

/**
 * Returns current UTC date string YYYY-MM-DD.
 */
export function getUtcDayString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Loads or initializes the user quota record in D1.
 * Automatically resets llm_calls_day if quota_day is outdated (UTC day rollover).
 */
export async function getOrInitUserQuota(
  db: D1Database,
  userId: string,
  now: Date = new Date()
): Promise<QuotaState> {
  const currentDay = getUtcDayString(now);

  const existing = await db
    .prepare(
      `SELECT user_id, notebooks_count, sources_count, storage_bytes, llm_calls_day, quota_day
       FROM quotas WHERE user_id = ?`
    )
    .bind(userId)
    .first<{
      user_id: string;
      notebooks_count: number;
      sources_count: number;
      storage_bytes: number;
      llm_calls_day: number;
      quota_day: string;
    }>();

  if (!existing) {
    // Insert new quota row
    await db
      .prepare(
        `INSERT INTO quotas (user_id, notebooks_count, sources_count, storage_bytes, llm_calls_day, quota_day)
         VALUES (?, 0, 0, 0, 0, ?)`
      )
      .bind(userId, currentDay)
      .run();

    return {
      userId,
      notebooksCount: 0,
      sourcesCount: 0,
      storageBytes: 0,
      llmCallsDay: 0,
      quotaDay: currentDay
    };
  }

  // Check UTC day reset
  if (existing.quota_day !== currentDay) {
    await db
      .prepare(
        `UPDATE quotas
         SET llm_calls_day = 0, quota_day = ?
         WHERE user_id = ?`
      )
      .bind(currentDay, userId)
      .run();

    return {
      userId,
      notebooksCount: existing.notebooks_count,
      sourcesCount: existing.sources_count,
      storageBytes: existing.storage_bytes,
      llmCallsDay: 0,
      quotaDay: currentDay
    };
  }

  return {
    userId,
    notebooksCount: existing.notebooks_count,
    sourcesCount: existing.sources_count,
    storageBytes: existing.storage_bytes,
    llmCallsDay: existing.llm_calls_day,
    quotaDay: existing.quota_day
  };
}

export interface QuotaCheckResult {
  readonly allowed: boolean;
  readonly code: string;
  readonly reason: string;
}

/**
 * Validates whether an action is allowed within the user's quota limits.
 */
export async function verifyQuotaAction(
  db: D1Database,
  userId: string,
  action: QuotaAction,
  limits: ProfileQuotas,
  now: Date = new Date()
): Promise<QuotaCheckResult> {
  const quota = await getOrInitUserQuota(db, userId, now);

  if (action.type === "create_notebook") {
    if (quota.notebooksCount >= limits.maxNotebooksPerUser) {
      return {
        allowed: false,
        code: "QUOTA_MAX_NOTEBOOKS_EXCEEDED",
        reason: `Maximale Anzahl an Notizbüchern (${limits.maxNotebooksPerUser}) erreicht.`
      };
    }
    return { allowed: true, code: "OK", reason: "" };
  }

  if (action.type === "add_source") {
    // Check single source byte size
    if (action.byteSize > limits.maxSourceBytes) {
      return {
        allowed: false,
        code: "QUOTA_MAX_SOURCE_BYTES_EXCEEDED",
        reason: `Dateigröße (${Math.round(action.byteSize / 1024 / 1024)} MB) überschreitet das Limit von ${Math.round(limits.maxSourceBytes / 1024 / 1024)} MB pro Quelle.`
      };
    }

    // Check sources count per notebook
    if (quota.sourcesCount >= limits.maxSourcesPerNotebook) {
      return {
        allowed: false,
        code: "QUOTA_MAX_SOURCES_PER_NOTEBOOK_EXCEEDED",
        reason: `Maximale Quellenanzahl pro Notizbuch (${limits.maxSourcesPerNotebook}) erreicht.`
      };
    }

    return { allowed: true, code: "OK", reason: "" };
  }

  // action.type === "llm_call"
  if (quota.llmCallsDay >= limits.maxLlmCallsPerDay) {
    return {
      allowed: false,
      code: "QUOTA_MAX_LLM_CALLS_EXCEEDED",
      reason: `Tägliches Limit für KI-Aufrufe (${limits.maxLlmCallsPerDay}/Tag) erreicht. Reset erfolgt um 00:00 UTC.`
    };
  }
  return { allowed: true, code: "OK", reason: "" };
}

/**
 * Atomically increments quota counters after a successful operation.
 */
export async function incrementUserQuota(
  db: D1Database,
  userId: string,
  action: QuotaAction,
  now: Date = new Date()
): Promise<void> {
  const currentDay = getUtcDayString(now);

  if (action.type === "create_notebook") {
    await db
      .prepare(
        `UPDATE quotas
         SET notebooks_count = notebooks_count + 1
         WHERE user_id = ?`
      )
      .bind(userId)
      .run();
  } else if (action.type === "add_source") {
    await db
      .prepare(
        `UPDATE quotas
         SET sources_count = sources_count + 1,
             storage_bytes = storage_bytes + ?
         WHERE user_id = ?`
      )
      .bind(action.byteSize, userId)
      .run();
  } else {
    // action.type === "llm_call"
    await db
      .prepare(
        `UPDATE quotas
         SET llm_calls_day = CASE WHEN quota_day = ? THEN llm_calls_day + 1 ELSE 1 END,
             quota_day = ?
         WHERE user_id = ?`
      )
      .bind(currentDay, currentDay, userId)
      .run();
  }
}

/**
 * Hono middleware to guard routes against quota violations.
 */
export function quotaGuardMiddleware(
  actionResolver: (c: Context) => QuotaAction | null | Promise<QuotaAction | null>
): MiddlewareHandler {
  return async (c: Context, next: () => Promise<void>) => {
    const user = c.get("user") as { id: string } | undefined;
    if (!user || !user.id) {
      // If unauthenticated or guest without user object, let auth middleware handle or continue
      await next();
      return;
    }

    const db = (c.env as { DB?: D1Database } | undefined)?.DB;
    if (!db) {
      await next();
      return;
    }

    const action = await actionResolver(c);
    if (!action) {
      await next();
      return;
    }

    const config = resolveAppConfig(c.env as { APP_PROFILE?: string; APP_ORIGIN?: string });
    const check = await verifyQuotaAction(db, user.id, action, config.quotas);

    if (!check.allowed) {
      const problem = createProblemDetails({
        status: 403,
        title: "Quota Exceeded",
        detail: check.reason,
        instance: c.req.path,
        code: check.code
      });

      return c.json(problem, 403, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    await next();
  };
}
