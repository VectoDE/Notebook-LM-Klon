import type {
  AbuseReportRow,
  AuditLogRow,
  NotebookRow,
  PasskeyRow,
  QuotaRow,
  SessionRow,
  UserRow,
  WorkspaceRole,
  WorkspaceRow
} from "@notebook-lm/shared";

export interface DatabaseAdapter {
  exec(sql: string): Promise<void>;
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | null>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
}

export class CoreRepository {
  constructor(private readonly db: DatabaseAdapter) {}

  async createUser(user: UserRow): Promise<void> {
    await this.db.run(
      `INSERT INTO users (id, email, display_name, locale, is_guest, created_at, expires_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        user.email,
        user.display_name,
        user.locale,
        user.is_guest,
        user.created_at,
        user.expires_at,
        user.deleted_at
      ]
    );
  }

  async getUserById(id: string): Promise<UserRow | null> {
    return this.db.queryOne<UserRow>("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL", [
      id
    ]);
  }

  async deleteUser(id: string): Promise<void> {
    await this.db.run("DELETE FROM users WHERE id = ?", [id]);
  }

  async createPasskey(passkey: PasskeyRow): Promise<void> {
    await this.db.run(
      `INSERT INTO passkeys (id, user_id, public_key, sign_count, transports, aaguid, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        passkey.id,
        passkey.user_id,
        passkey.public_key,
        passkey.sign_count,
        passkey.transports,
        passkey.aaguid,
        passkey.created_at,
        passkey.last_used_at
      ]
    );
  }

  async getPasskeysByUserId(userId: string): Promise<PasskeyRow[]> {
    return this.db.query<PasskeyRow>("SELECT * FROM passkeys WHERE user_id = ?", [userId]);
  }

  async createSession(session: SessionRow): Promise<void> {
    await this.db.run(
      `INSERT INTO sessions (id_hash, user_id, created_at, expires_at, ip_hash, ua_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        session.id_hash,
        session.user_id,
        session.created_at,
        session.expires_at,
        session.ip_hash,
        session.ua_hash
      ]
    );
  }

  async getSession(idHash: string): Promise<SessionRow | null> {
    return this.db.queryOne<SessionRow>(
      "SELECT * FROM sessions WHERE id_hash = ? AND expires_at > ?",
      [idHash, Date.now()]
    );
  }

  async deleteSession(idHash: string): Promise<void> {
    await this.db.run("DELETE FROM sessions WHERE id_hash = ?", [idHash]);
  }

  async createWorkspace(
    workspace: WorkspaceRow,
    ownerRole: WorkspaceRole = "owner"
  ): Promise<void> {
    await this.db.run(
      "INSERT INTO workspaces (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)",
      [workspace.id, workspace.name, workspace.owner_id, workspace.created_at]
    );
    await this.db.run(
      "INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)",
      [workspace.id, workspace.owner_id, ownerRole, workspace.created_at]
    );
  }

  async getWorkspaceMemberRole(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
    const row = await this.db.queryOne<{ role: WorkspaceRole }>(
      "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, userId]
    );
    return row ? row.role : null;
  }

  async createNotebook(notebook: NotebookRow): Promise<void> {
    await this.db.run(
      `INSERT INTO notebooks (id, workspace_id, title, emoji, created_by, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        notebook.id,
        notebook.workspace_id,
        notebook.title,
        notebook.emoji,
        notebook.created_by,
        notebook.created_at,
        notebook.updated_at,
        notebook.expires_at
      ]
    );
  }

  async getNotebooksByWorkspace(workspaceId: string): Promise<NotebookRow[]> {
    return this.db.query<NotebookRow>(
      "SELECT * FROM notebooks WHERE workspace_id = ? ORDER BY updated_at DESC",
      [workspaceId]
    );
  }

  async getQuota(userId: string): Promise<QuotaRow | null> {
    return this.db.queryOne<QuotaRow>("SELECT * FROM quotas WHERE user_id = ?", [userId]);
  }

  async setQuota(quota: QuotaRow): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO quotas (user_id, notebooks_count, sources_count, storage_bytes, llm_calls_day, quota_day)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        quota.user_id,
        quota.notebooks_count,
        quota.sources_count,
        quota.storage_bytes,
        quota.llm_calls_day,
        quota.quota_day
      ]
    );
  }

  async logAudit(entry: AuditLogRow): Promise<void> {
    await this.db.run(
      `INSERT INTO audit_log (id, user_id, action, target, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [entry.id, entry.user_id, entry.action, entry.target, entry.ip_hash, entry.created_at]
    );
  }

  async createAbuseReport(report: AbuseReportRow): Promise<void> {
    await this.db.run(
      `INSERT INTO abuse_reports (id, target_id, reason, reporter_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        report.id,
        report.target_id,
        report.reason,
        report.reporter_id,
        report.status,
        report.created_at
      ]
    );
  }
}
