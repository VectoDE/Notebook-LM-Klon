# Systemarchitektur: Single-Worker Edge-Design

Stand: 2026-11-09 · Referenzen: Entscheidungen #4, #7, #11, #17, #18, #21, #22, #50

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/architecture-overview-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/architecture-overview-light.svg">
  <img alt="Architektur-Gesamtübersicht" src="./assets/architecture-overview-light.svg" width="100%">
</picture>
<sub>Grafik in <a href="./assets/architecture-overview-de.svg" hreflang="de" lang="de">Deutsch</a> · <a href="./assets/architecture-overview-en.svg" hreflang="en" lang="en">English</a></sub>

## 1. Leitprinzipien der Architektur

Der NotebookLM-Klon wurde von Grund auf für maximale Performance, strikte Datensouveränität und minimale Betriebskosten entworfen:

1. **Ein einziger Cloudflare Worker (`apps/worker`):** Liefert sowohl die statischen React-19-PWA-Assets (`ASSETS`-Binding mit SPA-Fallback) als auch die gesamte REST-/SSE-/WebSocket-API unter `/api/v1/*` (Hono-Framework) aus.
2. **Eine einzige SQL-Datenbank (`DB` – Cloudflare D1):** Speichert Nutzer, Passkeys, Sessions, Workspaces, Notebooks, Quell-Metadaten, Text-Chunks, `int8`-quantisierte 768d-Vektoren, den `FTS5`-Volltextindex sowie Chat-Verläufe und Audit-Logs.
3. **Ein einziger Medienspeicher (`MEDIA` – Cloudflare R2):** Hält hochgeladene Originaldokumente (PDF, Audio, Bilder) sowie synthetisierte Multi-Speaker-Audio-Overviews und DSGVO-Datenexport-Archive.
4. **Zwei SQLite-Durable-Objects (`NotebookDO` & `JobDO`):**
   - `NotebookDO`: Verwaltet pro Notebook die Echtzeit-Kollaboration (Hibernatable WebSockets, Live-Präsenz, LWW-Notizen) und hält die `int8`-Vektoren des Notebooks im Arbeitsspeicher für Millisekunden-schnelles Dot-Product-Scoring (30 s CPU-Budget statt 10 ms Worker-Limit).
   - `JobDO`: Verarbeitet Hintergrundjobs (Audio-Overview-TTS, Video-Storyboard, Mindmap, Flashcards, Quiz, DSGVO-Export) zuverlässig über eine SQLite-Queue und `alarm()` mit exponentiellem Backoff.
5. **Browser-Ingest-Pipeline (Web Worker):** PDF-Textextraktion (`pdf.js`), DOCX-Konvertierung (`mammoth`), Bild-OCR (`Tesseract.js` WASM) und das token-bewusste Chunking laufen im Browser des Nutzers. Dadurch kostet der Dokumenten-Ingest im Cloudflare Worker nahezu null CPU-Millisekunden.

---

## 2. Datenfluss-Diagramm (Komponenten & Protokolle)

```mermaid
flowchart TB
  subgraph Client["Browser Client (React 19 PWA · 4 Live-Themes · WCAG 2.2 AAA)"]
    UI["3-Spalten-UI (Quellen | Zitat-Chat | 6-Tool-Studio)"]
    WW["Ingest Web Worker (PDF.js, Mammoth, Tesseract WASM, Chunker, int8-Quant)"]
    SW["Service Worker + IndexedDB (Offline-Lesen & Offline-RAG)"]
    VR["60-fps HTML5 Canvas Video-Player & MediaRecorder (.webm/.mp4)"]
    OL_LOC["Lokales Ollama (http://127.0.0.1:11434 · 100% Air-Gapped)"]
  end

  subgraph Edge["Cloudflare Global Edge (Ein einziger Worker: notebook-lm-klon)"]
    ASSETS["Worker Static Assets (SPA-Fallback)"]
    HONO["Hono API Gateway (/api/v1/* · Zod · RFC 9457 · CSP · RBAC)"]
    NDO["NotebookDO (SQLite · Hibernatable WS · In-Memory Int8 Vector Engine)"]
    JDO["JobDO (SQLite Queue · alarm() Retry Engine)"]
    D1[("Cloudflare D1 (SQLite + FTS5 BM25 + int8 BLOBs)")]
    R2[("Cloudflare R2 (Originalquellen + Audio-Streams)")]
  end

  subgraph Providers["Externe KI-Provider (AES-256-GCM BYOK / RelationFlow Auto-Router)"]
    GEMINI["Google Gemini API (Chat, 768d Embeddings, Multi-Speaker TTS)"]
    OPENAI["OpenAI API (GPT-4o / text-embedding-3-small)"]
    CLAUDE["Anthropic Claude API (Claude 3.7 Sonnet / Haiku)"]
    OL_TUN["Remote EU-Ollama (Cloudflare Tunnel + Access Service Token)"]
  end

  UI -->|HTTPS Static Assets| ASSETS
  UI -->|REST / SSE Streaming| HONO
  UI <-->|WSS Hibernatable WebSocket| NDO
  UI -->|Presigned PUT / Range GET| R2
  WW -->|Batch Chunks + int8 Vectors| HONO
  UI <-->|Offline Sync| SW
  UI <-->|Local Fetch| OL_LOC

  HONO --> D1
  HONO --> R2
  HONO <-->|RPC / Fetch| NDO
  HONO <-->|Enqueue / Status| JDO
  NDO --> D1
  JDO --> D1
  JDO --> R2

  HONO -->|Streaming Proxy| GEMINI & OPENAI & CLAUDE & OL_TUN
  JDO -->|Multi-Speaker TTS & JSON Synthesis| GEMINI
```

---

## 3. Sequenzdiagramm: Dokumenten-Upload, Hybrid-RAG & Zitat-Chat

```mermaid
sequenceDiagram
  autonumber
  actor User as Nutzer (Browser)
  participant WW as Ingest Web Worker
  participant API as Hono Worker (/api/v1)
  participant R2 as Cloudflare R2
  participant D1 as Cloudflare D1 (SQLite + FTS5)
  participant NDO as NotebookDO (RAM Vector Cache)
  participant LLM as LLM Provider (Gemini / Ollama)

  User->>API: POST /notebooks/:id/sources (Metadaten, MIME, Größe)
  API-->>User: Presigned R2 Upload-URL (oder Streaming-Fallback-Token)
  User->>R2: PUT Binärdatei (PDF/DOCX/Bild)
  User->>WW: Starte lokales Parsing, OCR & Chunking (800 Tokens, 100 Overlap)
  WW->>LLM: Erzeuge 768d Embeddings (BYOK oder lokal via Ollama)
  WW->>WW: Symmetrische int8-Quantisierung (768 Bytes/Vektor + scale)
  WW->>API: POST /sources/:id/chunks (Batch Chunks + int8-Vektoren)
  API->>D1: Batch INSERT in chunks, chunk_vectors & FTS5-Trigger
  API->>NDO: Invalidiere / Aktualisiere In-Memory-Vektor-Cache

  User->>API: POST /notebooks/:id/chat (Frage + Anfrage-Vektor)
  par Semantische Vektorsuche
    API->>NDO: searchVectors(queryInt8Vec, topK=20)
    NDO-->>API: Top-20 Chunk-IDs + Cosine/Dot-Product-Scores (< 3 ms)
  and Lexikalische Volltextsuche
    API->>D1: SELECT id, bm25(chunks_fts) FROM chunks_fts WHERE MATCH ?
    D1-->>API: Top-20 Chunk-IDs + BM25-Scores
  end
  API->>API: Reciprocal Rank Fusion (RRF, k=60) → Top-8 Chunks
  API->>LLM: Stream Chat mit Anti-Prompt-Injection-Kontext [1]..[8]
  LLM-->>API: SSE Token-Stream inkl. Zitat-Markern [1], [3]
  API->>API: Validiere jedes [n] gegen echte Chunk-IDs (Halluzinations-Filter)
  API-->>User: SSE Stream + verifizierte citations[] (Sprung zu Seite/Offset)
```

---

## 4. Monorepo-Struktur (`pnpm-workspace.yaml`)

| Paket | Pfad | Verantwortung |
|---|---|---|
| `@notebook-lm/shared` | `packages/shared` | Gemeinsame Zod-Schemas, RFC 9457 Problem Details, DTOs, `int8`-Quantisierungs-Mathematik, RRF-Algorithmus, Zitat-Validator und UTF-8-Encoding-Guard. |
| `@notebook-lm/worker` | `apps/worker` | Cloudflare Worker (Hono), Auth (Passkeys, Sessions, Turnstile, RBAC), BYOK-AES-GCM-Tresor, D1-Repositories, R2-Streaming, `NotebookDO`, `JobDO` und Provider-Adapter. |
| `@notebook-lm/web` | `apps/web` | React 19 + TypeScript + Vite PWA, 4 live umschaltbare Design-Systeme (Hell/OLED-Dunkel/AAA-Kontrast), 3-Spalten-Workspace, Ingest-Web-Worker, 6 Studio-Werkzeuge und 60-fps-Canvas-Video-Renderer. |
