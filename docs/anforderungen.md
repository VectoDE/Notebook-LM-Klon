# RelationNotes (Notebook-LM-Klon): Anforderungen und Entscheidungen (ADR #1–#110)

Stand: 2026-11-09 · Vollständiges Entscheidungsprotokoll

## Ursprünglicher Auftrag
Notebook-LM-Klon mit Frontend, Backend und Datenbank. Alle Richtlinien und Gesetze einhalten, maximal performant, maximal sicher, skalierbar, beste Barrierefreiheit in jeder Form.

## Entscheidungen (Runde 1)
| # | Thema | Entscheidung |
|---|---|---|
| 1 | Zweck | Bewerbungsprojekt, vollständig (Frontend, Backend, DB, alles Nötige) |
| 2 | Funktionsumfang | Volle Parität: Quellen, Chat mit Zitaten, Zusammenfassungen, Audio-Overview, Mindmaps, Lernkarten, Quiz, Video-Overview |
| 3 | LLM | Provider-Abstraktion: Gemini API und Ollama |
| 4 | Hosting | Cloudflare, **ein einziger Worker**, **eine Datenbank**, **ein Medienspeicher** |
| 5 | Recht | EU/DE: DSGVO, EU AI Act, BFSG/EAA, TTDSG/TDDDG, DDG |
| 6 | Barrierefreiheit | WCAG 2.2 AAA wo möglich, mindestens AA (EN 301 549) |

## Entscheidungen (Runde 2)
| # | Thema | Entscheidung |
|---|---|---|
| 7 | Vektorsuche | In D1 (eigene Tabelle), kein Vectorize. D1 = einzige DB, R2 = einziger Medienspeicher |
| 8 | API-Keys | Gemini nur BYOK (Nutzer-Key, verschlüsselt), Ollama als Datenschutz-Modus, Hinweis auf Free-Tier-Training |
| 9 | Audio/Video | Audio per Gemini-TTS; Video-Overview = Folien + Audio, im Browser gerendert |
| 10 | Auth | Mehrbenutzer, Passkeys + E-Mail-Magic-Link, Notebooks teilbar |
| 11 | Stack | React + TypeScript (Vite) als Worker-Static-Assets, Backend Hono |
| 12 | Sprachen | Deutsch + Englisch |
| 13 | Notizen | Im Repository unter `docs/` dokumentiert |

## Entscheidungen (Runde 3)
| # | Thema | Entscheidung |
|---|---|---|
| 14 | E-Mail | Cloudflare Email Sending + optionaler Free-Adapter |
| 15 | Quelltypen | Alles: PDF, TXT, MD, DOCX, URL, Text, YouTube, Audio, Bilder (OCR), Google-Docs-Import |
| 16 | Limits | 50 Quellen/Notebook, 50 MB je Datei, 200 MB je Notebook, 500.000 Wörter/Quelle, Kontingente pro Nutzer (siehe Hinweis unten) |
| 17 | Teilen | Echtzeit-Kollaboration über Durable Objects |
| 18 | Hintergrundjobs | Durable Object + Job-Queue im selben Worker, nur Laufzeitzustand |
| 19 | Tests | Vitest, Playwright, axe-core, Lighthouse CI, ≥ 90 % Abdeckung |
| 20 | Veröffentlichung | Öffentliches GitHub-Repo, CI/CD, OpenSSF Scorecard + Best Practices, signierte Releases, Demo auf `workers.dev` |

> **Hinweis zu #16 (Entscheidung des Inhabers, 2026-11-11):** Die ursprüngliche Vorgabe „200 MB je Quelle“ wird durch zwei Grenzen ersetzt: **50 MB je Datei** und **200 MB je Notebook** (Summe aller Quellen). Die Grenzen gelten in den Profilen `demo` und `full`. Das Demo-Profil erlaubt ebenfalls 50 Quellen je Notebook (vorher 15). Das Wortlimit von 500.000 Wörtern je Quelle bleibt unverändert.

## Entscheidungen (Runde 4)
| # | Thema | Entscheidung |
|---|---|---|
| 21 | Plan | Code für Free und Paid ausgelegt, Demo läuft auf Free |
| 22 | Parsing | Im Browser (Web Worker): Parsing, OCR mit Tesseract.js, Chunking; Embeddings via Gemini/Ollama; Worker speichert nur |
| 23 | Upload | Direkt nach R2 per presigned Multipart-URL bzw. Streaming-Fallback |
| 24 | D1-Limit | Demo-Kontingente (z. B. 3 Notebooks/Nutzer, Löschung nach 30 Tagen), Vollausbau per Konfiguration |
| 25 | Google Docs | Google Picker + OAuth, Scope `drive.file` |
| 26 | Lizenz | MIT |
| 27 | Rechtstexte | Impressum und Datenschutz als Entwurf, Hinweis auf anwaltliche Prüfung |

## Entscheidungen (Runde 5)
| # | Thema | Entscheidung |
|---|---|---|
| 28 | Ollama | Beides konfigurierbar: lokal im Browser (`localhost`/CORS) und Server via Cloudflare Tunnel + Access |
| 29 | Design | 4 umschaltbare High-Craft-Designrichtungen |
| 30 | Offline | Volle Offline-Fähigkeit inkl. Ollama-Chat (PWA) |
| 31 | Medien-a11y | Transkripte, WebVTT, Audiodeskription, Mindmap als Baumliste, Leichte Sprache |
| 32 | AI Act | Sichtbare + maschinenlesbare Kennzeichnung, Missbrauchsmeldung, Safety-Filter |
| 33 | DSGVO | Export, Löschung, Audit-Log, Session-Cookie + Cloudflare Web Analytics (cookielos) |
| 34 | Repo | Repository `github.com/VectoDE/Notebook-LM-Klon` |

## Kontext Bewerbung
- Testaufgabe Everlast Consulting GmbH, Stelle Junior Entwickler (Vollzeit), Full Stack.
- Abgabe: GitHub-Repo-Link, Live-Deployment, Loom-Video max. 10 Min. (Vorgehen erklären, Klon live testen).
- Schwerpunkt-Hinweis: „Beschäftige dich bitte mit RelationFlow.“

## Entscheidungen (Runde 6)
| # | Thema | Entscheidung |
|---|---|---|
| 35 | Frist | Ziel 7–10 Tage |
| 36 | Priorisierung | Gestaffelt: Kern (Quellen, Chat mit Zitaten, Audio-Overview, Studio-Werkzeuge, a11y, Sicherheit) zuerst live, Erweiterungen in Phasen 2–4 |
| 37 | RelationFlow | Recherche und gezielte architektonische Einbindung |
| 38 | KI-Doku | README dokumentiert Vorgehen und KI-Einsatz transparent; Commits und PRs ohne KI-Kennzeichnung |
| 39 | Abgabe | Loom-Leitfaden + Antwort-E-Mail-Entwurf vorbereitet |

## Entscheidungen (Runde 7)
| # | Thema | Entscheidung |
|---|---|---|
| 40 | RelationFlow | Konzept anlehnen: Workspaces mit Rollen, Modellwahl inkl. „Auto“, Datenschutz-Hinweise, README „Andocken an RelationFlow“, RAG als eigenständige API |
| 41 | Provider | Zusätzlich OpenAI + Claude als BYOK-Adapter; Gemini + Ollama Standard |
| 42 | Offline | Phase 1: PWA Offline-Lesen; Phase 2: Ollama-Chat offline |
| 43 | Git-Workflow | **Nie direkt auf `main` arbeiten:** Pro GitHub-Issue ein eigener Feature-Branch, eigenes Pull Request gegen `main`, CI-Checks grün, Review/Prüfung und dann Merge nach `main` |
| 44 | Impressum | Datenschutzfreundliche Bereitstellung über Worker-Umgebungsvariablen |

## Impressum & Datenschutz-Schutz (Runde 8 & Entscheidung #59)
- Im öffentlichen GitHub-Repository stehen **keine privaten Wohnadressdaten**.
- Die Impressumsdaten (`IMPRINT_NAME`, `IMPRINT_STREET`, `IMPRINT_CITY`, `IMPRINT_EMAIL`) werden im Live-Deployment ausschließlich über Cloudflare-Worker-Umgebungsvariablen über `/api/v1/legal/imprint` injiziert; als zweiter schneller Kontaktweg dient das Turnstile-geschützte Kontaktformular (`/api/v1/contact`).
- Rechtsstatus: Nicht-kommerzielles Bewerbungsprojekt.

## Entscheidungen (Runde 9)
| # | Thema | Entscheidung |
|---|---|---|
| 45 | Demo | Beispiel-Notebook mit vorab generierten Inhalten + zentraler Gemini-Free-Key nur für Demo-Chat, streng rate-limitiert, Hinweis auf keine vertraulichen Daten |
| 46 | Gastzugang | Gast-Login ohne Registrierung, Daten nach 24 h gelöscht |
| 47 | Adresse | `workers.dev`-Subdomain |
| 48 | Cloudflare | Bereitstellung über `wrangler` |
| 49 | Bot-Schutz | Turnstile auf Login, Gast, Kontaktformular |

## Entscheidungen (Runde 10)
| # | Thema | Entscheidung |
|---|---|---|
| 50 | Struktur | `pnpm`-Monorepo: `apps/web`, `apps/worker`, `packages/shared`; ein Worker-Deployment |
| 51 | Updates | Renovate, gepinnte Versionen, SHA-gepinnte Actions |
| 52 | CI/CD | Actions: Lint, Typecheck, Tests, a11y, Lighthouse, CodeQL, gitleaks, osv-scanner, Deploy auf `main` |
| 53 | Lint | Biome |
| 54 | Planung | Designentwürfe + Umsetzungsplan vor Code-Umsetzung |

## Entscheidungen (Runde 11)
| # | Thema | Entscheidung |
|---|---|---|
| 55 | Design-Richtungen | 4 eigenständige High-Craft-Richtungen ohne generischen KI-Look: (1) nah am echten Google NotebookLM, (2) mit 60-fps Motion / Aurora-Orb / Apple-Music-Lyrics, (3) Editorial Calm (warmes Papier-Finish), (4) Fusion |
| 56 | E-Mail / Magic-Link | Cloudflare Email Sending + zusätzlich optionaler Resend/Brevo-Free-Adapter (aktiv, sobald API-Key gesetzt ist) |
| 57 | R2-Uploads | Beides: S3-Presigned-URL (falls Credentials gesetzt) + automatischer Fallback auf gestreamten Multipart-Upload über R2-Worker-Binding |
| 58 | Vektorsuche | 768 Dimensionen, `int8`-Quantisierung in D1 + Hybrid-Suche (Vektor-Scoring im Durable Object + `FTS5` in D1 via RRF) |
| 59 | Impressum-Schutz | Im öffentlichen GitHub-Repo Platzhalter; echte Adresse nur über Worker-Umgebungsvariablen im Live-Deployment injizieren |
| 60 | Vorgehen | Vollständige Klärung aller Fragen vor der Implementierung |

## Entscheidungen (Runde 12)
| # | Thema | Entscheidung |
|---|---|---|
| 61 | Echtzeit & Workspaces | Direkt in Phase 1: Live-Präsenz + Echtzeit-Sync via `NotebookDO` (WebSockets) UND sichtbarer Workspace-/Rollen-Umschalter (RelationFlow-Bezug) |
| 62 | Studio-Werkzeuge Phase 1 | Alle 6 Studio-Werkzeuge schon in Phase 1 funktionsfähig: Audio-Overview, Video-Overview (Folien+Audio), interaktive SVG-Mindmap, Lernkarten, Quiz mit Erklärung, Briefing/FAQ |
| 63 | Demo-Inhalte | Vorbereiteter „RelationFlow & KI im Mittelstand“-Demo-Workspace + zweites technisches Demo-Notebook |
| 64 | Google-Docs-Import | In Phase 1 „1-Klick Import per öffentlichem Google-Docs-Link“ (ohne OAuth-Sperre sofort nutzbar) + zusätzlicher OAuth-Picker für angemeldete Testnutzer |
| 65 | Audio-Overview-Technik | Echter Multi-Speaker-Audio-Stream via Gemini Native Audio TTS (wenn Key vorhanden) + vorgeneriertes Zwei-Sprecher-Audio im Demo-Notebook (Piper/Gemini) + Web-Speech-Fallback offline |
| 66 | GitHub-Projektmanagement | GitHub Project (Kanban) + Meilensteine (Phase 1–4) + detaillierte Issues + Discussions im Repo `VectoDE/Notebook-LM-Klon` |

## Entscheidungen (Runde 13)
| # | Thema | Entscheidung |
|---|---|---|
| 67 | Video-Overview-Player & Export | Interaktiver In-App-Canvas/Folien-Player (mit Kapitel-Sprung & Untertiteln) + 1-Klick-Export als `.webm`/`.mp4` im Browser (`MediaRecorder` / WebCodecs) |
| 68 | Interactive Audio Host Mode | Live-Rückfragen während des Audio-Overviews („Beitreten / Fragen“ per Mikrofon oder Text, Hosts antworten kontextbezogen per TTS) |
| 69 | Demo-Audio-Produktion | Vorgeneriertes deutsches Zwei-Sprecher-Demo-Audio für das „RelationFlow & KI im Mittelstand“-Demo-Notebook lokal mit Piper TTS + `ffmpeg` (echte Audiodatei + WebVTT-Wort-Zeitstempel) |
| 70 | Artefakt-Exporte | Mindmap als SVG/PNG/JSON, Lernkarten als Anki-CSV/JSON, Briefing/Zusammenfassungen als Markdown/PDF |
| 71 | OpenSSF & Branch-Protection | Branch-Protection auf `main` aktivieren (PR Pflicht, Status-Checks Pflicht, Linear History), jedes Issue als eigener Branch + Pull Request nach `main` |

## Entscheidungen (Runde 14 – Git & PR-Prozess)
| # | Thema | Entscheidung |
|---|---|---|
| 72 | Merge-Strategie | Squash & Merge: 1 Haupt-Issue = 1 PR = 1 sauberer Conventional Commit auf `main` |
| 73 | PR-Reviews | Unabhängige Qualitätsprüfung jedes PRs gegen `qualitaetsstandard`, Tests und Sicherheit; Merge nach grüner Prüfung |
| 74 | Sprache Git/PRs | Englische Conventional Commits (`feat(scope): ...`) + deutsche/zweisprachige Issue- und PR-Beschreibungen (ohne jegliche KI-Kennzeichnung) |
| 75 | Issue-Granularität | 44 Haupt-Issues + 132 native GitHub Sub-Issues = 176 Issues gesamt |
| 76 | Push/Merge-Freigabe | Freigabe für den PR-Zyklus (Branches pushen, PRs erstellen, nach grüner Prüfung mergen); separate Bestätigung vor Live-Deploy auf Cloudflare und vor jedem Release |

## Entscheidungen (Runde 15 – Design-Klärung)
| # | Thema | Entscheidung |
|---|---|---|
| 77 | Vermeidung von Rahmen-Überladung | Große, saubere Flächen mit viel Weißraum statt verschachtelter Rahmen |
| 78 | Raumaufteilung | Ruhiger Header, darunter 3 große, weiche Panels (`24px` Radius) auf sanftem Hintergrund, unten im Chat eine schwebende Pill-Eingabeleiste, im Studio 6 aufgeräumte Werkzeug-Karten + Audio-Overview-Player mit 2 Sprechern |
| 79 | Film-/Animations-Modus | Filmische „Deep-Dive-Player-Ansicht“: Beim Klick auf „Audio- oder Video-Overview abspielen“ fährt eine weich animierte Ambient-Film-Bühne auf – mit mitscrollenden Sätzen, organischen Audio-Lichtwellen (Canvas-Orb) und sanften Kamerafahrten über Dokument-Highlights |
| 80 | Entschlackung | Alle Compliance-/Rechts-/Technik-Infos (AI Act, Modellwahl, DSGVO, Kontrast-Modus) in ein Einstellungs-Menü / Footer-Modal verlagern; Hauptoberfläche aufgeräumt (dezenter „KI-generiert“-Hinweis unter Antworten) |
| 81 | Design-Präsentation | Animierte Video-/WebM-Aufnahmen (60 fps) + lokaler Dev-Server + Screenshots |
| 82 | Farb-Grundstimmung | Gleichwertiger heller Light-Mode (`#F8FAFD` Canvas mit `#FFFFFF` Panels) UND tiefer OLED-Dark-Mode (`#131314`) + AAA-Hochkontrast-Modus |

## Entscheidungen (Runde 16 – Finale Design-Freigabe & Doku-Architektur)
| # | Thema | Entscheidung |
|---|---|---|
| 83 | 4 umschaltbare Design-Stile | Die App bietet **alle 4 Designs live umschaltbar** (jeweils in Hell, Dunkel und Hochkontrast):<br>1. **„Pure NotebookLM“** (Google Material 3 Airy Workspace)<br>2. **„Immersive Cinema“** (60-fps Aurora-Orb, mitscrollende Lyrics & Video-Bühne)<br>3. **„Editorial Calm“** (Warmes Papier-Finish & schwebende Mindmap)<br>4. **„Fusion / All-in-One“** (Kombination aus allen dreien als Standard) |
| 84 | Startfreigabe | GitHub Project + 176 Issues angelegt und PR-Zyklus gestartet |
| 85 | Striktes UTF-8 / Kein Mojibake | **Null Toleranz für Zeichenkodierungsfehler (`U+FFFD` oder doppelt kodierte UTF-8-Sequenzen):** Alle Dateien, GitHub-Issues, PRs, Discussions, DB-Migrationen und HTTP-Header (`charset=utf-8`) verwenden strikt UTF-8 ohne BOM und werden automatisiert per Test (`encoding.test.ts`) geprüft |
| 86 | Issue-Qualität & Sub-Issues | 44 Haupt-Issues mit 132 nativen GitHub Sub-Issues (per GraphQL `addSubIssue` verknüpft). 1 Feature-Branch + 1 PR pro Haupt-Issue schließt das Haupt-Issue samt allen Unterissues via `Closes #...` |
| 87 | README.md auf Agentur-Niveau | Eigenes SVG-Hero-Banner, Badges, Architektur-Mermaid-Diagramm, Tech-Stack-Tabelle, Zielgruppen-Wegweiser (HR, Senior-Dev, Prüfer), RelationFlow-Andockkonzept, 1-Klick-Testing, lokales Setup, Recht/Datenschutz/a11y sowie transparente Dokumentation des Vorgehens |
| 88 | Visuelle Dokumentation & GitHub Wiki | Reich bebilderte Fachdokumentation unter `docs/` (inkl. SVG-Infografiken unter `docs/assets/` und Mermaid-Diagrammen) sowie 1:1-Synchronisation in das offizielle GitHub Wiki (`Home.md`, `_Sidebar.md`, Architektur, RAG, RelationFlow, Security, Datenbankschema, Plattform-Limits & Loom-Präsentationsleitfaden) |

## Entscheidungen (Runde 17 – Verifikations-Disziplin, Branding, Release-Taktung & 100 % Coverage)
| # | Thema | Entscheidung |
|---|---|---|
| 89 | Echtzeit-Meilenstein-Tracking | Laufende Pflege der 4 GitHub-Meilensteine und des Project Boards #13 synchron zum Entwicklungsfortschritt |
| 90 | Strikte Checkbox-Disziplin | **Niemals** ein Issue oder Sub-Issue schließen, solange im Body noch eine einzige offene Checkbox (`- [ ]`) steht; erst nach technischer Verifikation auf `- [x]` setzen |
| 91 | Atomare Sub-Issue-Commits | Jedes Haupt-Issue besteht aus 3 Sub-Issues (`a`, `b`, `c`), die jeweils als eigener sauberer englischer Conventional Commit (`type(scope): ... (#sub-nr)`) umgesetzt werden |
| 92 | Echtzeit-Verifikationskommentare | Unmittelbar nach jedem Sub-Issue-Commit wird das Sub-Issue auf GitHub abgehakt (`[x]`), mit Commit-SHA kommentiert und geschlossen sowie im Haupt-Issue abgehakt |
| 93 | Vollständige Repo-Konfiguration | Komplette Ausstattung mit Governance-, Security-, Template- und Automatisierungs-Dateien sowie Branch-Protection und Private Vulnerability Reporting |
| 94 | GitHub Wiki & Discussions | Vollständige 1:1-Synchronisation der 8 illustrierten Handbuch-Kapitel ins GitHub Wiki inkl. Sidebar/Footer und automatisiertem `.github/workflows/wiki-sync.yml` |
| 95 | Blockweise Umsetzung | Umsetzung in 9 klar abgegrenzten Themenblöcken (Block 1: Fundament, CI, OpenSSF, Doku & Wiki, Issues #1–#5 / #47–#61) |
| 96 | Offizielles Produkt-Branding | Der offizielle Produktname lautet **`RelationNotes`** mit dem Untertitel **`NotebookLM & RelationFlow Knowledge Studio`** |
| 97 | CI-Checklisten-Gate | Automatisierter Workflow `.github/workflows/verify-issue-checklists.yml` prüft bei jedem PR, dass alle referenzierten Sub-Issues 0 offene Checkboxen (`- [ ]`) haben |
| 98 | Keine KI-Kennzeichnung | Striktes Verbot jeglicher `Generated with ...`- oder `Co-Authored-By: ...`-Zeilen in Commits, PRs, Issues, Code und Dokumentation |
| 99 | Kostenlose Werkzeuge & Dienste | 100 % lauffähig im kostenlosen Cloudflare Free Tier (Workers, D1, R2, SQLite Durable Objects) und kostenlosen GitHub-Tarif |
| 100 | OpenSSF Best Practices | Maximal erreichbare Scorecard-Bewertung (SHA-Pinning, minimale Token-Permissions, SAST/CodeQL, OSV-Scanner, Gitleaks, Renovate, Security-Policy) |
| 101 | Barrierefreiheit ab Tag 1 | 29 verschärfte WAI-ARIA-/JSX-Regeln in `biome.json` sowie automatisierte WCAG-2.2-AAA-Kontrast- und Semantik-Tests ab Meilenstein 1 |
| 102 | Kein vorzeitiges Auto-Close | Keine `Closes #...`-Schlüsselwörter in PR-Beschreibungen verwenden, bevor nicht alle Checkboxen im Ziel-Issue verifiziert und auf `[x]` gesetzt sind |
| 103 | Kanonische Wiki-Struktur | 8 nummerierte deutsche Kapitel (`1-Systemarchitektur.md` bis `8-Loom-Praesentations-Leitfaden.md`) plus `Home.md`, `_Sidebar.md` und `_Footer.md` |
| 104 | Gestaffelte Releases | 6 semantische Releases (`v0.1.0`, `v0.2.0`, `v0.3.0`, `v0.4.0`, `v0.5.0`, `v1.0.0`) passend zum Projektfortschritt; `v0.1.0` nach Abschluss von Block 1 |
| 105 | Release `v0.1.0` nach Block 1 | Veröffentlichung von `v0.1.0` (`Foundation, CI, OpenSSF, Architecture Docs & Wiki`) direkt nach Merge von PR #5 und Abschluss aller 20 Block-1-Issues |
| 106 | Keine externen Kosten-Dienste | Keine kostenpflichtigen Drittanbieter-Vektordatenbanken oder Auth-SaaS; alles nativ über D1, R2, Durable Objects und WebCrypto |
| 107 | **100 % Code-Coverage & Alle Testarten ab Meilenstein 1** | `vitest.config.ts` erzwingt **`lines: 100, functions: 100, branches: 100, statements: 100`**; Unit-, Integrations-, Contract-, Property-Based/Fuzz- (`fast-check`), Security-, A11y-, Performance- und Encoding-Tests sind bereits in Block 1 aktiv |
| 108 | **Sauberes Root-Verzeichnis (`.github/`-Bündelung)** | Alle Community-, Governance- und Tool-Konfigurationsdateien (`SECURITY.md`, `SUPPORT.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CITATION.cff`, `CODEOWNERS`, `FUNDING.yml`, `PULL_REQUEST_TEMPLATE.md`, `ISSUE_TEMPLATE/*`, `dependabot.yml`, `renovate.json`, `release.yml`, `gitleaks.toml`) liegen sauber gebündelt unter **`.github/`** statt lose im Repository-Root |
| 109 | **Striktes Emoji-Verbot (Kein Emoji-KI-Slop)** | Keine Emojis (`/\p{Extended_Pictographic}/u`) in `README.md`, `CHANGELOG.md`, `docs/**`, `.github/**`, GitHub Wiki, Code, Tests, PRs, Issues oder Release-Notes. Stattdessen klare Typografie, Standard-Checklisten (`- [x]` / `- [ ]`) und im UI ausschließlich saubere SVG-Icons; automatisiert erzwungen durch `encoding.test.ts` |
| 110 | **Theme-adaptive Grafiken für Light & Dark Mode (`<picture>` + `-light.svg` / `-dark.svg`)** | Alle SVG-Architekturdiagramme und Banner unter `docs/assets/` enthalten eingebettete `@media (prefers-color-scheme: dark)`-Regeln UND liegen als dedizierte `*-light.svg`- und `*-dark.svg`-Varianten vor; in `README.md`, `docs/*.md` und im GitHub Wiki werden alle Grafiken über das `<picture>`-Element mit `prefers-color-scheme: dark` und `prefers-color-scheme: light` eingebunden und per Test (`encoding.test.ts`) verifiziert |

