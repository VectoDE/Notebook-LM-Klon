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
 * - Entries are deleted after AUDIT_RETENTION_DAYS by the hourly cron (cleanup.ts).
 */
export type AuditAction =
  | "auth.login.guest"
  | "auth.login.magic_link"
  | "auth.login.passkey"
  | "share.create"
  | "share.revoke"
  | "export.create"
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

  /**
   * Writes one entry. Failures are reported to the console and never break the
   * request that triggered them (login or deletion must not fail because of the log).
   */
  async record(c: Context, event: AuditEvent): Promise<boolean> {
    if (!AUDIT_TARGET_PATTERN.test(event.target)) {
      console.error(JSON.stringify({ event: "audit_log_rejected", action: event.action }));
      return false;
    }
    try {
      const salt = this.opts.saltSecret?.trim() ? this.opts.saltSecret : undefined;
      const ipHash = salt
        ? await computeDailySaltedHash(resolveClientIp(c), `audit:${salt}`)
        : null;
      await this.opts.repo.logAudit({
        id: `aud_${crypto.randomUUID()}`,
        user_id: event.userId,
        action: event.action,
        target: event.target,
        ip_hash: ipHash ?? AUDIT_NO_IP_HASH,
        created_at: (this.opts.now ?? Date.now)()
      });
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
}

/** Deletes audit entries older than the retention period. Returns the number removed. */
export async function purgeExpiredAuditEntries(db: DatabaseAdapter, now: number): Promise<number> {
  const res = await db.run("DELETE FROM audit_log WHERE created_at < ?", [
    now - AUDIT_RETENTION_MS
  ]);
  return res.changes;
}
