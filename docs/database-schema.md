# Datenbank-Schema (Cloudflare D1 SQLite)

Stand: 2026-11-09 · Referenzen: Entscheidungen #7, #10, #32, #33, #40, #58

## 1. Entity-Relationship-Diagramm (ER-Modell)

Alle Primärschlüssel verwenden zeitlich sortierbare Text-IDs (`ULID` / `UUIDv7`). Zeitstempel werden als `INTEGER` (Unix-Epoche in Millisekunden) gespeichert. `PRAGMA foreign_keys = ON` ist in D1 standardmäßig aktiv.

```mermaid
erDiagram
  USERS ||--o{ PASSKEYS : "besitzt"
  USERS ||--o{ SESSIONS : "authentifiziert"
  USERS ||--o{ PROVIDER_KEYS : "speichert BYOK (AES-GCM)"
  USERS ||--|| QUOTAS : "Kontingent"
  USERS ||--o{ WORKSPACES : "besitzt (owner_id)"
  USERS ||--o{ WORKSPACE_MEMBERS : "Mitgliedschaft"
  WORKSPACES ||--o{ WORKSPACE_MEMBERS : "Rollen (owner/editor/viewer)"
  WORKSPACES ||--o{ NOTEBOOKS : "enthält"
  NOTEBOOKS ||--o{ NOTEBOOK_SHARES : "geteilt mit"
  NOTEBOOKS ||--o{ SOURCES : "Quellen (max. 50)"
  SOURCES ||--o{ CHUNKS : "ON DELETE CASCADE"
  CHUNKS ||--|| CHUNK_VECTORS : "768d int8 BLOB"
  CHUNKS ||--|| CHUNKS_FTS : "FTS5 Volltext-Trigger"
  NOTEBOOKS ||--o{ CHATS : "Konversationen"
  CHATS ||--o{ MESSAGES : "Nachrichten + citations JSON"
  NOTEBOOKS ||--o{ ARTIFACTS : "6 Studio-Werkzeuge"
  NOTEBOOKS ||--o{ NOTES : "Echtzeit-Notizen (LWW)"
  USERS ||--o{ AUDIT_LOG : "Sicherheits-Events"

  USERS {
    TEXT id PK
    TEXT email "UNIQUE NULL (NULL bei Gästen)"
    TEXT display_name
    TEXT locale "'de' | 'en'"
    INTEGER is_guest "0 | 1"
    INTEGER created_at
    INTEGER expires_at "NULL oder +24h bei Gästen"
    INTEGER deleted_at "NULL"
  }

  PASSKEYS {
    TEXT id PK "WebAuthn credential_id"
    TEXT user_id FK
    BLOB public_key
    INTEGER sign_count
    TEXT transports
    TEXT aaguid
    INTEGER created_at
    INTEGER last_used_at
  }

  SESSIONS {
    TEXT id_hash PK "SHA-256(__Host-sid)"
    TEXT user_id FK
    INTEGER created_at
    INTEGER expires_at
    TEXT ip_hash "SHA-256(IP + DailySalt)"
    TEXT ua_hash
  }

  WORKSPACES {
    TEXT id PK
    TEXT name
    TEXT owner_id FK
    INTEGER created_at
  }

  WORKSPACE_MEMBERS {
    TEXT workspace_id PK,FK
    TEXT user_id PK,FK
    TEXT role "'owner' | 'editor' | 'viewer'"
  }

  NOTEBOOKS {
    TEXT id PK
    TEXT workspace_id FK
    TEXT title
    TEXT emoji
    TEXT created_by FK
    INTEGER created_at
    INTEGER updated_at
    INTEGER expires_at "NULL oder +30d im Demo-Profil"
  }

  SOURCES {
    TEXT id PK
    TEXT notebook_id FK
    TEXT kind "'pdf'|'txt'|'md'|'docx'|'url'|'text'|'youtube'|'audio'|'image'|'gdoc'"
    TEXT title
    TEXT r2_key "NULL bei reinem Text/URL"
    TEXT mime
    INTEGER bytes
    INTEGER word_count
    TEXT status "'uploading'|'processing'|'ready'|'error'"
    TEXT checksum "SHA-256"
    INTEGER created_at
  }

  CHUNKS {
    TEXT id PK
    TEXT source_id FK
    TEXT notebook_id FK
    INTEGER ord
    TEXT text
    INTEGER page "NULL (PDF-Seitenzahl)"
    INTEGER start_ms "NULL (Audio/Video-Zeitmarke)"
    INTEGER token_count
  }

  CHUNK_VECTORS {
    TEXT chunk_id PK,FK
    TEXT notebook_id FK
    TEXT model "'gemini-embedding-001' | 'nomic-embed-text'"
    INTEGER dim "768"
    REAL scale "Quantisierungs-Skalierungsfaktor"
    BLOB vec "768 Bytes Int8Array"
  }

  MESSAGES {
    TEXT id PK
    TEXT chat_id FK
    TEXT role "'user' | 'assistant'"
    TEXT content
    TEXT citations "JSON Array [n] -> chunk_id, page, snippet"
    TEXT provider "'gemini'|'ollama'|'openai'|'claude'"
    TEXT model
    INTEGER ai_generated "1 (EU AI Act Art. 50)"
    INTEGER created_at
  }

  ARTIFACTS {
    TEXT id PK
    TEXT notebook_id FK
    TEXT kind "'summary'|'audio'|'video'|'mindmap'|'flashcards'|'quiz'|'faq'|'timeline'"
    TEXT lang "'de' | 'en'"
    TEXT status "'queued'|'processing'|'ready'|'error'"
    TEXT r2_key "Audio/Media-Key in R2"
    TEXT content "JSON Payload (Mindmap, Quiz, Slides, etc.)"
    TEXT transcript_vtt_key "WebVTT Untertitel"
    TEXT provider
    TEXT model
    INTEGER created_at
  }

  PROVIDER_KEYS {
    TEXT id PK
    TEXT user_id FK
    TEXT provider "'gemini'|'openai'|'claude'|'ollama_tunnel'"
    BLOB ciphertext "AES-256-GCM"
    BLOB iv "12 Bytes"
    INTEGER key_version "1"
    TEXT last4 "Maskierte Anzeige"
    INTEGER created_at
  }
```

---

## 2. Performance-Indizes für minimale `Rows read` in D1

Damit Abfragen im Cloudflare Free-Plan (Limit: 5 Mio. gelesene Zeilen pro Tag) keine Tabellen-Vollscans auslösen, sind folgende zusammengesetzte Indizes definiert:

| Index-Name | Tabelle & Spalten | Zweck |
|---|---|---|
| `idx_chunks_notebook_source_ord` | `chunks(notebook_id, source_id, ord)` | Geordnetes Laden von Quelltext-Abschnitten und schneller Kontext-Lookup nach `chunk_id`. |
| `idx_chunk_vectors_notebook` | `chunk_vectors(notebook_id)` | Einmaliger Kaltstart-Batch-Load aller `int8`-Vektoren eines Notebooks in den Arbeitsspeicher des `NotebookDO`. |
| `idx_sources_notebook_created` | `sources(notebook_id, created_at DESC)` | Sofortige Anzeige der Quellenliste im linken Workspace-Panel. |
| `idx_messages_chat_created` | `messages(chat_id, created_at ASC)` | Chronologisches Laden des Chat-Verlaufs ohne Sortier-Overhead. |
| `idx_sessions_expires` | `sessions(expires_at)` | Effiziente stündliche Cron-Bereinigung abgelaufener Sitzungen. |
| `idx_users_guest_expires` | `users(is_guest, expires_at)` | Automatische 24-Stunden-Löschung abgelaufener Gastkonten inkl. Kaskadierung. |
| `idx_notebooks_expires` | `notebooks(expires_at)` | Automatische 30-Tage-Bereinigung temporärer Demo-Notebooks. |
| `idx_webauthn_challenges_expires_at` | `webauthn_challenges(expires_at)` | Löschen abgelaufener WebAuthn-Challenges (bei jeder neuen Challenge und im stündlichen Cron). |

### WebAuthn-Challenges (`0003_webauthn_challenges.sql`)

Passkey-Challenges liegen in D1, nicht im Speicher einer einzelnen Worker-Instanz. Jede Challenge gilt fünf Minuten und lässt sich genau einmal verwenden: `consumeChallenge` holt sie mit `DELETE … RETURNING` in einer einzigen Anweisung heraus, eine zweite Verwendung findet nichts mehr (Replay-Schutz). Registrierungs-Challenges tragen die `user_id` und gelten nur für diese Person.

| Spalte | Typ | Bedeutung |
|---|---|---|
| `challenge_key` | `TEXT PRIMARY KEY` | `reg:<user_id>` oder `login:<challenge>` |
| `challenge` | `TEXT` | Die an den Browser ausgegebene Challenge |
| `user_id` | `TEXT NULL` | Bei Registrierung die angemeldete Person, beim Login leer |
| `created_at`, `expires_at` | `INTEGER` | Zeitstempel in ms, Ablauf nach 5 Minuten |

### Kommentare und Erwähnungen (`0005_comments.sql`, Issue #353)

Kommentare hängen an einer Quelle oder einer Notiz desselben Notebooks. SQLite kennt keinen Fremdschlüssel auf zwei Tabellen, deshalb löschen die Trigger `sources_comments_ad` und `notes_comments_ad` die Kommentare mit ihrem Ziel. Mit dem Notebook oder dem Konto der verfassenden Person verschwinden sie über `ON DELETE CASCADE`. Die Nummer 0005 lässt 0004 frei, weil ein offener PR (#388) sie belegt.

| Spalte (`comments`) | Typ | Bedeutung |
|---|---|---|
| `id` | `TEXT PRIMARY KEY` | `cmt_<uuid>` |
| `notebook_id` | `TEXT` → `notebooks.id` | Notebook, gegen das jede Anfrage geprüft wird |
| `target_type`, `target_id` | `TEXT` | `source` oder `note` und dessen ID |
| `author_id` | `TEXT` → `users.id` | verfassende Person |
| `body` | `TEXT`, 1 bis 4000 Zeichen (`CHECK`) | Klartext, wird nie als HTML ausgegeben |
| `created_at`, `updated_at` | `INTEGER` | ms; `updated_at > created_at` heißt „bearbeitet“ |

`comment_mentions(comment_id, user_id)` hält die Erwähnungen. Der Worker nimmt nur Personen an, die über den Workspace oder eine Freigabe Zugriff auf das Notebook haben. Indizes: `idx_comments_target (notebook_id, target_type, target_id, created_at)` für den Faden, `idx_comment_mentions_user (user_id)` für „Wo werde ich erwähnt“.

Rechte: Lesen ab `viewer`, Schreiben ab `editor`, Bearbeiten nur durch die verfassende Person (mit `editor`), Löschen durch die verfassende Person oder den `owner`. Ratenbegrenzung: eigene Kategorie `comments` mit 60 Anfragen je Minute und Person.
