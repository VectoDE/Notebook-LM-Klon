-- Migration 0003: Nutzereigene OpenAI-kompatible Endpunkte (BYOM, Issue #247)
-- Der API-Schlüssel liegt weiterhin verschlüsselt in provider_keys (provider = 'custom').
-- Hier stehen nur Adresse und Modellnamen, keine Geheimnisse.

CREATE TABLE IF NOT EXISTS provider_endpoints (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('custom')),
  base_url TEXT NOT NULL,
  chat_model TEXT NOT NULL,
  embed_model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider)
);
