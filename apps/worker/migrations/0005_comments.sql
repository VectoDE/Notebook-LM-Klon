-- 0005_comments.sql
-- Kommentare an Quellen und Notizen mit Erwähnungen (Issue #353).
-- Nummer 0005, weil 0004 von einem offenen PR (#388, usage_counters) belegt ist.
--
-- Ein Kommentar gehört zu genau einem Notebook und zeigt auf eine Quelle oder eine Notiz
-- desselben Notebooks (target_type/target_id). Da SQLite keinen Fremdschlüssel auf zwei
-- Tabellen kennt, entfernen Trigger die Kommentare, wenn Quelle oder Notiz gelöscht werden.
-- Erwähnungen stehen in comment_mentions und verschwinden mit dem Kommentar oder dem Konto.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('source', 'note')),
  target_id TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_target ON comments (notebook_id, target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_author ON comments (author_id);

CREATE TABLE IF NOT EXISTS comment_mentions (
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_comment_mentions_user ON comment_mentions (user_id);

CREATE TRIGGER IF NOT EXISTS sources_comments_ad AFTER DELETE ON sources BEGIN
  DELETE FROM comments WHERE target_type = 'source' AND target_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS notes_comments_ad AFTER DELETE ON notes BEGIN
  DELETE FROM comments WHERE target_type = 'note' AND target_id = old.id;
END;
