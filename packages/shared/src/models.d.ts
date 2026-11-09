export interface UserRow {
  id: string;
  email: string | null;
  display_name: string;
  locale: string;
  is_guest: number;
  created_at: number;
  expires_at: number | null;
  deleted_at: number | null;
}

export interface PasskeyRow {
  id: string;
  user_id: string;
  public_key: Uint8Array;
  sign_count: number;
  transports: string | null;
  aaguid: string | null;
  created_at: number;
  last_used_at: number | null;
}

export interface MagicLinkRow {
  token_hash: string;
  email: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

export interface SessionRow {
  id_hash: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  ip_hash: string | null;
  ua_hash: string | null;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
}

export type WorkspaceRole = "owner" | "editor" | "viewer";

export interface WorkspaceMemberRow {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: number;
}

export interface NotebookRow {
  id: string;
  workspace_id: string;
  title: string;
  emoji: string;
  created_by: string;
  created_at: number;
  updated_at: number;
  expires_at: number | null;
}

export interface NotebookShareRow {
  notebook_id: string;
  user_id: string | null;
  invite_email_hash: string | null;
  role: "editor" | "viewer";
  created_at: number;
}

export interface QuotaRow {
  user_id: string;
  notebooks_count: number;
  sources_count: number;
  storage_bytes: number;
  llm_calls_day: number;
  quota_day: string;
}

export interface RateLimitRow {
  bucket: string;
  count: number;
  window_start: number;
}

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: string;
  target: string;
  ip_hash: string;
  created_at: number;
}

export interface AbuseReportRow {
  id: string;
  target_id: string;
  reason: string;
  reporter_id: string | null;
  status: "pending" | "reviewed" | "dismissed" | "actioned";
  created_at: number;
}
