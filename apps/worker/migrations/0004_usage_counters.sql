-- 0004_usage_counters.sql
-- Cookie-free, aggregated usage counters (Issue #262).
-- One row per UTC day and metric. No IP address, no user ID, no device or session ID.

CREATE TABLE IF NOT EXISTS usage_counters (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, metric)
);
