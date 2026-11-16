import type { AuditLogRow } from "@notebook-lm/shared";
import type { Context } from "hono";
import type { CoreRepository, DatabaseAdapter } from "./core-repository.js";
import { resolveClientIp } from "./rate-limiter.js";
import { computeDailySaltedHash } from "./session.js";

/**
 * Write side of the security audit log (Issue #259).
 *
 * Rules:
 * - Only event type, IDs and time are stored. Never source contents, titles, e-mail
 *   addresses or free text: targets must match AUDIT_TARGET_PATTERN.
 * - The client IP is never stored in plain text, only as a salted SHA-256 hash that
 *   rotates daily. Without SESSION_SALT_SECRET no hash is computed ("-" is stored).
 * - Entries are deleted after AUDIT_RETENTION_DAYS by the hourly cron (cleanup.ts), in chunks.
 * - Only actions that exist in the code are listed. There is no route to create or revoke
 *   shares and none to create an export, so no audit action exists for them. Add an action
 *   together with the route that writes it.
 */
export type AuditAction =
  | "auth.login.guest"
  | "auth.login.magic_link"
  | "auth.login.passkey"
  | "source.delete"
  | "account.delete";

/** Retention of audit entries in days (Issue #259). */
export const AUDIT_RETENTION_DAYS = 90;
export const AUDIT_RETENTION_MS = AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Stored instead of an IP hash when no IP or no salt is available. */
export const AUDIT_NO_IP_HASH = "-";

/** Allowed target format: "<type>:<id>" with ID characters only, no free text. */
export const AUDIT_TARGET_PATTERN = /^[a-z_]{1,32}:[A-Za-z0-9_.:-]{1,128}$/;

export interface AuditEvent {
  readonly userId: string | null;
  readonly action: AuditAction;
  readonly target: string;
}

export interface AuditLoggerOptions {
  readonly repo: CoreRepository;
  readonly saltSecret: string | undefined;
  readonly now?: () => number;
}

export class AuditLogger {
  constructor(private readonly opts: AuditLoggerOptions) {}

  /** Builds the row to store, or null when the target is not allowed (nothing is stored then). */
  private async buildEntry(c: Context, event: AuditEvent): Promise<AuditLogRow | null> {
    if (!AUDIT_TARGET_PATTERN.test(event.target)) {
      console.error(JSON.stringify({ event: "audit_log_rejected", action: event.action }));
      return null;
    }
    const salt = this.opts.saltSecret?.trim() ? this.opts.saltSecret : undefined;
    const ipHash = salt ? await computeDailySaltedHash(resolveClientIp(c), `audit:${salt}`) : null;
    return {
      id: `aud_${crypto.randomUUID()}`,
      user_id: event.userId,
      action: event.action,
      target: event.target,
      ip_hash: ipHash ?? AUDIT_NO_IP_HASH,
      created_at: (this.opts.now ?? Date.now)()
    };
  }

  /**
   * Writes one entry. Failures are reported to the console and never break the
   * request that triggered them (login or deletion must not fail because of the log).
   */
  async record(c: Context, event: AuditEvent): Promise<boolean> {
    try {
      const entry = await this.buildEntry(c, event);
      if (!entry) {
        return false;
      }
      await this.opts.repo.logAudit(entry);
      return true;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "audit_log_failed",
          action: event.action,
          message: error instanceof Error ? error.message : String(error)
        })
      );
      return false;
    }
  }

  /**
   * Like record(), for entries that serve as proof (account deletion): a failed write is
   * logged as a structured error event (`audit_log_critical_failed`, to alert on) and the
   * entry is queued in `pending_r2_purge` under the prefix `audit-retry:`. The hourly cron
   * writes it later (replayPendingAuditEntries). If even the queue write fails the entry is
   * lost and `audit_log_lost` is logged. Never throws.
   */
  async recordCritical(c: Context, event: AuditEvent): Promise<"written" | "queued" | "lost"> {
    const entry = await this.buildEntry(c, event);
    if (!entry) {
      return "lost";
    }
    try {
      await this.opts.repo.logAudit(entry);
      return "written";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({ event: "audit_log_critical_failed", action: event.action, message })
      );
      try {
        await this.opts.repo.db.run(
          "INSERT OR IGNORE INTO pending_r2_purge (prefix, created_at) VALUES (?, ?)",
          [queuedAuditKey(entry), entry.created_at]
        );
        console.error(JSON.stringify({ event: "audit_log_retry_queued", action: event.action }));
        return "queued";
      } catch (queueError) {
        console.error(
          JSON.stringify({
            event: "audit_log_lost",
            action: event.action,
            message: queueError instanceof Error ? queueError.message : String(queueError)
          })
        );
        return "lost";
      }
    }
  }
}

/** Prefix of audit entries waiting in `pending_r2_purge` for a retry by the cron. */
export const AUDIT_RETRY_PREFIX = "audit-retry:";

const AUDIT_ACTIONS: ReadonlySet<string> = new Set<AuditAction>([
  "auth.login.guest",
  "auth.login.magic_link",
  "auth.login.passkey",
  "source.delete",
  "account.delete"
]);

/** Queue key: `audit-retry:<created_at>:<ip_hash>:<action>:<target>` (no personal data). */
function queuedAuditKey(entry: AuditLogRow): string {
  return `${AUDIT_RETRY_PREFIX}${entry.created_at}:${entry.ip_hash}:${entry.action}:${entry.target}`;
}

function parseQueuedAuditKey(key: string): AuditLogRow | null {
  const [createdAt, ipHash, action, ...rest] = key.slice(AUDIT_RETRY_PREFIX.length).split(":");
  const target = rest.join(":");
  const created = Number(createdAt);
  if (
    !Number.isSafeInteger(created) ||
    !/^([0-9a-f]{64}|-)$/.test(ipHash ?? "") ||
    !AUDIT_ACTIONS.has(action ?? "") ||
    !AUDIT_TARGET_PATTERN.test(target)
  ) {
    return null;
  }
  return {
    id: `aud_retry_${created}_${(ipHash as string).slice(0, 12)}_${action}_${target}`,
    user_id: null,
    action: action as AuditAction,
    target,
    ip_hash: ipHash as string,
    created_at: created
  };
}

/**
 * Writes audit entries that could not be stored at request time (recordCritical) with their
 * original time. Invalid queue entries are dropped with a log line. A failing write throws and
 * leaves the entry queued for the next run. Returns how many entries were written.
 */
export async function replayPendingAuditEntries(db: DatabaseAdapter, limit = 100): Promise<number> {
  const rows = await db.query<{ prefix: string }>(
    "SELECT prefix FROM pending_r2_purge WHERE prefix LIKE ? ORDER BY created_at ASC LIMIT ?",
    [`${AUDIT_RETRY_PREFIX}%`, limit]
  );
  let written = 0;
  for (const { prefix } of rows) {
    const entry = parseQueuedAuditKey(prefix);
    if (entry) {
      await db.run(
        `INSERT OR IGNORE INTO audit_log (id, user_id, action, target, ip_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [entry.id, entry.user_id, entry.action, entry.target, entry.ip_hash, entry.created_at]
      );
      written += 1;
    } else {
      console.error(JSON.stringify({ event: "audit_log_retry_entry_invalid" }));
    }
    await db.run("DELETE FROM pending_r2_purge WHERE prefix = ?", [prefix]);
  }
  return written;
}

/**
 * Rows deleted per statement. Cloudflare recommends chunks for large deletes (about 1,000 rows,
 * https://developers.cloudflare.com/d1/platform/limits/): a query runs at most 30 seconds, and a
 * Worker invocation may run 50 queries (Free) or 1,000 (Paid).
 */
export const AUDIT_PURGE_CHUNK = 1000;

/** Chunks per cron run, so the run stays well under the Free limit of 50 queries. A remaining
 * backlog is worked off in the next hourly runs. */
export const AUDIT_PURGE_MAX_CHUNKS = 5;

/** Deletes audit entries older than the retention period in chunks. Returns the number removed. */
export async function purgeExpiredAuditEntries(db: DatabaseAdapter, now: number): Promise<number> {
  let removed = 0;
  for (let chunk = 0; chunk < AUDIT_PURGE_MAX_CHUNKS; chunk += 1) {
    const res = await db.run(
      `DELETE FROM audit_log WHERE id IN (
         SELECT id FROM audit_log WHERE created_at < ? ORDER BY created_at ASC LIMIT ?
       )`,
      [now - AUDIT_RETENTION_MS, AUDIT_PURGE_CHUNK]
    );
    removed += res.changes;
    if (res.changes < AUDIT_PURGE_CHUNK) {
      break;
    }
  }
  return removed;
}
