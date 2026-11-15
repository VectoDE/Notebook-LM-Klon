-- 0003_webauthn_challenges.sql
-- WebAuthn challenges live in D1 instead of the memory of a single Worker instance:
-- every instance sees the same challenge, each challenge is single-use (consumed with
-- DELETE ... RETURNING) and expires after five minutes. Expired rows are removed on
-- every new challenge and by the hourly cron (runScheduledCleanup).

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  challenge_key TEXT PRIMARY KEY, -- "reg:<user_id>" or "login:<challenge>"
  challenge TEXT NOT NULL,
  user_id TEXT,                   -- set for registration challenges, NULL for login
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires_at ON webauthn_challenges (expires_at);
