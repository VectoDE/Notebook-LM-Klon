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
  deletedChallenges: number;
  deletedNotebooks: number;
  deletedR2Objects: number;
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
 * - Expired WebAuthn challenges (expires_at <= now)
 * - Expired demo notebooks (expires_at IS NOT NULL AND expires_at < now)
 * - Associated R2 objects (sources, artifacts) under guest / notebook prefixes
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

  if (expiredGuests.length > 0) {
    const guestIds = expiredGuests.map((g) => g.id);
    const placeholders = guestIds.map(() => "?").join(",");

    // Find all workspaces owned by these guests
    const workspaces = await db.query<{ id: string }>(
      `SELECT id FROM workspaces WHERE owner_id IN (${placeholders})`,
      guestIds
    );
    const workspaceIds = workspaces.map((w) => w.id);

    // Find all notebooks in these workspaces or created by these guests
    const wsPlaceholders = workspaceIds.length > 0 ? workspaceIds.map(() => "?").join(",") : "''";
    const notebooks = await db.query<{ id: string }>(
      `SELECT id FROM notebooks WHERE workspace_id IN (${wsPlaceholders}) OR created_by IN (${placeholders})`,
      [...workspaceIds, ...guestIds]
    );
    const notebookIds = notebooks.map((n) => n.id);

    // Delete associated R2 files for each guest and notebook
    if (mediaBucket) {
      for (const guestId of guestIds) {
        deletedR2Objects += await purgeR2Prefix(mediaBucket, `users/${guestId}/`);
      }
      for (const nbId of notebookIds) {
        deletedR2Objects += await purgeR2Prefix(mediaBucket, `notebooks/${nbId}/`);
      }
    }

    // Delete notebooks (ON DELETE CASCADE handles notebook_shares)
    if (notebookIds.length > 0) {
      const nbPlaceholders = notebookIds.map(() => "?").join(",");
      const nbDelRes = await db.run(
        `DELETE FROM notebooks WHERE id IN (${nbPlaceholders})`,
        notebookIds
      );
      deletedNotebooks += nbDelRes.changes;
    }

    // Delete workspaces (ON DELETE RESTRICT on workspaces requires deleting them before owner user)
    if (workspaceIds.length > 0) {
      const wsPlaceholders = workspaceIds.map(() => "?").join(",");
      await db.run(`DELETE FROM workspaces WHERE id IN (${wsPlaceholders})`, workspaceIds);
    }

    // Finally delete users (ON DELETE CASCADE removes passkeys, sessions, quotas, workspace_members)
    const userDelRes = await db.run(`DELETE FROM users WHERE id IN (${placeholders})`, guestIds);
    deletedGuests = userDelRes.changes;
  }

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

  // 5. Purge expired WebAuthn challenges (single-use, 5-minute lifetime)
  const challengeDelRes = await db.run("DELETE FROM webauthn_challenges WHERE expires_at <= ?", [
    now
  ]);
  const deletedChallenges = challengeDelRes.changes;

  const durationMs = Date.now() - startTime;

  return {
    deletedGuests,
    deletedSessions,
    deletedMagicLinks,
    deletedChallenges,
    deletedNotebooks,
    deletedR2Objects,
    durationMs
  };
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
