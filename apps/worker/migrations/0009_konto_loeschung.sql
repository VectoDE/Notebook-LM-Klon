-- 0009_konto_loeschung.sql
-- Kontolöschung ohne Verlust fremder Inhalte (Entscheidungen F361/F365).
-- Nummer 0009, weil 0004 (usage_counters) und 0006 (custom_endpoints) von offenen Zweigen belegt sind.
--
-- 1. Platzhalterkonto "user_deleted": Autorfelder (Kommentare, Notizen, Chats, Artefakte) in
--    fremden Notebooks werden beim Löschen eines Kontos auf dieses Konto umgehängt, statt
--    kaskadierend gelöscht. deleted_at ist gesetzt, es gibt keine E-Mail und keine Sitzung,
--    eine Anmeldung ist ausgeschlossen (getUserById filtert deleted_at).
-- 2. pending_r2_purge: R2-Präfixe, die nach der D1-Löschung noch zu leeren sind. Der Eintrag
--    entsteht im selben atomaren Batch wie die Löschung und verschwindet erst nach erfolgreichem
--    R2-Löschen. Der Cron räumt Reste auf, so bleiben bei einem R2-Fehler keine Dateien zurück.

INSERT OR IGNORE INTO users (id, email, display_name, locale, is_guest, created_at, expires_at, deleted_at)
VALUES ('user_deleted', NULL, 'Gelöschtes Konto', 'de', 0, 0, NULL, 0);

CREATE TABLE IF NOT EXISTS pending_r2_purge (
  prefix TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
