-- 0002_rag_and_studio.sql
-- Schema for sources, chunks, int8 vectors, FTS5 fulltext search, chats, messages, artifacts, notes & provider keys

PRAGMA foreign_keys = ON;

-- 1. Sources table (10 source types, uploading/processing/ready/error status)
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('pdf', 'txt', 'md', 'docx', 'url', 'text', 'youtube', 'audio', 'image', 'gdoc')),
  byte_size INTEGER NOT NULL DEFAULT 0,
  r2_key TEXT,
  r2_etag TEXT,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading', 'processing', 'ready', 'error')),
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sources_notebook_id ON sources (notebook_id);
CREATE INDEX IF NOT EXISTS idx_sources_status ON sources (status);

-- 2. Chunks table (text segments with offset/order metadata)
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  page_number INTEGER,
  start_offset INTEGER,
  end_offset INTEGER,
  text TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_source_ord ON chunks (source_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_chunks_notebook_source ON chunks (notebook_id, source_id, chunk_index);

-- 3. Chunk Vectors table (int8 quantized vectors with scale & min/max bounds)
CREATE TABLE IF NOT EXISTS chunk_vectors (
  chunk_id TEXT PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  scale REAL NOT NULL DEFAULT 1.0,
  min_val REAL NOT NULL DEFAULT -1.0,
  max_val REAL NOT NULL DEFAULT 1.0,
  vector BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunk_vectors_notebook ON chunk_vectors (notebook_id);

-- 4. Chunks FTS5 Virtual Table & Sync Triggers
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  content='chunks',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;

-- 5. Chats table
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  model_used TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chats_notebook ON chats (notebook_id);
CREATE INDEX IF NOT EXISTS idx_chats_user ON chats (user_id);

-- 6. Messages table (citations JSON, token usage JSON, ai_generated flag)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  citations_json TEXT,
  latency_ms INTEGER,
  token_usage_json TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages (chat_id, created_at);

-- 7. Artifacts table (Studio outputs)
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('summary', 'audio', 'video', 'mindmap', 'flashcards', 'quiz', 'faq', 'timeline', 'briefing')),
  title TEXT NOT NULL,
  content_json TEXT,
  r2_key TEXT,
  status TEXT NOT NULL DEFAULT 'generating' CHECK(status IN ('generating', 'ready', 'failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_notebook ON artifacts (notebook_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_user ON artifacts (user_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts (type);

-- 8. Notes table (Collaborative user notes)
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes (notebook_id);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes (user_id);

-- 9. Provider Keys table (Encrypted BYOK credentials with IV & last4)
CREATE TABLE IF NOT EXISTS provider_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('openai', 'anthropic', 'google', 'groq', 'deepseek', 'mistral', 'custom')),
  encrypted_key TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  last4 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_provider_keys_user ON provider_keys (user_id);
