-- 0007_upload_grenzen.sql
-- Grenzen für eigene Uploads, damit R2 in der Cloudflare-Freimenge bleibt (Entscheidung F247).
-- Werte und Rechnung: apps/worker/src/r2-budget.ts und docs/platform-limits.md.

-- 1. Belegter R2-Speicher über alle Quellen mit R2-Objekt (eine Zeile).
--    Trigger halten den Wert synchron, auch bei Löschungen per ON DELETE CASCADE
--    (Notebook, Gast-Konto). So muss der Worker nie über alle Quellen summieren.
CREATE TABLE IF NOT EXISTS r2_usage (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  stored_bytes INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO r2_usage (id, stored_bytes)
SELECT 1, COALESCE(SUM(byte_size), 0) FROM sources WHERE r2_key IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_sources_r2_usage_insert
AFTER INSERT ON sources
WHEN NEW.r2_key IS NOT NULL
BEGIN
  UPDATE r2_usage SET stored_bytes = stored_bytes + NEW.byte_size WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_sources_r2_usage_delete
AFTER DELETE ON sources
WHEN OLD.r2_key IS NOT NULL
BEGIN
  UPDATE r2_usage SET stored_bytes = MAX(0, stored_bytes - OLD.byte_size) WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_sources_r2_usage_update
AFTER UPDATE OF byte_size, r2_key ON sources
BEGIN
  UPDATE r2_usage
  SET stored_bytes = MAX(
    0,
    stored_bytes
      - (CASE WHEN OLD.r2_key IS NOT NULL THEN OLD.byte_size ELSE 0 END)
      + (CASE WHEN NEW.r2_key IS NOT NULL THEN NEW.byte_size ELSE 0 END)
  )
  WHERE id = 1;
END;

-- 2. Uploads je UTC-Tag über alle Nutzer (Schutz der Class-A-Operationen und des Speichers).
--    Enthält keine personenbezogenen Daten.
CREATE TABLE IF NOT EXISTS upload_daily (
  day TEXT PRIMARY KEY,
  uploads INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0
);

-- 3. Abgebrochene Uploads findet der stündliche Cron über Status und Alter.
CREATE INDEX IF NOT EXISTS idx_sources_status_created ON sources (status, created_at);
