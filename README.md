<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/hero-banner-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/hero-banner-light.svg">
  <img alt="RelationNotes – NotebookLM & RelationFlow Knowledge Studio" src="docs/assets/hero-banner-light.svg" width="100%">
</picture>
<sub>Grafik in <a href="docs/assets/hero-banner-de.svg" hreflang="de" lang="de">Deutsch</a> · <a href="docs/assets/hero-banner-en.svg" hreflang="en" lang="en">English</a></sub>

# RelationNotes

### **NotebookLM & RelationFlow Knowledge Studio**

*Quellengebundene KI-Forschung, Hybrid-RAG (D1 FTS5 + Int8-Vektorsuche), multimodales Audio-/Video-Studio und bidirektionale Wissensgraph-Synthese – zu 100 % lauffähig im kostenlosen Cloudflare Free Tier.*

[![CI – Quality, Security & Checklist Gate](https://github.com/VectoDE/Notebook-LM-Klon/actions/workflows/ci.yml/badge.svg)](https://github.com/VectoDE/Notebook-LM-Klon/actions/workflows/ci.yml)
[![CodeQL SAST](https://github.com/VectoDE/Notebook-LM-Klon/actions/workflows/codeql.yml/badge.svg)](https://github.com/VectoDE/Notebook-LM-Klon/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/VectoDE/Notebook-LM-Klon/badge)](https://scorecard.dev/viewer/?uri=github.com/VectoDE/Notebook-LM-Klon)
[![Test Coverage: 100%](https://img.shields.io/badge/Coverage-100%25-10B981?style=flat&logo=vitest&logoColor=white)](vitest.config.ts)
[![Accessibility: WCAG 2.2 AAA](https://img.shields.io/badge/Accessibility-WCAG_2.2_AAA-2563EB?style=flat)](docs/accessibility-wcag-aaa.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-F59E0B.svg)](LICENSE)

[**Offizielles GitHub Wiki**](https://github.com/VectoDE/Notebook-LM-Klon/wiki) · [**Systemarchitektur**](docs/architecture.md) · [**Hybrid-RAG & Vektoren**](docs/rag-and-vectors.md) · [**RelationFlow-Brücke**](docs/relationflow-integration.md) · [**Security & DSGVO**](docs/security-and-compliance.md) · [**WCAG 2.2 AAA**](docs/accessibility-wcag-aaa.md)

</div>

---

## Schnell-Einstieg nach Lesergruppe (Navigation für Reviewer)

| Zielgruppe | Was Sie hier in 2 Minuten finden | Direkte Einstiegspunkte |
| :--- | :--- | :--- |
| **HR, Recruiting & Produkt-Entscheider** | Ein schlüsselfertiges KI-Forschungs- & Wissens-Studio, das Dokumente mit **absatzgenauen Inline-Zitaten `[1]`** belegt, als **Zwei-Host-Podcast** vertont und nahtlos mit dem Wissensgraphen [**RelationFlow**](https://github.com/VectoDE/RelationFlow) verbindet – ohne laufende Cloud-Fixkosten (`0 €` Cloudflare Free Tier). | [Kernfunktionen](#warum-relationnotes--kernfunktionen--alleinstellungsmerkmale) · [Loom-Präsentations-Leitfaden](docs/loom-presentation-guide.md) · [Barrierefreiheit WCAG 2.2 AAA](docs/accessibility-wcag-aaa.md) |
| **Senior Engineers & Tech Leads** | Strikte Edge-Architektur unter realen **10 ms CPU-Limits** pro Request: **Reciprocal Rank Fusion (`k = 60`)** aus SQLite `FTS5` (`bm25`) und `int8`-quantisierten Matryoshka-Vektoren (`768 Dim`) im `NotebookDO`-RAM (`< 2 ms`), `node:sqlite`-Verifikation, **100 % Testabdeckung** (Unit, Integration, Contract, `fast-check` Property-Fuzzing). | [Systemarchitektur](docs/architecture.md) · [Hybrid-RAG-Mathematik](docs/rag-and-vectors.md) · [Cloudflare-Budgets](docs/platform-limits.md) · [D1-Datenbankschema](docs/database-schema.md) |
| **Security-, Privacy- & OpenSSF-Auditoren** | **WebAuthn Passkeys (`ES256`)**, Envelope-Encryption (**AES-256-GCM mit AAD**) für BYOK-API-Schlüssel, strikter SSRF-Guard, SHA-gepinnte GitHub Actions, `gitleaks`, `osv-scanner`, `CodeQL`, OpenSSF Scorecard sowie vollständige **DSGVO- & EU-AI-Act-Art.-50-Konformität** (C2PA / SynthID / JSON-Manifeste). | [Security, DSGVO & AI Act](docs/security-and-compliance.md) · [OpenSSF-Richtlinie](docs/openssf.md) · [`.github/SECURITY.md`](.github/SECURITY.md) |

---

## Warum RelationNotes? – Kernfunktionen & Alleinstellungsmerkmale

Klassische KI-Chats halluzinieren Zusammenhänge und verlieren nach dem Gespräch den Bezug zu den Originaldokumenten. **RelationNotes** verbindet die präzise Quellentreue von **Google NotebookLM** mit der strukturierten Wissensmodellierung von [**RelationFlow**](https://github.com/VectoDE/RelationFlow):

1. **Multi-Format-Quellen-Ingestion & Zitat-Präzision:**
   - Verarbeitung von **PDFs** (`unpdf`), **DOCX** (`mammoth`), **Markdown/TXT/CSV**, **Webseiten** (Readability + strikter SSRF-Guard), **YouTube-Transkripten** und **Audio-Aufnahmen**.
   - Jede KI-Aussage enthält klickbare **Inline-Zitate (`[1]`, `[2]`)**, die im Quellen-Viewer exakt den belegenden Originalabsatz samt Zeichen-Offset (`start_offset`, `end_offset`) und Textmarkierung hervorheben.
2. **Lokale Hybrid-RAG-Engine ohne externe Vektordatenbank-Kosten:**
   - **Lexikalische Suche:** SQLite `FTS5` mit `unicode61`-Tokenizer und `bm25()`-Ranking direkt in Cloudflare D1.
   - **Semantische Vektorsuche:** Matryoshka-Embeddings (`768 Dimensionen`), `int8`-skalar-quantisiert (`768 Byte/Chunk` als `BLOB` in D1) und im Arbeitsspeicher des zuständigen `NotebookDO` in **`< 2 ms`** per Dot-Product ausgewertet.
   - **Reciprocal Rank Fusion (`RRF, k = 60`):** Deterministische Verschmelzung beider Rankings ohne kostenpflichtige Drittanbieter-Vektor-Cloud.
3. **Multimodales Studio (Audio-Overview, Video-Slides, Mindmap, Lernkarten, Quiz):**
   - **Zwei-Host-Audio-Overview:** Generiert natürliche Dialog-Skripte zwischen *Host A* (analytisch) und *Host B* (synthetisierend), synthetisiert diese zu einer abspielbaren Episode in Cloudflare R2 und liefert ein **wortgenaues, barrierefreies Synchron-Transkript**.
   - **Interaktive Mindmap & Lernwerkzeuge:** Automatische Konzeptgraphen (`@xyflow/react` + parallele ARIA-Treegrid-Gliederung), Spaced-Repetition-Lernkarten (`SM-2`) und Multiple-Choice-Quizzes mit Zitat-Begründung.
4. **Andock-Konzept für RelationFlow:**
   - Heute umgesetzt: die eigenständige Such-API `POST /api/v1/notebooks/:id/search` (Agenten können Notebook-Wissen als Tool abfragen), die Rollen `owner`, `editor` und `viewer` sowie der Auto-Modell-Router mit Datenschutzmodus.
   - Noch nicht umgesetzt: der Austausch von Entitäten und Kanten als `relationflow/export/v1`-Bundle. Das Format ist beschrieben, im Code gibt es dafür noch keine Implementierung. Details im Kapitel [Andocken an RelationFlow](#andocken-an-relationflow).
5. **Zwei Betriebsprofile (`APP_PROFILE=demo` vs. `full`) & BYOK:**
   - **Öffentlicher Demo-Showcase (`demo`):** Sofortiger 1-Klick-Gastzugang mit 2 kuratierten deutschen Beispiel-Notebooks (*„EU AI Act & DSGVO in der Praxis“* und *„Cloudflare Edge-Architektur & Hybrid-RAG“*), vorab berechneten Studio-Artefakten und Bring-Your-Own-Key (BYOK).
   - **Vollbetrieb (`full`):** Selbst-gehosteter Produktivmodus für Teams mit großzügigen Kontingenten (`100 Notebooks`, `50 Quellen`, `50.000 Chunks`).

---

## Systemarchitektur auf einen Blick

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/architecture-overview-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/architecture-overview-light.svg">
  <img alt="Systemarchitektur – RelationNotes auf Cloudflare Workers, D1, R2 und SQLite Durable Objects" src="docs/assets/architecture-overview-light.svg" width="100%">
</picture>
<sub>Grafik in <a href="docs/assets/architecture-overview-de.svg" hreflang="de" lang="de">Deutsch</a> · <a href="docs/assets/architecture-overview-en.svg" hreflang="en" lang="en">English</a></sub>

```mermaid
flowchart TB
    subgraph Client["Browser Client (React 19 + Vite 8 + Tailwind CSS v4 – WCAG 2.2 AAA)"]
        UI["3-Spalten-Workspace\n(Quellen | Chat & Zitate | Studio & Artefakte)"]
        A11Y["ARIA-Treegrid, Skip-Links,\nSynchron-Transkript & Offline-Drafts"]
    end

    subgraph Edge["Cloudflare Worker Edge Runtime (apps/worker – Single Deployment Unit)"]
        Router["Hono v4 API Router (/api/v1/*)\nRFC 9457 Problem Details + CSP + Rate-Limiting"]
        Auth["Auth & Crypto Layer\nWebAuthn Passkeys (ES256) + AES-256-GCM BYOK Vault"]
        RAG["Hybrid-RAG Orchestrator\nReciprocal Rank Fusion (RRF k=60)"]
    end

    subgraph Storage["Cloudflare Free-Tier Persistence & Stateful Coordination"]
        D1[("Cloudflare D1 (SQLite)\n17 Tabellen + chunks_fts (FTS5 bm25)")]
        R2[("Cloudflare R2 Object Storage\nOriginaldokumente, Audio/Video & Exports")]
        NDO[["NotebookDO (SQLite Durable Object)\nWebSocket Sync + In-Memory Int8 Vector Search (<2ms)"]]
        JDO[["JobDO (SQLite Durable Object)\nalarm()-gesteuerte Studio-Pipelines"]]
    end

    subgraph External["Optionale KI-Provider (BYOK / Free Tier) & Ökosystem"]
        LLM["Gemini 2.5 Flash / Workers AI /\nOpenAI / Anthropic / Ollama"]
        RF["RelationFlow Knowledge Graph\n(relationflow/export/v1 Bridge)"]
    end

    UI <-->|"HTTPS / SSE / WebSocket"| Router
    A11Y --- UI
    Router --> Auth
    Router --> RAG
    RAG <-->|"Lexikalisches BM25"| D1
    RAG <-->|"Int8 Dot-Product"| NDO
    Router <-->|"Streaming Byte-Range"| R2
    Router <-->|"Async Studio Jobs"| JDO
    JDO <-->|"Synthese & TTS"| LLM
    RAG <-->|"Grounded Generation"| LLM
    Router <-->|"JSON Bundle / postMessage"| RF
```

---

## Hybrid-RAG-Pipeline & RelationFlow-Wissensgraph-Brücke

| Hybrid-RAG-Pipeline (`FTS5` + `Int8` + `RRF k=60`) | Bidirektionale RelationFlow-Brücke (`v1`) |
| :---: | :---: |
| <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/rag-pipeline-dark.svg"><source media="(prefers-color-scheme: light)" srcset="docs/assets/rag-pipeline-light.svg"><img alt="Hybrid-RAG-Pipeline" src="docs/assets/rag-pipeline-light.svg" width="100%"></picture><br><sub>Grafik in <a href="docs/assets/rag-pipeline-de.svg" hreflang="de" lang="de">Deutsch</a> · <a href="docs/assets/rag-pipeline-en.svg" hreflang="en" lang="en">English</a></sub> | <picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/relationflow-bridge-dark.svg"><source media="(prefers-color-scheme: light)" srcset="docs/assets/relationflow-bridge-light.svg"><img alt="RelationFlow-Integration" src="docs/assets/relationflow-bridge-light.svg" width="100%"></picture><br><sub>Grafik in <a href="docs/assets/relationflow-bridge-de.svg" hreflang="de" lang="de">Deutsch</a> · <a href="docs/assets/relationflow-bridge-en.svg" hreflang="en" lang="en">English</a></sub> |
| Details in [`docs/rag-and-vectors.md`](docs/rag-and-vectors.md) | Details in [`docs/relationflow-integration.md`](docs/relationflow-integration.md) |

---

## Die vier Designs

Die Oberfläche lässt sich im laufenden Betrieb zwischen vier eigenständigen Designs umschalten. Jedes hat eigene Farben, eine eigene Schrift und eine eigene Anmutung. Dazu kommen die Farbmodi Hell, Dunkel und AAA-Hochkontrast. Die Token stehen in [`apps/web/src/design-tokens.ts`](apps/web/src/design-tokens.ts).

| Design | Idee | Schrift |
| :--- | :--- | :--- |
| **Pure NotebookLM** | Ruhige, helle Arbeitsfläche mit weichen Panels, Anmutung wie NotebookLM, eigene Farbe in Indigo und Lavendel. Standard. | Inter |
| **Immersive Cinema** | Nacht-Violett mit Fuchsia- und Cyan-Licht, eigene Bewegungssprache (abgeschaltet bei `prefers-reduced-motion`). | Space Grotesk |
| **Editorial Calm** | Farbwelt von Everlast und RelationFlow: Everlast-Blau für Flächen, Slate-Neutraltöne. | Source Serif 4 |
| **Fusion** | Petrol und Teal mit Bernstein, eigenständige Palette. | Geist |

---

## Die sechs Studio-Werkzeuge

Das Studio-Panel bietet sechs Werkzeuge. Sie arbeiten mit den Quellen des Notebooks und zeigen ihre Belege an.

| Werkzeug | Was es tut |
| :--- | :--- |
| **Audio-Overview** | Zwei-Host-Gespräch mit mitlaufendem Transkript. Per Rückfrage (`POST /api/v1/notebooks/:id/audio-interject`) lässt sich mitten im Gespräch nachfragen. |
| **Video-Overview** | Folien mit Kapiteln, im Browser abspielbar, Export als `.webm`. |
| **Mindmap** | Konzeptgraph als SVG, zusätzlich als ARIA-Baumansicht, mit Export. |
| **Lernkarten** | Karten zum Umdrehen, mit Export. |
| **Quiz** | Fragen mit Begründung aus der Quelle, mit Export. |
| **Briefing** | Kurzfassung des Notebooks. |

---

## Andocken an RelationFlow

[RelationFlow](https://github.com/VectoDE/RelationFlow) ist der Wissens-Workspace, an den RelationNotes sich anschließen soll. Die Beschreibung steht in [`docs/relationflow-integration.md`](docs/relationflow-integration.md). Hier der ehrliche Stand:

| Baustein | Stand | Wo |
| :--- | :--- | :--- |
| Such-API für Agenten: Hybrid-Suche (Vektor und FTS5, RRF) mit Zitaten, Seite und Offsets | Umgesetzt | `POST /api/v1/notebooks/:id/search`, siehe [`docs/openapi.json`](docs/openapi.json) |
| Rollen `owner`, `editor`, `viewer` je Notebook | Umgesetzt | `apps/worker/src/auth-middleware.ts` |
| Auto-Modell-Router, im Datenschutzmodus lokal (Ollama) | Umgesetzt | `GET /api/v1/providers`, `POST /api/v1/providers/route` |
| Studio-Jobs per API einreihen | Teilweise | `POST /api/v1/jobs/enqueue`. Status und Abbruch einzelner Jobs sind noch gesperrt, bis die Besitzprüfung steht. |
| Austausch von Entitäten und Kanten (`relationflow/export/v1`) | Noch nicht umgesetzt | Format nur beschrieben |

**Beispiel:** Ein Agent fragt ein Notebook ab. Er braucht eine Sitzung (Cookie) und mindestens die Rolle `viewer`.

```bash
curl -s -X POST "http://localhost:8787/api/v1/notebooks/<notebook-id>/search"   -H "content-type: application/json"   -b "sid=<sitzungs-token>"   -d '{"query":"Was verlangt Artikel 50 des EU AI Act?","mode":"hybrid","limit":5}'
```

Die Antwort enthält `results` mit `sourceTitle`, `page`, `score` und `snippet` je Fundstelle. Eine Anbindung von RelationFlow-Agenten braucht noch einen Weg, eine Sitzung für den Agenten zu erzeugen. Der steht nicht in dieser Version.

---

## API-Referenz (OpenAPI 3.1)

Alle Endpunkte unter `/api/v1` sind in [`docs/openapi.json`](docs/openapi.json) beschrieben, Fehler nach RFC 9457. Ein Test (`packages/shared/src/__tests__/openapi.test.ts`) liest die Routen aus dem Worker-Code und schlägt fehl, wenn eine Route in der Spezifikation fehlt. Neue Routen gehören also immer in diese Datei.

---

## Ehrlicher KI-Einsatz

- **Bei der Entwicklung:** Dieses Projekt entsteht mit KI-Coding-Assistenten. Der Inhaber legt Anforderungen, Architektur und Abnahme fest und prüft die Ergebnisse. Jede Änderung muss durch Typprüfung, Linter, Tests mit 100 % Abdeckung und Sicherheits-Scans, bevor sie in `main` kommt. Commits und Pull Requests tragen keine KI-Kennzeichnung (Entscheidung #38). Die Offenlegung steht deshalb hier.
- **Im Produkt:** Antworten, Audio, Video und Studio-Artefakte kommen von einem Sprachmodell und sind als KI-generiert markiert (`aiGenerated: true`, Anbieter, Modell, Zeitstempel). Welches Modell antwortet, bestimmt der Nutzer oder der Auto-Router. Mit Datenschutzmodus bleibt die Anfrage bei einem lokalen Modell. Bei Cloud-Modellen gehen Frage und Textausschnitte an den gewählten Anbieter. API-Schlüssel gehören dem Nutzer (BYOK) und liegen verschlüsselt (AES-256-GCM).
- **Grenzen:** Zitate verweisen auf Textstellen, die das Modell gelesen hat. Ob das Modell sie richtig deutet, bleibt zu prüfen.

---

## Technologie-Stack & Architekturentscheidungen

| Schicht | Eingesetzte Technologie | Version | Begründung & Mehrwert im Projekt |
| :--- | :--- | :--- | :--- |
| **Monorepo & Paketmanager** | `pnpm` Workspaces | `11.x` | Strikte Paket-Isolation (`packages/shared`, `apps/worker`, `apps/web`), deterministisches Lockfile. |
| **Sprache & Typisierung** | TypeScript (`strict: true`) | `5.8.x` | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` und generierte Cloudflare-Bindings (`wrangler types`). |
| **Edge-Backend & API** | Cloudflare Workers + `Hono` | `4.13.x` | Minimale Cold-Start-Latenz (`0 ms`), native Web-Standards (`Request`/`Response`), RFC-9457-Fehlerbehandlung. |
| **Datenbank & Volltext** | Cloudflare D1 (`SQLite` + `FTS5`) | Edge Native | Relationale Integrität über 17 Tabellen plus nativer `FTS5`-Index (`unicode61`, `bm25()`) ohne Zusatzkosten. |
| **Echtzeit & Hintergrund-Jobs** | Cloudflare SQLite Durable Objects | `NotebookDO`, `JobDO` | Zustandsbehaftete In-Memory-Vektorsuche (`< 2 ms`), WebSocket-Kollaboration und `alarm()`-basierte Studio-Jobs. |
| **Objektspeicher** | Cloudflare R2 | S3-kompatibel | Kostenfreie Egress-Auslieferung für PDF-Quellen, Audio-Overviews und DSGVO-Datenexporte (`10 GB Free Tier`). |
| **Frontend-Workspace** | React 19 + Vite 8 | `19.3.x` / `8.3.x` | Schnelle Drei-Spalten-Oberfläche mit barrierefreier Semantik und lokalem Entwurfsschutz. |
| **Verträge & Validierung** | `Zod` | `4.6.x` | Gemeinsame Laufzeit-Schemata zwischen Worker und Frontend inkl. RFC 9457 Problem Details. |
| **Linter & A11y-Statik** | `@biomejs/biome` | `1.9.x` | Einheitliches Linting & Formatting mit **29 verschärften WAI-ARIA-/JSX-Barrierefreiheitsregeln**. |
| **Test- & Fuzzing-Suite** | `Vitest` + `@vitest/coverage-v8` + `fast-check` | `5.1.x` / `4.10.x` | **100 % Code-Coverage-Gate** (Lines, Functions, Branches, Statements) + Property-Based Fuzzing. |
| **AppSec & Supply Chain** | `Gitleaks`, `OSV-Scanner`, `CodeQL`, `Scorecard` | SHA-gepinnt | Lückenlose Prüfung auf Secrets, CVEs, SAST-Schwachstellen und OpenSSF-Best-Practices bei jedem Push/PR. |

---

## Sicherheit, Barrierefreiheit & DSGVO

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/security-layers-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/security-layers-light.svg">
  <img alt="Defense-in-Depth Sicherheits- & Compliance-Schichten" src="docs/assets/security-layers-light.svg" width="100%">
</picture>
<sub>Grafik in <a href="docs/assets/security-layers-de.svg" hreflang="de" lang="de">Deutsch</a> · <a href="docs/assets/security-layers-en.svg" hreflang="en" lang="en">English</a></sub>

- **Kryptografisches Budget innerhalb von 10 ms CPU-Zeit:** Durch unseren Benchmark ([`apps/worker/src/crypto-benchmark.ts`](apps/worker/src/crypto-benchmark.ts)) ist nachgewiesen, dass `SHA-256` (`~0,01 ms`), `AES-256-GCM` Envelope-Roundtrip mit `AAD` (`~0,03 ms`) und `ECDSA P-256` Passkey-Verifikation (`~0,25 ms`) zusammen **`< 0,6 ms` CPU-Zeit** benötigen – über **94 % der 10-ms-Free-Tier-Reserve** bleiben frei für Fachlogik.
- **Barrierefreiheit:** Jede der vier Oberflächen gibt es in Hell, Dunkel und AAA-Hochkontrast. Das Ziel für Text ist ein Kontrast von mindestens 7:1 (WCAG 2.2, 1.4.6), für Rahmen und Fokus mindestens 3:1. Die Vorgaben stehen in `apps/web/src/design-tokens.ts`, der Stand der Prüfung in [`docs/accessibility-wcag-aaa.md`](docs/accessibility-wcag-aaa.md).
- **DSGVO-Rechte per 1-Klick:** Vollständiger maschinenlesbarer Datenexport (Art. 15 / Art. 20 DSGVO) sowie kryptografisch verifizierte Kaskadenlöschung über D1, R2 und Durable Objects (Art. 17 DSGVO).
- **Training mit Eingaben je KI-Modell:** Ob ein Anbieter Eingaben zum Training nutzt, hängt vom Modell und vom Zugangsweg ab (bei Google Gemini etwa von kostenpflichtiger Nutzung und Region). Die App zeigt die Angabe beim gewählten Modell mit Quelle; Tabelle, Wortlaut und Abrufdatum stehen in [`docs/datenschutz-modelle.md`](docs/datenschutz-modelle.md). Das ist eine Zusammenfassung der Anbieterangaben, keine Rechtsberatung.
- **EU AI Act Art. 50 Transparenz:** Jedes generierte Audio-, Video-, Text- oder Graph-Artefakt trägt ein sichtbares KI-Kennzeichen sowie ein maschinenlesbares Provenienz-Manifest (`ai_generated: true`, Modell-ID, Zeitstempel, SHA-256-Quell-Hashes).

---

## Schnellstart – Einrichtung, Tests & Verifikation

### Voraussetzungen
- **Node.js** `>= 26` (aktuelle LTS „Lithium“, CI nutzt Node 26)
- **pnpm** `>= 10.0.0` (oder Corepack aktiviert)

### 1. Repository klonen & Abhängigkeiten installieren
```bash
git clone https://github.com/VectoDE/Notebook-LM-Klon.git
cd Notebook-LM-Klon
pnpm install --frozen-lockfile
```

### 2. Qualitäts-, Sicherheits- & 100-%-Coverage-Gates ausführen
```bash
# 1. Biome Linter, Formatierer & 29 WAI-ARIA A11y-Regeln prüfen
pnpm lint

# 2. Strikte TypeScript-Typprüfung über alle Workspaces
pnpm typecheck

# 3. Vollständige Test-Suite (Unit, Integration, Contract, Property-Fuzzing, A11y) mit 100 % Coverage-Gate
pnpm test:coverage

# 4. Produktions-Build (Shared -> Worker & React Web-App)
pnpm build
```

### 3. Lokale Edge-Entwicklung starten
```bash
# Startet den lokalen Cloudflare Worker (Port 8787) bzw. die Web-App (Port 5173)
pnpm --filter @notebook-lm/worker dev
pnpm --filter @notebook-lm/web dev
```

Prüfe den lokalen Health-Endpunkt:
```bash
curl -i http://localhost:8787/api/v1/health
```

### 4. Betrieb: Client-IP und `TRUSTED_PROXY_HEADER` (für Betreiber)

Rate-Limits, Turnstile (`remoteip`), Sitzungen und das BYOK-Audit-Log brauchen die IP-Adresse des Clients. Der Worker ermittelt sie an genau einer Stelle, `resolveClientIp()` in [`apps/worker/src/rate-limiter.ts`](apps/worker/src/rate-limiter.ts), und vertraut dabei nur Quellen, die nicht vom Client stammen:

| Reihenfolge | Quelle | Wann sie gilt |
| :--- | :--- | :--- |
| 1 | Header aus `TRUSTED_PROXY_HEADER`, davon der **letzte** Eintrag | Nur wenn der Betreiber die Variable setzt |
| 2 | `cf-connecting-ip` | Nur in der Cloudflare-Workers-Laufzeit (setzt die Cloudflare-Edge) |
| 3 | Socket-Adresse der TCP-Verbindung | Nur im Node-Server |

Ohne diese Garantien werden `cf-connecting-ip` und `x-forwarded-for` ignoriert, weil jeder Client sie frei setzen kann. Ist keine vertrauenswürdige IP bekannt, wird keine IP gespeichert oder an Turnstile übergeben.

- **Cloudflare Workers:** nichts einstellen. Die Edge setzt `cf-connecting-ip` selbst.
- **Node-Server direkt im Internet:** nichts einstellen. Es zählt die Socket-Adresse.
- **Node-Server hinter einem Reverse Proxy** (nginx, Caddy, Traefik, Load Balancer): `TRUSTED_PROXY_HEADER` auf den Header setzen, den **Ihr** Proxy schreibt, zum Beispiel `TRUSTED_PROXY_HEADER=x-forwarded-for` oder `TRUSTED_PROXY_HEADER=x-real-ip`. Groß- und Kleinschreibung spielen keine Rolle.

Wichtig: Setzen Sie `TRUSTED_PROXY_HEADER` nur, wenn der Server ausschließlich über diesen Proxy erreichbar ist und der Proxy den Header selbst anhängt oder überschreibt (nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` oder `proxy_set_header X-Real-IP $remote_addr;`). Ist der Server zusätzlich direkt erreichbar, kann ein Angreifer den Header fälschen und Rate-Limits umgehen. Bei mehreren Proxys hintereinander zählt der letzte Eintrag, also die Adresse, die der Proxy direkt vor dem Server gesehen hat.

---

## Betrieb mit Node.js und Docker

RelationNotes läuft auch ohne Cloudflare: ein Node-Prozess liefert Web-App und API über einen Port (Standard `8787`). D1 wird zu SQLite (`node:sqlite`), R2 zu Dateien auf der Platte. `NotebookDO` und `JobDO` laufen als echte Klassen im Prozess, der stündliche Cron als Zeitplan im Server. Getestet wird in der CI auf Node 26 LTS. Belegt sind dort das Docker-Image mit Healthcheck, derselbe Smoke-Check gegen `wrangler dev` und gegen Node sowie Playwright gegen den Node-Build.

### Starten

```bash
# Docker (empfohlen): Secrets setzen, Image bauen, starten
export SESSION_SALT_SECRET=$(openssl rand -hex 32) KEK_V1=$(openssl rand -hex 32)
export TURNSTILE_SECRET_KEY=<Ihr Secret> VITE_TURNSTILE_SITE_KEY=<Ihr Site-Key>
docker compose up -d --build
curl http://localhost:8787/api/v1/health

# Ohne Docker (Node >= 26): bauen und das Bundle starten
pnpm install --frozen-lockfile && pnpm build
SESSION_SALT_SECRET=… KEK_V1=… node apps/worker/dist/node-server.js
```

`pnpm build` erzeugt `apps/worker/dist/node-server.js` mit allen Abhängigkeiten. Das Laufzeit-Image (`apps/worker/Dockerfile`) enthält deshalb nur dieses Bundle, die Migrationen und `apps/web/dist`. Es enthält kein `node_modules`, keine Quellen und kein `tsx`, läuft als Benutzer `node` und baut auf `node:26.13.1-alpine` mit festem sha256-Digest auf. Vorlage für alle Variablen: [`apps/worker/.env.example`](apps/worker/.env.example). Als `.env` ins Wurzelverzeichnis kopiert, wird sie von `docker compose` gelesen.

### Umgebungsvariablen

| Variable | Pflicht | Bedeutung |
| :--- | :--- | :--- |
| `SESSION_SALT_SECRET` | ja | Salz für Sitzungs-Hashes, mindestens 32 Zeichen. Fehlt es, startet der Server nicht. |
| `KEK_V1` (oder `BYOK_MASTER_KEY`) | ja | Schlüssel für gespeicherte API-Schlüssel, mindestens 32 Zeichen. Zum Wechseln `KEK_V2` ergänzen und `KEK_CURRENT_VERSION=2` setzen. |
| `TURNSTILE_SECRET_KEY` | empfohlen | Server-Secret von Cloudflare Turnstile. Ohne dieses Secret startet der Server mit einer Warnung, Gastzugang und Magic-Link antworten aber mit `503 TURNSTILE_NOT_CONFIGURED`. |
| `VITE_TURNSTILE_SITE_KEY` | empfohlen | Öffentlicher Site-Key für das Widget. Er wird beim Bauen in die Web-App geschrieben und ist deshalb ein **Build-Argument** (`docker build --build-arg`, in Compose unter `build.args`), keine Laufzeitvariable. |
| `APP_ORIGIN` | nein | Öffentliche Adresse ohne Pfad, z. B. `https://notes.example.org`. Standard: `http://localhost:<PORT>`. |
| `APP_PROFILE` | nein | `demo` (Standard) oder `full`. |
| `PORT`, `DATA_DIR`, `STATIC_DIR` | nein | Port (Standard `8787`), Datenordner (Standard `.data`, im Image `/app/.data`) und Ordner der Web-App. |
| `TRUSTED_PROXY_HEADER` | nein | Nur hinter einem Reverse Proxy, siehe Abschnitt 4 im Schnellstart. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM` | nein | Mailversand per SMTP. Standard ist Port 587 mit Pflicht zu STARTTLS, Port 465 nutzt TLS direkt. Ist SMTP gesetzt, bleibt Resend ungenutzt. |
| `RESEND_API_KEY`, `MAIL_FROM` | nein | Mailversand über Resend, wenn kein SMTP gesetzt ist. Ohne Mailversand kommen keine Magic-Link-Mails an. |
| `CLEANUP_INTERVAL_MINUTES` | nein | Aufräumlauf im Server, Standard `60` wie der Cron `0 * * * *` auf Cloudflare. `0` schaltet ihn ab; dann führt ein externer Cron `node apps/worker/dist/node-server.js cleanup` aus. |
| `DEMO_GEMINI_KEY` | nein | Schlüssel für das Demo-Profil. |

**Turnstile-Testschlüssel, nur für Entwicklung und Tests:** Site-Key `1x00000000000000000000AA` und Secret `1x0000000000000000000000000000000AA`. Beide bestehen immer und schützen deshalb vor keinem Bot. Für den echten Betrieb legen Sie im Cloudflare-Dashboard ein eigenes Turnstile-Widget an. Läuft das Test-Secret auf einer `https`-Adresse, warnt der Server beim Start.

**Abweichung von „vollständig unabhängig von Cloudflare“:** Auf Node bleibt Turnstile vor Gastzugang und Magic-Link eingeschaltet. Das hat der Inhaber so entschieden, damit beide Laufzeiten gleich gut gegen Bots geschützt sind. Der Node-Betrieb braucht deshalb ein kostenloses Turnstile-Widget von Cloudflare und ausgehende Verbindungen zu `challenges.cloudflare.com`. Ohne Secret bleibt die Anmeldung gesperrt; es gibt keinen Rückfall auf „ohne Prüfung“. Alles andere läuft auf Node ohne Cloudflare: Datenbank, Speicher, Durable Objects, Cron und Mail.

### Grenzen der Node-Laufzeit

- Ein Prozess je Datenordner. Durable Objects und Rate-Limits liegen im Prozess, mehrere Instanzen auf demselben `DATA_DIR` sind nicht vorgesehen.
- Keine WebSocket-Hibernation: `getWebSockets()` liefert eine leere Liste.
- `dump()` der D1-Schnittstelle gibt es nicht. Gesichert wird über die Dateien (siehe unten).

### Sichern

Alle Daten liegen in `DATA_DIR` (Compose-Volume `app-data`, im Container `/app/.data`):
- `local.sqlite` ist die Datenbank (WAL-Modus, also auch `-wal` und `-shm`).
- `media/`, `media-meta/` enthalten die hochgeladenen Dateien.
- `do/` enthält die SQLite-Dateien der Durable Objects.

```bash
# Konsistente Sicherung: kurz anhalten, Volume als Archiv sichern, wieder starten
docker compose stop app
docker run --rm -v notebook-lm-klon_app-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/relationnotes-$(date +%F).tar.gz -C /data .
docker compose start app
```

Den Volume-Namen zeigt `docker volume ls`. Wiederherstellen: Container anhalten, das Archiv in ein leeres Volume entpacken (`tar xzf … -C /data`), Container starten. Die Secrets (`SESSION_SALT_SECRET`, `KEK_*`) gehören getrennt von der Sicherung an einen sicheren Ort. Ohne den passenden KEK lassen sich gespeicherte API-Schlüssel nicht mehr entschlüsseln.

### Aktualisieren

```bash
git pull
docker compose build --pull
docker compose up -d
curl http://localhost:8787/api/v1/health
```

Vorher sichern. Neue Migrationen aus `apps/worker/migrations` spielt der Server beim Start selbst ein; die Buchführung steht in der Tabelle `d1_migrations`. Ist der Healthcheck nicht grün (`docker compose ps`), zeigt `docker compose logs app` den Grund, etwa fehlende Pflicht-Secrets.

---

## Running with Node.js and Docker (English)

RelationNotes also runs without Cloudflare: one Node process serves the web app and the API on one port (default `8787`). D1 becomes SQLite (`node:sqlite`) and R2 becomes files on disk. `NotebookDO` and `JobDO` run as the real classes in the process, and the hourly cron runs as a schedule inside the server. CI runs on Node 26 LTS. It verifies the Docker image with its health check, runs the same smoke check against `wrangler dev` and against Node, and runs Playwright against the Node build.

### Start

```bash
# Docker (recommended): set secrets, build, start
export SESSION_SALT_SECRET=$(openssl rand -hex 32) KEK_V1=$(openssl rand -hex 32)
export TURNSTILE_SECRET_KEY=<your secret> VITE_TURNSTILE_SITE_KEY=<your site key>
docker compose up -d --build
curl http://localhost:8787/api/v1/health

# Without Docker (Node >= 26): build and start the bundle
pnpm install --frozen-lockfile && pnpm build
SESSION_SALT_SECRET=… KEK_V1=… node apps/worker/dist/node-server.js
```

`pnpm build` produces `apps/worker/dist/node-server.js`, with all dependencies bundled. The runtime image (`apps/worker/Dockerfile`) therefore holds only that bundle, the migrations and `apps/web/dist`. It has no `node_modules`, no sources and no `tsx`, runs as user `node` and is based on `node:26.13.1-alpine` pinned by sha256 digest. Template for all variables: [`apps/worker/.env.example`](apps/worker/.env.example). Copied to `.env` in the repository root, `docker compose` reads it.

### Environment variables

| Variable | Required | Meaning |
| :--- | :--- | :--- |
| `SESSION_SALT_SECRET` | yes | Salt for session hashes, at least 32 characters. If it is missing, the server does not start. |
| `KEK_V1` (or `BYOK_MASTER_KEY`) | yes | Key for stored API keys, at least 32 characters. To rotate, add `KEK_V2` and set `KEK_CURRENT_VERSION=2`. |
| `TURNSTILE_SECRET_KEY` | recommended | Cloudflare Turnstile server secret. Without it the server starts with a warning, but guest login and magic link answer `503 TURNSTILE_NOT_CONFIGURED`. |
| `VITE_TURNSTILE_SITE_KEY` | recommended | Public site key for the widget. It is written into the web app at build time, so it is a **build argument** (`docker build --build-arg`, in Compose under `build.args`), not a runtime variable. |
| `APP_ORIGIN` | no | Public address without a path, e.g. `https://notes.example.org`. Default: `http://localhost:<PORT>`. |
| `APP_PROFILE` | no | `demo` (default) or `full`. |
| `PORT`, `DATA_DIR`, `STATIC_DIR` | no | Port (default `8787`), data directory (default `.data`, `/app/.data` in the image) and web app directory. |
| `TRUSTED_PROXY_HEADER` | no | Only behind a reverse proxy, see section 4 of the quick start. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM` | no | Mail via SMTP. Default is port 587 with mandatory STARTTLS; port 465 uses TLS directly. When SMTP is set, Resend is not used. |
| `RESEND_API_KEY`, `MAIL_FROM` | no | Mail via Resend when SMTP is not set. Without mail delivery, magic-link mails do not arrive. |
| `CLEANUP_INTERVAL_MINUTES` | no | Cleanup inside the server, default `60` like the Cloudflare cron `0 * * * *`. `0` turns it off; an external cron then runs `node apps/worker/dist/node-server.js cleanup`. |
| `DEMO_GEMINI_KEY` | no | Key for the demo profile. |

**Turnstile test keys, for development and tests only:** site key `1x00000000000000000000AA` and secret `1x0000000000000000000000000000000AA`. Both always pass, so they protect against no bot at all. For real operation, create your own Turnstile widget in the Cloudflare dashboard. If the test secret runs on an `https` address, the server warns at start.

**Deviation from "fully independent of Cloudflare":** on Node, Turnstile stays switched on in front of guest login and magic link. The owner decided this so that both runtimes are equally protected against bots. Running on Node therefore needs a free Cloudflare Turnstile widget and outbound connections to `challenges.cloudflare.com`. Without the secret, sign-in stays blocked; there is no fallback to "no check". Everything else runs on Node without Cloudflare: database, storage, Durable Objects, cron and mail.

### Limits of the Node runtime

- One process per data directory. Durable Objects and rate limits live in the process; several instances on the same `DATA_DIR` are not supported.
- No WebSocket hibernation: `getWebSockets()` returns an empty list.
- The D1 `dump()` call does not exist. Back up the files instead (see below).

### Backup

All data lives in `DATA_DIR` (Compose volume `app-data`, `/app/.data` in the container):
- `local.sqlite` is the database (WAL mode, so also `-wal` and `-shm`).
- `media/` and `media-meta/` hold the uploaded files.
- `do/` holds the SQLite files of the Durable Objects.

```bash
# Consistent backup: stop briefly, archive the volume, start again
docker compose stop app
docker run --rm -v notebook-lm-klon_app-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/relationnotes-$(date +%F).tar.gz -C /data .
docker compose start app
```

`docker volume ls` shows the volume name. To restore: stop the container, unpack the archive into an empty volume (`tar xzf … -C /data`), start the container. Keep the secrets (`SESSION_SALT_SECRET`, `KEK_*`) in a safe place, separate from the backup. Without the matching KEK, stored API keys cannot be decrypted.

### Update

```bash
git pull
docker compose build --pull
docker compose up -d
curl http://localhost:8787/api/v1/health
```

Back up first. The server applies new migrations from `apps/worker/migrations` itself at start; the record is kept in the table `d1_migrations`. If the health check is not green (`docker compose ps`), `docker compose logs app` shows the reason, for example missing mandatory secrets.

---

## Saubere Repository-Struktur (Entscheidung #108)

Alle Community-, Sicherheits- und Automatisierungs-Konfigurationen sind im Ordner [`.github/`](.github/) gebündelt, sodass das Hauptverzeichnis übersichtlich auf die technisch notwendigen Projektdateien fokussiert bleibt:

```text
Notebook-LM-Klon/
├── .github/                        # Governance, Security, CI/CD & Templates
│   ├── workflows/                  # SHA-gepinnte Workflows (ci, codeql, scorecard, deploy, release, verify-issue-checklists, wiki-sync)
│   ├── ISSUE_TEMPLATE/             # Strukturierte Formulare (Bug, Feature, Security, Config)
│   ├── CITATION.cff                # Wissenschaftliche Zitier-Metadaten
│   ├── CODE_OF_CONDUCT.md          # Contributor Covenant v2.1
│   ├── CODEOWNERS                  # Verbindliche Code-Verantwortlichkeiten (@VectoDE)
│   ├── CONTRIBUTING.md             # 1 Issue = 1 Branch = 1 PR, 100 % TDD & Qualitätsregeln
│   ├── FUNDING.yml                 # Sponsoring-Metadaten
│   ├── PULL_REQUEST_TEMPLATE.md    # Verbindliche Abnahme-Checkliste
│   ├── SECURITY.md                 # Coordinated Vulnerability Disclosure & Kryptografie-Architektur
│   ├── SUPPORT.md                  # Support- & Diskussionskanäle
│   ├── dependabot.yml              # Wöchentliche Abhängigkeits-Checks
│   ├── gitleaks.toml               # Secret-Scanner-Konfiguration
│   ├── release.yml                 # Kategorisierte Release-Notes-Generierung
│   └── renovate.json               # Automatisches SHA-Digest-Pinning
├── apps/
│   ├── web/                        # React 19 + Vite 8 Frontend (Warm Editorial Research Studio, WCAG 2.2 AAA)
│   └── worker/                     # Cloudflare Worker (Hono API, D1 FTS5, R2, NotebookDO & JobDO)
├── packages/
│   └── shared/                     # Geteilte Zod-Schemata, RFC 9457 Problem Details, UTF-8/Encoding-Prüfer
├── docs/                           # 9 Fachkapitel + 5 SVG-Architekturdiagramme + GitHub-Wiki-Quellen
│   ├── assets/                     # Diagramme und Hero je Deutsch (-de), Englisch (-en) und automatisch (systemLanguage); Quellen in src/, Texte in i18n/strings.json
│   └── wiki/                       # 1:1 synchronisierte GitHub-Wiki-Seiten (Home, _Sidebar, _Footer, Kapitel 1–8)
├── biome.json                      # Linter, Formatter & 29 WAI-ARIA A11y-Regeln
├── CHANGELOG.md                    # Versionshistorie nach Keep a Changelog
├── LICENSE                         # MIT License
├── package.json                    # Monorepo-Skripte & Root-Konfiguration
├── pnpm-workspace.yaml             # Workspace-Definition (packages/*, apps/*)
├── tsconfig.base.json              # Strikte TypeScript-Basis-Konfiguration
└── vitest.config.ts                # Test-Runner mit 100 % Coverage-Schwellenwerten
```

---

## Vollständiges Projekthandbuch & GitHub Wiki

Sämtliche Architekturentscheidungen (ADRs #1–#110) sind im Ordner [`docs/`](docs/) sowie im [offiziellen GitHub Wiki](https://github.com/VectoDE/Notebook-LM-Klon/wiki) dokumentiert:

1. [**Systemarchitektur & Edge-Runtime**](docs/architecture.md) – Single-Worker-Topologie, `NotebookDO` vs. `JobDO`, `demo`- vs. `full`-Profile.
2. [**Hybrid-RAG & Int8-Vektorsuche**](docs/rag-and-vectors.md) – SQLite `FTS5` (`bm25`), Matryoshka `int8`-Quantisierung und Reciprocal Rank Fusion (`k = 60`).
3. [**RelationFlow-Wissensgraph-Integration**](docs/relationflow-integration.md) – Kanonisches Austauschformat `relationflow/export/v1` und bidirektionale Synchronisation.
4. [**Datenbank-Schema (Cloudflare D1)**](docs/database-schema.md) – Alle 17 Tabellen, Trigger, Indizes und kaskadierende Löschpfade.
5. [**Security, DSGVO & EU AI Act**](docs/security-and-compliance.md) – WebAuthn Passkeys, AES-256-GCM BYOK, SSRF-Guard und Artikel-50-Provenienz.
6. [**Barrierefreiheit nach WCAG 2.2 Level AAA**](docs/accessibility-wcag-aaa.md) – Farbkontraste (`>= 7:1`), Fokus-Ringe, Tastatursteuerung und multimodale Alternativen.
7. [**Cloudflare Free-Tier-Limits & CPU-Budgets**](docs/platform-limits.md) – Empirische Benchmarks (`< 0,6 ms` WebCrypto) und Kapazitätsrechnung.
8. [**Loom-Präsentations- & Bewerbungs-Leitfaden**](docs/loom-presentation-guide.md) – Drehbuch für eine überzeugende 10-Minuten-Vorführung.
9. [**Anforderungs- & Entscheidungsregister (ADRs #1–#110)**](docs/anforderungen.md) – Lückenlose Dokumentation aller 110 Architektur- und Qualitätsentscheidungen.
10. [**Lasttests (k6, lokal und Live-Rauchtest)**](docs/load-test.md) – 200 gleichzeitige simulierte Nutzer mit Upload, Chat, Suche und Studio, p95 249 ms, 0 % Fehler; [HTML-Report](docs/load-test/report-local.html) und [JSON](docs/load-test/summary-local.json).
11. [**Datenschutz je KI-Modell**](docs/datenschutz-modelle.md) – Training mit Eingaben je Anbieter und Zugangsweg, mit Quellen, Wortlaut und Abrufdatum.

---

## Mitwirken, Engineering-Methodik & Lizenz

- **Engineering-Methodik & Transparenz:** Dieses Projekt wird nach strengem Software-Engineering-Maßstab entwickelt: Spezifikationsgetriebene Architektur (110 dokumentierte ADRs), striktes `1 Issue = 1 Branch = 1 PR`-Vorgehen mit Echtzeit-Checklisten-Verifikation, **100 % automatisierte Testabdeckung** (Unit, Integration, Contract, Property-Based Fuzzing, Security, A11y) sowie **OpenSSF-Härtung**. Moderne KI-Entwicklungswerkzeuge werden als Produktivitätsmultiplikator unter menschlicher Architekturhoheit eingesetzt; jede Zeile Code durchläuft deterministische Typ-, Linter-, Security- und Test-Gates.
- **Beitragsrichtlinien:** Siehe [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) und [`.github/CODE_OF_CONDUCT.md`](.github/CODE_OF_CONDUCT.md).
- **Sicherheitsmeldungen:** Bitte nutze für Schwachstellenmeldungen ausschließlich unser [Private Vulnerability Reporting](https://github.com/VectoDE/Notebook-LM-Klon/security/advisories/new) gemäß [`.github/SECURITY.md`](.github/SECURITY.md).
- **Lizenz:** Veröffentlicht unter der [MIT-Lizenz](LICENSE). Copyright (c) 2026 Tim Hauke.
- **Schriften (SIL Open Font License 1.1):** Die Web-App liefert alle Schriften selbst gehostet aus (kein externes CDN), je Design eine eigene: Pure Inter, Editorial Calm Source Serif 4, Immersive Cinema Space Grotesk, Fusion Geist, dazu JetBrains Mono für Zeitstempel. Lizenztexte: [Inter](apps/web/public/fonts/LICENSES/Inter-OFL.txt), [Source Serif 4](apps/web/public/fonts/LICENSES/SourceSerif4-OFL.txt), [Space Grotesk](apps/web/public/fonts/LICENSES/SpaceGrotesk-OFL.txt), [Geist](apps/web/public/fonts/LICENSES/Geist-OFL.txt), [JetBrains Mono](apps/web/public/fonts/LICENSES/JetBrainsMono-OFL.txt). Im Build liegen sie unter `/fonts/LICENSES/`. Die Dateien selbst (WOFF2, Latin-Subset für Deutsch und Englisch, variabel über die Strichstärke, zusammen rund 190 KB; der Browser lädt nur, was das aktive Design anzeigt, im Standard-Design Pure Inter und JetBrains Mono mit 87 KB) liegen mit Herkunft und SHA-256-Prüfsummen in [`apps/web/src/fonts/`](apps/web/src/fonts/SOURCES.txt).
