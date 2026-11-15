-- 0008_ai_embedding_usage.sql
-- Tageszähler für serverseitige Embeddings über Workers AI (kostenlose Stufe).
-- Nummer 0008, weil 0004 und 0006 von offenen Zweigen sowie 0007 (Upload-Grenzen) belegt sind.
--
-- Eine Zeile je UTC-Tag und Bereich: scope = 'global' für das ganze Konto, 'guest:<user_id>'
-- für das kleinere Gast-Limit. Gezählt werden Eingabe-Tokens, keine Inhalte. Zeilen früherer
-- Tage löscht der Worker beim nächsten Schreiben, die Gast-ID bleibt also höchstens bis zum
-- Folgetag gespeichert.

CREATE TABLE IF NOT EXISTS ai_embedding_usage (
  day TEXT NOT NULL,
  scope TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0 CHECK(tokens >= 0),
  PRIMARY KEY (day, scope)
);
