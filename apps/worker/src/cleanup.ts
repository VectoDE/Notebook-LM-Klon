import { purgeExpiredAuditEntries } from "./audit-log.js";
import type { BatchStatement, DatabaseAdapter } from "./core-repository.js";
import { STALE_UPLOAD_MS, UPLOAD_DAILY_RETENTION_DAYS } from "./r2-budget.js";

export type { BatchStatement } from "./core-repository.js";

export interface MinimalR2Bucket {
  list: (options?: { prefix?: string; cursor?: string; limit?: number }) => Promise<{
    objects: Array<{ key: string }>;
    truncated: boolean;
    cursor?: string;
  }>;
  delete: (keys: string[] | string) => Promise<void>;
}

export interface CleanupMetrics {
  deletedGuests: number;
  deletedSessions: number;
  deletedMagicLinks: number;
  deletedChallenges: number;
  deletedNotebooks: number;
  deletedR2Objects: number;
  /** Abgebrochene Uploads (Status uploading, älter als STALE_UPLOAD_MS), samt R2-Objekt. */
  deletedStaleUploads: number;
  /** Audit entries older than AUDIT_RETENTION_DAYS (Issue #259). */
  deletedAuditEntries: number;
  /** Cron-Schritte, die mit einem Fehler endeten; die übrigen Schritte liefen trotzdem. */
  failedSteps: number;
  durationMs: number;
}

export interface RunCleanupOptions {
  db: DatabaseAdapter;
  mediaBucket?: MinimalR2Bucket | null;
  now?: number;
  batchSize?: number;
}

/** Cloudflare D1 erlaubt höchstens 100 gebundene Parameter je Anfrage; wir bleiben bei 50. */
export const D1_MAX_BOUND_IDS = 50;

/** Konto, auf das Autorfelder gelöschter Nutzer umgehängt werden (Migration 0009). */
export const DELETED_USER_ID = "user_deleted";

function chunked<T>(items: readonly T[], size: number = D1_MAX_BOUND_IDS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function marks(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

/** Führt Anweisungen atomar aus (D1.batch); ohne batch-Unterstützung nacheinander. */
export async function runBatch(db: DatabaseAdapter, statements: BatchStatement[]): Promise<void> {
  if (statements.length === 0) {
    return;
  }
  if (db.batch) {
    await db.batch(statements);
    return;
  }
  for (const statement of statements) {
    await db.run(statement.sql, statement.params);
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Executes GDPR-compliant scheduled cleanup. Every step runs in its own try/catch, so a
 * failing step (for example purgeUsers) never stops the others (audit retention, sessions, ...).
 * - Expired guest accounts (is_guest = 1 AND expires_at < now)
 * - Pending R2 prefixes left over by an interrupted account deletion
 * - Expired user sessions (expires_at < now)
 * - Expired magic links (expires_at < now)
 * - Expired WebAuthn challenges (expires_at <= now)
 * - Expired demo notebooks (expires_at IS NOT NULL AND expires_at < now)
 * - Associated R2 objects (sources, artifacts) under guest / notebook prefixes
 * - Abandoned uploads (status 'uploading' older than STALE_UPLOAD_MS) incl. their R2 object
 * - Daily upload counters older than UPLOAD_DAILY_RETENTION_DAYS
 * - Audit log entries older than the retention period (90 days)
 */
export async function runScheduledCleanup(opts: RunCleanupOptions): Promise<CleanupMetrics> {
  const startTime = Date.now();
  const now = opts.now ?? startTime;
  const batchSize = Math.max(1, Math.min(opts.batchSize ?? 100, 500));
  const { db, mediaBucket } = opts;

  let deletedGuests = 0;
  let deletedSessions = 0;
  let deletedMagicLinks = 0;
  let deletedChallenges = 0;
  let deletedNotebooks = 0;
  let deletedR2Objects = 0;
  let deletedStaleUploads = 0;
  let deletedAuditEntries = 0;
  let failedSteps = 0;

  const step = async (name: string, work: () => Promise<void>): Promise<void> => {
    try {
      await work();
    } catch (err) {
      failedSteps += 1;
      console.error(
        JSON.stringify({ event: "scheduled_cleanup_step_failed", step: name, error: String(err) })
      );
    }
  };

  // 1. Clean up expired guest accounts
  await step("expired_guests", async () => {
    const expiredGuests = await db.query<{ id: string }>(
      `SELECT id FROM users
       WHERE is_guest = 1 AND expires_at IS NOT NULL AND expires_at < ?
       LIMIT ?`,
      [now, batchSize]
    );
    const purged = await purgeUsers(
      db,
      mediaBucket,
      expiredGuests.map((g) => g.id),
      now
    );
    deletedGuests += purged.deletedUsers;
    deletedNotebooks += purged.deletedNotebooks;
    deletedR2Objects += purged.deletedR2Objects;
  });

  // 2. Finish R2 deletions that failed after an account deletion
  await step("pending_r2", async () => {
    if (!mediaBucket) {
      return;
    }
    const drained = await drainPendingR2(db, mediaBucket, undefined, batchSize);
    deletedR2Objects += drained.deletedObjects;
    if (drained.failed > 0) {
      throw new Error(`${drained.failed} R2-Präfixe konnten nicht geleert werden`);
    }
  });

  // 3. Expired demo notebooks: R2 first, then rows (a failure keeps the row, the next run retries)
  await step("expired_notebooks", async () => {
    const expiredNotebooks = await db.query<{ id: string }>(
      `SELECT id FROM notebooks
       WHERE expires_at IS NOT NULL AND expires_at < ?
       LIMIT ?`,
      [now, batchSize]
    );
    for (const block of chunked(expiredNotebooks.map((n) => n.id))) {
      if (mediaBucket) {
        for (const nbId of block) {
          deletedR2Objects += await purgeR2Prefix(mediaBucket, `notebooks/${nbId}/`);
        }
      }
      const res = await db.run(`DELETE FROM notebooks WHERE id IN (${marks(block.length)})`, block);
      deletedNotebooks += res.changes;
    }
  });

  // 4. Purge expired sessions
  await step("sessions", async () => {
    deletedSessions = (await db.run("DELETE FROM sessions WHERE expires_at < ?", [now])).changes;
  });

  // 5. Purge expired magic links
  await step("magic_links", async () => {
    deletedMagicLinks = (await db.run("DELETE FROM magic_links WHERE expires_at < ?", [now]))
      .changes;
  });

  // 6. Purge expired WebAuthn challenges (single-use, 5-minute lifetime)
  await step("webauthn_challenges", async () => {
    deletedChallenges = (
      await db.run("DELETE FROM webauthn_challenges WHERE expires_at <= ?", [now])
    ).changes;
  });

  // 7. Abandoned uploads: delete the R2 object first (DeleteObject is free), then the row.
  //    The r2_usage trigger releases the reserved bytes.
  await step("stale_uploads", async () => {
    const staleUploads = await db.query<{ id: string; r2_key: string | null }>(
      `SELECT id, r2_key FROM sources
       WHERE status = 'uploading' AND created_at < ?
       LIMIT ?`,
      [now - STALE_UPLOAD_MS, batchSize]
    );
    for (const block of chunked(staleUploads)) {
      const keys = block.map((s) => s.r2_key).filter((k): k is string => k !== null);
      if (mediaBucket && keys.length > 0) {
        await mediaBucket.delete(keys);
        deletedR2Objects += keys.length;
      }
      const ids = block.map((s) => s.id);
      const res = await db.run(`DELETE FROM sources WHERE id IN (${marks(ids.length)})`, ids);
      deletedStaleUploads += res.changes;
    }
  });

  // 8. Daily upload counters are only needed for the current day; keep a week for diagnosis.
  await step("upload_daily", async () => {
    const retentionDay = new Date(now - UPLOAD_DAILY_RETENTION_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await db.run("DELETE FROM upload_daily WHERE day < ?", [retentionDay]);
  });

  // 9. Audit log retention (90 days). Own step: independent of purgeUsers and all other steps.
  await step("audit_retention", async () => {
    deletedAuditEntries = await purgeExpiredAuditEntries(db, now);
  });

  const durationMs = Date.now() - startTime;

  return {
    deletedGuests,
    deletedSessions,
    deletedMagicLinks,
    deletedChallenges,
    deletedNotebooks,
    deletedR2Objects,
    deletedStaleUploads,
    deletedAuditEntries,
    failedSteps,
    durationMs
  };
}

export interface PurgeUsersResult {
  deletedUsers: number;
  deletedNotebooks: number;
  deletedR2Objects: number;
  /** Eigene Arbeitsbereiche, die an ein anderes Mitglied übergeben wurden (F365). */
  transferredWorkspaces: number;
  /** R2-Präfixe, die noch nicht geleert werden konnten; der Cron holt sie nach. */
  pendingR2Prefixes: number;
}

/**
 * Deletes accounts. D1 first, atomically (one D1.batch per block of at most 50 accounts),
 * R2 afterwards, so a failure never leaves a half-deleted account:
 * - Own workspaces with other members go to the longest-standing admin member (role owner),
 *   otherwise to the oldest member (F365). Only workspaces without other members are deleted
 *   together with their notebooks.
 * - Notebooks the person created elsewhere stay; created_by moves to the workspace owner (F361).
 * - Author fields (comments, notes, chats, artifacts) move to the placeholder account
 *   DELETED_USER_ID instead of being deleted with the account.
 * - Leftovers in magic_links, rate_limits, ai_embedding_usage and audit_log.target are removed.
 * - R2 prefixes are queued in pending_r2_purge inside the same batch and removed only after
 *   a successful delete; on an R2 error the entry stays for the cron.
 * Every ID list is bound in blocks of at most 50 (D1 allows 100 bound parameters per query,
 * https://developers.cloudflare.com/d1/platform/limits/).
 * Used by the cron (expired guests) and by DELETE /api/v1/me.
 */
export async function purgeUsers(
  db: DatabaseAdapter,
  mediaBucket: MinimalR2Bucket | null | undefined,
  userIds: readonly string[],
  now: number = Date.now()
): Promise<PurgeUsersResult> {
  const total: PurgeUsersResult = {
    deletedUsers: 0,
    deletedNotebooks: 0,
    deletedR2Objects: 0,
    transferredWorkspaces: 0,
    pendingR2Prefixes: 0
  };
  const unique = [...new Set(userIds)].filter((id) => id !== DELETED_USER_ID);
  for (const block of chunked(unique)) {
    const part = await purgeUserBlock(db, mediaBucket, block, now);
    total.deletedUsers += part.deletedUsers;
    total.deletedNotebooks += part.deletedNotebooks;
    total.deletedR2Objects += part.deletedR2Objects;
    total.transferredWorkspaces += part.transferredWorkspaces;
    total.pendingR2Prefixes += part.pendingR2Prefixes;
  }
  return total;
}

async function purgeUserBlock(
  db: DatabaseAdapter,
  mediaBucket: MinimalR2Bucket | null | undefined,
  ids: string[],
  now: number
): Promise<PurgeUsersResult> {
  const ph = marks(ids.length);
  const statements: BatchStatement[] = [];

  const existing = await db.query<{ id: string }>(`SELECT id FROM users WHERE id IN (${ph})`, ids);

  // Own workspaces: pick the successor (admin first, then oldest member)
  const owned = await db.query<{ id: string }>(
    `SELECT id FROM workspaces WHERE owner_id IN (${ph})`,
    ids
  );
  const dropWorkspaceIds: string[] = [];
  let transferredWorkspaces = 0;
  for (const ws of owned) {
    const successor = await db.queryOne<{ user_id: string }>(
      `SELECT m.user_id AS user_id
       FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? AND m.user_id NOT IN (${ph})
         AND m.user_id <> ? AND u.deleted_at IS NULL
       ORDER BY (m.role = 'owner') DESC, m.created_at ASC, m.user_id ASC
       LIMIT 1`,
      [ws.id, ...ids, DELETED_USER_ID]
    );
    if (successor) {
      transferredWorkspaces += 1;
      statements.push({
        sql: "UPDATE workspaces SET owner_id = ? WHERE id = ?",
        params: [successor.user_id, ws.id]
      });
      statements.push({
        sql: "UPDATE workspace_members SET role = 'owner' WHERE workspace_id = ? AND user_id = ?",
        params: [ws.id, successor.user_id]
      });
    } else {
      dropWorkspaceIds.push(ws.id);
    }
  }

  // Notebooks that disappear with workspaces nobody can take over (needed for R2 prefixes)
  const dropNotebookIds: string[] = [];
  for (const block of chunked(dropWorkspaceIds)) {
    const rows = await db.query<{ id: string }>(
      `SELECT id FROM notebooks WHERE workspace_id IN (${marks(block.length)})`,
      block
    );
    for (const row of rows) {
      dropNotebookIds.push(row.id);
    }
  }

  // Queue R2 prefixes in the same batch as the deletion
  const prefixes = [
    ...ids.map((id) => `users/${id}/`),
    ...dropNotebookIds.map((id) => `notebooks/${id}/`)
  ];
  if (mediaBucket) {
    for (const block of chunked(prefixes, 25)) {
      statements.push({
        sql: `INSERT OR IGNORE INTO pending_r2_purge (prefix, created_at) VALUES ${block
          .map(() => "(?,?)")
          .join(",")}`,
        params: block.flatMap((prefix) => [prefix, now])
      });
    }
  }

  for (const block of chunked(dropWorkspaceIds)) {
    statements.push({
      sql: `DELETE FROM workspaces WHERE id IN (${marks(block.length)})`,
      params: block
    });
  }

  // Remaining notebooks of the person live in foreign or transferred workspaces
  statements.push({
    sql: `UPDATE notebooks
          SET created_by = (SELECT w.owner_id FROM workspaces w WHERE w.id = notebooks.workspace_id)
          WHERE created_by IN (${ph})`,
    params: ids
  });

  // Placeholder account, then author fields
  statements.push({
    sql: `INSERT OR IGNORE INTO users (id, email, display_name, locale, is_guest, created_at, expires_at, deleted_at)
          VALUES (?, NULL, 'Gelöschtes Konto', 'de', 0, 0, NULL, ?)`,
    params: [DELETED_USER_ID, now]
  });
  for (const [table, column] of [
    ["comments", "author_id"],
    ["notes", "user_id"],
    ["chats", "user_id"],
    ["artifacts", "user_id"]
  ] as const) {
    statements.push({
      sql: `UPDATE ${table} SET ${column} = ? WHERE ${column} IN (${ph})`,
      params: [DELETED_USER_ID, ...ids]
    });
  }

  // Remove personal references in the audit log and short-lived tables
  statements.push({
    sql: `UPDATE audit_log SET target = 'user:deleted' WHERE user_id IN (${ph}) AND target LIKE 'user:%'`,
    params: ids
  });
  statements.push({
    sql: `DELETE FROM magic_links WHERE email IN (SELECT email FROM users WHERE id IN (${ph}) AND email IS NOT NULL)`,
    params: ids
  });
  statements.push({
    sql: `DELETE FROM rate_limits WHERE ${ids.map(() => "bucket LIKE ? ESCAPE '\\'").join(" OR ")}`,
    params: ids.map((id) => `rl:%:usr:${escapeLike(id)}`)
  });
  statements.push({
    sql: `DELETE FROM ai_embedding_usage WHERE scope IN (${ph})`,
    params: ids.map((id) => `guest:${id}`)
  });

  // Accounts last (CASCADE: passkeys, sessions, quotas, memberships, shares, provider keys)
  statements.push({ sql: `DELETE FROM users WHERE id IN (${ph})`, params: ids });

  await runBatch(db, statements);

  let deletedR2Objects = 0;
  let pendingR2Prefixes = 0;
  if (mediaBucket) {
    const drained = await drainPendingR2(db, mediaBucket, prefixes);
    deletedR2Objects = drained.deletedObjects;
    pendingR2Prefixes = drained.failed;
  }

  return {
    deletedUsers: existing.length,
    deletedNotebooks: dropNotebookIds.length,
    deletedR2Objects,
    transferredWorkspaces,
    pendingR2Prefixes
  };
}

/**
 * Empties queued R2 prefixes and removes the queue entry only after success. Without `only`
 * the oldest queued prefixes (at most `limit`) are processed. A failing prefix does not abort
 * the others; its entry stays for the next run.
 */
export async function drainPendingR2(
  db: DatabaseAdapter,
  bucket: MinimalR2Bucket,
  only?: readonly string[],
  limit = 100
): Promise<{ deletedObjects: number; failed: number }> {
  const prefixes =
    only !== undefined
      ? [...only]
      : (
          await db.query<{ prefix: string }>(
            "SELECT prefix FROM pending_r2_purge ORDER BY created_at ASC LIMIT ?",
            [limit]
          )
        ).map((row) => row.prefix);
  let deletedObjects = 0;
  let failed = 0;
  for (const prefix of prefixes) {
    try {
      deletedObjects += await purgeR2Prefix(bucket, prefix);
      await db.run("DELETE FROM pending_r2_purge WHERE prefix = ?", [prefix]);
    } catch (err) {
      failed += 1;
      console.error(JSON.stringify({ event: "r2_purge_failed", prefix, error: String(err) }));
    }
  }
  return { deletedObjects, failed };
}

/**
 * Helper to purge all R2 objects matching a specific key prefix.
 */
async function purgeR2Prefix(bucket: MinimalR2Bucket, prefix: string): Promise<number> {
  let count = 0;
  let truncated = true;
  let cursor: string | undefined = undefined;

  while (truncated) {
    const listOpts: { prefix?: string; cursor?: string; limit?: number } = { prefix, limit: 200 };
    if (cursor !== undefined) {
      listOpts.cursor = cursor;
    }
    const listRes = await bucket.list(listOpts);
    const keys = listRes.objects.map((obj) => obj.key);
    if (keys.length > 0) {
      await bucket.delete(keys);
      count += keys.length;
    }
    truncated = listRes.truncated;
    cursor = listRes.cursor;
  }

  return count;
}
