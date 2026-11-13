import { purgeExpiredAuditEntries } from "./audit-log.js";
import type { DatabaseAdapter } from "./core-repository.js";

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
  deletedNotebooks: number;
  deletedR2Objects: number;
  /** Audit entries older than AUDIT_RETENTION_DAYS (Issue #259). */
  deletedAuditEntries: number;
  durationMs: number;
}

export interface RunCleanupOptions {
  db: DatabaseAdapter;
  mediaBucket?: MinimalR2Bucket | null;
  now?: number;
  batchSize?: number;
}

/**
 * Executes GDPR-compliant scheduled cleanup:
 * - Expired guest accounts (is_guest = 1 AND expires_at < now)
 * - Expired user sessions (expires_at < now)
 * - Expired magic links (expires_at < now)
 * - Expired demo notebooks (expires_at IS NOT NULL AND expires_at < now)
 * - Associated R2 objects (sources, artifacts) under guest / notebook prefixes
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
  let deletedNotebooks = 0;
  let deletedR2Objects = 0;

  // 1. Clean up expired guest accounts
  const expiredGuests = await db.query<{ id: string }>(
    `SELECT id FROM users
     WHERE is_guest = 1 AND expires_at IS NOT NULL AND expires_at < ?
     LIMIT ?`,
    [now, batchSize]
  );

  const purged = await purgeUsers(
    db,
    mediaBucket,
    expiredGuests.map((g) => g.id)
  );
  deletedGuests = purged.deletedUsers;
  deletedNotebooks += purged.deletedNotebooks;
  deletedR2Objects += purged.deletedR2Objects;

  // 2. Identify and purge expired demo notebooks that are not already deleted
  const expiredNotebooks = await db.query<{ id: string }>(
    `SELECT id FROM notebooks
     WHERE expires_at IS NOT NULL AND expires_at < ?
     LIMIT ?`,
    [now, batchSize]
  );

  if (expiredNotebooks.length > 0) {
    const nbIds = expiredNotebooks.map((n) => n.id);
    if (mediaBucket) {
      for (const nbId of nbIds) {
        deletedR2Objects += await purgeR2Prefix(mediaBucket, `notebooks/${nbId}/`);
      }
    }
    const nbPlaceholders = nbIds.map(() => "?").join(",");
    const nbDelRes = await db.run(`DELETE FROM notebooks WHERE id IN (${nbPlaceholders})`, nbIds);
    deletedNotebooks += nbDelRes.changes;
  }

  // 3. Purge expired sessions
  const sessionDelRes = await db.run("DELETE FROM sessions WHERE expires_at < ?", [now]);
  deletedSessions = sessionDelRes.changes;

  // 4. Purge expired magic links
  const magicLinkDelRes = await db.run("DELETE FROM magic_links WHERE expires_at < ?", [now]);
  deletedMagicLinks = magicLinkDelRes.changes;

  // 5. Enforce audit log retention
  const deletedAuditEntries = await purgeExpiredAuditEntries(db, now);

  const durationMs = Date.now() - startTime;

  return {
    deletedGuests,
    deletedSessions,
    deletedMagicLinks,
    deletedNotebooks,
    deletedR2Objects,
    deletedAuditEntries,
    durationMs
  };
}

export interface PurgeUsersResult {
  deletedUsers: number;
  deletedNotebooks: number;
  deletedR2Objects: number;
}

/**
 * Deletes users with everything they own, immediately and irreversibly (Art. 17 DSGVO):
 * R2 objects under users/{id}/ and notebooks/{id}/, notebooks they own or created,
 * their workspaces and finally the user rows. ON DELETE CASCADE removes passkeys,
 * sessions, quotas, memberships, shares, chats, notes, artifacts, provider keys,
 * sources, chunks and vectors. audit_log keeps its rows with user_id set to NULL.
 * Used by the cron cleanup (expired guests) and by DELETE /api/v1/me.
 */
export async function purgeUsers(
  db: DatabaseAdapter,
  mediaBucket: MinimalR2Bucket | null | undefined,
  userIds: readonly string[]
): Promise<PurgeUsersResult> {
  if (userIds.length === 0) {
    return { deletedUsers: 0, deletedNotebooks: 0, deletedR2Objects: 0 };
  }
  const ids = [...userIds];
  const placeholders = ids.map(() => "?").join(",");
  let deletedNotebooks = 0;
  let deletedR2Objects = 0;

  // Workspaces owned by these users
  const workspaces = await db.query<{ id: string }>(
    `SELECT id FROM workspaces WHERE owner_id IN (${placeholders})`,
    ids
  );
  const workspaceIds = workspaces.map((w) => w.id);

  // Notebooks in these workspaces or created by these users
  const wsPlaceholders = workspaceIds.length > 0 ? workspaceIds.map(() => "?").join(",") : "''";
  const notebooks = await db.query<{ id: string }>(
    `SELECT id FROM notebooks WHERE workspace_id IN (${wsPlaceholders}) OR created_by IN (${placeholders})`,
    [...workspaceIds, ...ids]
  );
  const notebookIds = notebooks.map((n) => n.id);

  // R2 objects first, so no orphaned files remain if a later step fails
  if (mediaBucket) {
    for (const userId of ids) {
      deletedR2Objects += await purgeR2Prefix(mediaBucket, `users/${userId}/`);
    }
    for (const nbId of notebookIds) {
      deletedR2Objects += await purgeR2Prefix(mediaBucket, `notebooks/${nbId}/`);
    }
  }

  // Notebooks (ON DELETE CASCADE handles shares, sources, chunks, vectors, chats, notes)
  if (notebookIds.length > 0) {
    const nbPlaceholders = notebookIds.map(() => "?").join(",");
    const nbDelRes = await db.run(
      `DELETE FROM notebooks WHERE id IN (${nbPlaceholders})`,
      notebookIds
    );
    deletedNotebooks += nbDelRes.changes;
  }

  // Workspaces (owner_id is ON DELETE RESTRICT, so they go before the owner)
  if (workspaceIds.length > 0) {
    const ownedPlaceholders = workspaceIds.map(() => "?").join(",");
    await db.run(`DELETE FROM workspaces WHERE id IN (${ownedPlaceholders})`, workspaceIds);
  }

  // Users last (ON DELETE CASCADE removes passkeys, sessions, quotas, workspace_members)
  const userDelRes = await db.run(`DELETE FROM users WHERE id IN (${placeholders})`, ids);

  return { deletedUsers: userDelRes.changes, deletedNotebooks, deletedR2Objects };
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
