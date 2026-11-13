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

export const NOTEBOOK_SIZE_LIMIT_CODE = "NOTEBOOK_SIZE_LIMIT";

function formatMegabytes(bytes: number): string {
  return (Math.round((bytes / 1024 / 1024) * 100) / 100).toString();
}

/**
 * HTTP status for a denied quota check: 413 for the notebook size limit, 403 otherwise.
 */
export function quotaDenialStatus(code: string): 403 | 413 {
  return code === NOTEBOOK_SIZE_LIMIT_CODE ? 413 : 403;
}

export interface QuotaCheckResult {
  readonly allowed: boolean;
  readonly code: string;
  /** German message (default). */
  readonly reason: string;
  /** English message, chosen when the client prefers English (Accept-Language). */
  readonly reasonEn: string;
}

const ALLOWED: QuotaCheckResult = { allowed: true, code: "OK", reason: "", reasonEn: "" };

/**
 * True when the first language in an Accept-Language header is English.
 * German stays the default for missing or other languages.
 */
export function prefersEnglish(acceptLanguage: string | undefined | null): boolean {
  // split() always returns at least one element, so [0] is defined.
  const first = ((acceptLanguage ?? "").split(",")[0] as string).trim().toLowerCase();
  return first === "en" || first.startsWith("en-") || first.startsWith("en;");
}

/** Picks the German or English quota message for an Accept-Language header. */
export function localizedQuotaReason(
  check: QuotaCheckResult,
  acceptLanguage: string | undefined | null
): string {
  return prefersEnglish(acceptLanguage) ? check.reasonEn : check.reason;
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
        reason: `Maximale Anzahl an Notizbüchern (${limits.maxNotebooksPerUser}) erreicht.`,
        reasonEn: `You have reached the maximum number of notebooks (${limits.maxNotebooksPerUser}).`
      };
    }
    return ALLOWED;
  }

  if (action.type === "add_source") {
    // Check single source byte size
    if (action.byteSize > limits.maxSourceBytes) {
      return {
        allowed: false,
        code: "QUOTA_MAX_SOURCE_BYTES_EXCEEDED",
        reason: `Die Datei ist ${formatMegabytes(action.byteSize)} MB groß. Erlaubt sind höchstens ${formatMegabytes(limits.maxSourceBytes)} MB pro Quelle.`,
        reasonEn: `The file is ${formatMegabytes(action.byteSize)} MB. Each source may be at most ${formatMegabytes(limits.maxSourceBytes)} MB.`
      };
    }

    // Per-notebook totals come from the sources table (the quotas row is per user).
    const totals = await db
      .prepare(
        `SELECT COUNT(*) AS source_count, COALESCE(SUM(byte_size), 0) AS total_bytes
         FROM sources WHERE notebook_id = ?`
      )
      .bind(action.notebookId)
      .first<{ source_count: number; total_bytes: number }>();
    const sourceCount = Number(totals?.source_count ?? 0);
    const totalBytes = Number(totals?.total_bytes ?? 0);

    // Check sources count per notebook
    if (sourceCount >= limits.maxSourcesPerNotebook) {
      return {
        allowed: false,
        code: "QUOTA_MAX_SOURCES_PER_NOTEBOOK_EXCEEDED",
        reason: `Dieses Notizbuch hat schon ${limits.maxSourcesPerNotebook} Quellen, mehr sind nicht möglich. Entfernen Sie eine Quelle oder legen Sie ein neues Notizbuch an.`,
        reasonEn: `This notebook already has ${limits.maxSourcesPerNotebook} sources, the maximum. Remove a source or create a new notebook.`
      };
    }

    // Check total size of all sources in the notebook (exactly the limit is allowed)
    if (totalBytes + action.byteSize > limits.maxNotebookBytes) {
      return {
        allowed: false,
        code: NOTEBOOK_SIZE_LIMIT_CODE,
        reason: `Notizbuch-Limit von ${formatMegabytes(limits.maxNotebookBytes)} MB überschritten: aktuell ${formatMegabytes(totalBytes)} MB, die neue Quelle (${formatMegabytes(action.byteSize)} MB) würde das Limit sprengen.`,
        reasonEn: `Notebook limit of ${formatMegabytes(limits.maxNotebookBytes)} MB exceeded: the notebook holds ${formatMegabytes(totalBytes)} MB, the new source (${formatMegabytes(action.byteSize)} MB) does not fit.`
      };
    }

    return ALLOWED;
  }

  // action.type === "llm_call"
  if (quota.llmCallsDay >= limits.maxLlmCallsPerDay) {
    return {
      allowed: false,
      code: "QUOTA_MAX_LLM_CALLS_EXCEEDED",
      reason: `Tägliches Limit für KI-Aufrufe (${limits.maxLlmCallsPerDay}/Tag) erreicht. Reset erfolgt um 00:00 UTC.`,
      reasonEn: `Daily limit for AI requests (${limits.maxLlmCallsPerDay}/day) reached. It resets at 00:00 UTC.`
    };
  }
  return ALLOWED;
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
      const status = quotaDenialStatus(check.code);
      const problem = createProblemDetails({
        status,
        title: status === 413 ? "Payload Too Large" : "Quota Exceeded",
        detail: localizedQuotaReason(check, c.req.header("accept-language")),
        instance: c.req.path,
        code: check.code
      });

      return c.json(problem, status, {
        "content-type": "application/problem+json; charset=utf-8"
      });
    }

    await next();
  };
}
