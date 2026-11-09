-- 0001_initial_core.sql
-- Initial core schema for users, passkeys, sessions, workspaces, notebooks, quotas, and audit_log

PRAGMA foreign_keys = ON;

-- 1. Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  display_name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'de',
  is_guest INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_users_expires_at ON users (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email IS NOT NULL;

-- 2. WebAuthn Passkeys credentials
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY, -- Base64URL-encoded credential ID
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  aaguid TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON passkeys (user_id);

-- 3. Magic Links (stored as SHA-256 hash only, 15 min expiry)
CREATE TABLE IF NOT EXISTS magic_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_magic_links_email ON magic_links (email);
CREATE INDEX IF NOT EXISTS idx_magic_links_expires_at ON magic_links (expires_at);

-- 4. User Sessions (opaque token SHA-256 hash)
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip_hash TEXT,
  ua_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

-- 5. RelationFlow-compatible Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id ON workspaces (owner_id);

-- 6. Workspace Members & RBAC Roles
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('owner', 'editor', 'viewer')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members (user_id);

-- 7. Notebooks
CREATE TABLE IF NOT EXISTS notebooks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_notebooks_workspace ON notebooks (workspace_id);
CREATE INDEX IF NOT EXISTS idx_notebooks_created_by ON notebooks (created_by);
CREATE INDEX IF NOT EXISTS idx_notebooks_expires_at ON notebooks (expires_at) WHERE expires_at IS NOT NULL;

-- 8. Notebook Sharing / Collaborators
CREATE TABLE IF NOT EXISTS notebook_shares (
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  invite_email_hash TEXT,
  role TEXT NOT NULL CHECK(role IN ('editor', 'viewer')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (notebook_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notebook_shares_user ON notebook_shares (user_id);

-- 9. User Quotas
CREATE TABLE IF NOT EXISTS quotas (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notebooks_count INTEGER NOT NULL DEFAULT 0,
  sources_count INTEGER NOT NULL DEFAULT 0,
  storage_bytes INTEGER NOT NULL DEFAULT 0,
  llm_calls_day INTEGER NOT NULL DEFAULT 0,
  quota_day TEXT NOT NULL
);

-- 10. Rate Limits (sliding window fallback)
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);

-- 11. Audit Log (GDPR Art. 30 compliance, IP only stored as SHA-256 hash)
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at);

-- 12. Abuse Reports (EU AI Act & content moderation)
CREATE TABLE IF NOT EXISTS abuse_reports (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'reviewed', 'dismissed', 'actioned')),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_abuse_reports_status ON abuse_reports (status);
