export const CHUNKS_FTS5_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS chunks_probe (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL,
  text TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_probe_fts USING fts5(
  text,
  content='chunks_probe',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS chunks_probe_ai AFTER INSERT ON chunks_probe BEGIN
  INSERT INTO chunks_probe_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_probe_ad AFTER DELETE ON chunks_probe BEGIN
  INSERT INTO chunks_probe_fts(chunks_probe_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_probe_au AFTER UPDATE ON chunks_probe BEGIN
  INSERT INTO chunks_probe_fts(chunks_probe_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO chunks_probe_fts(rowid, text) VALUES (new.rowid, new.text);
END;
`;

export const CHUNKS_FTS5_BM25_SEARCH_SQL = `
SELECT
  c.id AS id,
  c.text AS text,
  bm25(chunks_probe_fts) AS rank
FROM chunks_probe_fts
JOIN chunks_probe c ON c.rowid = chunks_probe_fts.rowid
WHERE chunks_probe_fts MATCH ?1 AND c.notebook_id = ?2
ORDER BY rank ASC
LIMIT ?3;
`;

/**
 * Sanitizes an arbitrary user search string into a safe FTS5 token query
 * by quoting each alphanumeric/umlaut word token and joining via implicit AND.
 */
export function buildSafeFts5MatchQuery(rawQuery: string): string {
  const tokens = rawQuery
    .trim()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return "";
  }

  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" ");
}
