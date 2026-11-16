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

// -------------------------------------------------------------
// RAG & Studio Models (D1 Migration 0002)
// -------------------------------------------------------------

export type SourceType =
  | "pdf"
  | "txt"
  | "md"
  | "docx"
  | "url"
  | "text"
  | "youtube"
  | "audio"
  | "image"
  | "gdoc";

export type SourceStatus = "uploading" | "processing" | "ready" | "error";

export interface SourceRow {
  id: string;
  notebook_id: string;
  title: string;
  original_name: string;
  mime_type: string;
  source_type: SourceType;
  byte_size: number;
  r2_key: string | null;
  r2_etag: string | null;
  status: SourceStatus;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

export interface ChunkRow {
  id: string;
  source_id: string;
  notebook_id: string;
  chunk_index: number;
  page_number: number | null;
  start_offset: number | null;
  end_offset: number | null;
  text: string;
  token_count: number;
  created_at: number;
}

export interface ChunkVectorRow {
  chunk_id: string;
  notebook_id: string;
  model: string;
  dimensions: number;
  scale: number;
  min_val: number;
  max_val: number;
  vector: Uint8Array;
  created_at: number;
}

export interface ChatRow {
  id: string;
  notebook_id: string;
  user_id: string;
  title: string;
  model_used: string;
  created_at: number;
  updated_at: number;
}

export type MessageRole = "user" | "assistant" | "system";

export interface MessageCitation {
  chunk_id: string;
  source_id: string;
  page_number?: number | null;
  quote?: string;
}

export interface MessageRow {
  id: string;
  chat_id: string;
  role: MessageRole;
  content: string;
  citations_json: string | null;
  latency_ms: number | null;
  token_usage_json: string | null;
  ai_generated: number;
  created_at: number;
}

export type ArtifactType =
  | "summary"
  | "audio"
  | "video"
  | "mindmap"
  | "flashcards"
  | "quiz"
  | "faq"
  | "timeline"
  | "briefing";

export type ArtifactStatus = "generating" | "ready" | "failed";

export interface ArtifactRow {
  id: string;
  notebook_id: string;
  user_id: string;
  type: ArtifactType;
  title: string;
  content_json: string | null;
  r2_key: string | null;
  status: ArtifactStatus;
  created_at: number;
  updated_at: number;
}

export interface NoteRow {
  id: string;
  notebook_id: string;
  user_id: string;
  title: string;
  content: string;
  version: number;
  created_at: number;
  updated_at: number;
}

export type ProviderType =
  | "openai"
  | "anthropic"
  | "google"
  | "groq"
  | "deepseek"
  | "mistral"
  | "custom";

export interface ProviderKeyRow {
  id: string;
  user_id: string;
  provider: ProviderType;
  encrypted_key: string;
  key_version: number;
  last4: string;
  created_at: number;
  updated_at: number;
}
