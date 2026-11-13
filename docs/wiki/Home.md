# RelationNotes – NotebookLM & RelationFlow Knowledge Studio

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/hero-banner-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/hero-banner-light.svg">
  <img alt="RelationNotes Hero Banner" src="./assets/hero-banner-light.svg" width="100%">
</picture>
<sub>Grafik in <a href="./assets/hero-banner-de.svg" hreflang="de" lang="de">Deutsch</a> · <a href="./assets/hero-banner-en.svg" hreflang="en" lang="en">English</a></sub>

Willkommen im offiziellen technischen Projekthandbuch und Architektur-Wiki von **RelationNotes – NotebookLM & RelationFlow Knowledge Studio**.

Dieses Wiki dokumentiert die vollständige Systemarchitektur, die mathematischen Grundlagen der lokalen Hybrid-RAG-Engine, das bidirektionale Andock-Konzept an **RelationFlow** (Everlast Consulting GmbH), das 17-Tabellen-D1-Datenbankschema, unsere Defense-in-Depth-Sicherheitsarchitektur (DSGVO & EU AI Act Art. 50), die Barrierefreiheit nach **WCAG 2.2 Level AAA** sowie die empirisch gemessenen Cloudflare-Free-Tier-Budgets.

---

## Die 10 Kapitel des Projekthandbuchs

| Kapitel | Thema | Schwerpunkt |
| :--- | :--- | :--- |
| [**1. Systemarchitektur**](1-Systemarchitektur) | Single-Worker Edge-Design | Cloudflare Worker, Hono API, D1, R2, `NotebookDO` & `JobDO`, Browser-Ingest-Pipeline |
| [**2. Hybrid-RAG & Vektorsuche**](2-Hybrid-RAG-und-Vektorsuche) | `FTS5` + `int8`-Quantisierung + `RRF` | Symmetrische 8-Bit-Skalarquantisierung (75 % Speicherersparnis), `< 2 ms` Dot-Product im DO, Reciprocal Rank Fusion (`k = 60`) |
| [**3. RelationFlow-Integration**](3-RelationFlow-Integration) | Brücke zu RelationFlow (`relationflow.io`) | Team-Workspaces (`RBAC`), Multi-Modell-Auto-Router, dedizierte OpenAPI-RAG-Schnittstelle & Graph-Export (`relationflow/export/v1`) |
| [**4. Datenbank-Schema (D1)**](4-Datenbank-Schema-D1) | Relationale Modellierung & Indizes | Vollständiges ER-Diagramm (17 Tabellen), `ON DELETE CASCADE`, `FTS5`-Trigger und Index-Strategie für minimale `Rows read` |
| [**5. Security, DSGVO & AI Act**](5-Security-DSGVO-und-AI-Act) | Defense-in-Depth & EU-Rechtsrahmen | `AES-256-GCM` BYOK mit `AAD`, WebAuthn Passkeys (`ES256`), SSRF-Guard, DSGVO-1-Klick-Export/Löschung, EU AI Act Art. 50 |
| [**6. Barrierefreiheit (WCAG 2.2 AAA)**](6-Barrierefreiheit-WCAG-AAA) | Inklusive Forschungsoberfläche | Kontrastverhältnisse `>= 7:1`, `3 px` Fokus-Ringe, ARIA-Treegrid für Mindmaps, WebVTT-Synchron-Transkripte, reduzierte Bewegung |
| [**7. Cloudflare-Free-Limits**](7-Cloudflare-Free-Limits) | Empirische Benchmarks & Kontingente | Nachweis des 10-ms-CPU-Budgets (`< 0,6 ms` WebCrypto), `node:sqlite` FTS5-Probe, `demo`- vs. `full`-Profile |
| [**8. Loom-Präsentations-Leitfaden**](8-Loom-Praesentations-Leitfaden) | 10-Minuten-Walkthrough | Minutenplan und Sprechpunkte mit eingebetteten Architektur-Schaubildern für das Bewerbungs-Review |
| [**9. Lasttests**](9-Lasttests) | k6 lokal und Live-Rauchtest | 100 gleichzeitige simulierte Nutzer, p50/p95/p99, Fehlerquote, HTML- und JSON-Report |
| [**10. Datenschutz je KI-Modell**](10-Datenschutz-je-KI-Modell) | Training mit Eingaben | Angabe je Anbieter und Zugangsweg mit Quelle, Wortlaut und Abrufdatum; keine Rechtsberatung |
| [**11. Lokale Verschlüsselung**](11-Lokale-Verschluesselung) | IndexedDB mit AES-GCM | Schlüssel aus der Konto-Sitzung, nicht exportierbar; Abmelden löscht die lokale Datenbank nachweisbar |
| [**12. Offline-Synchronisation**](12-Offline-Synchronisation) | Yjs und Warteschlange | Offline bearbeiten, verschlüsselt puffern, bei Verbindung zusammenführen; sichtbarer Status DE/EN |
| [**13. Medienalternativen**](13-Medienalternativen) | WebVTT, Web Speech API | Untertitel, Transkript mit Download, Audiodeskription als Text oder vorgelesen, Gebärdensprach-Option und DGS-Konzept |

---

## Qualitäts- & Sicherheits-Kennzahlen

- **100 % automatisierte Testabdeckung:** `vitest.config.ts` erzwingt `100 %` über Lines, Functions, Branches und Statements (Unit-, Integrations-, Contract-, `fast-check` Property-Fuzzing- und A11y-Tests).
- **0 Schwachstellen & 0 Secrets:** Kontinuierlich geprüft durch `osv-scanner`, `gitleaks` (`.github/gitleaks.toml`), `CodeQL` und `OpenSSF Scorecard`.
- **Striktes UTF-8 ohne BOM & 0 Emojis:** Automatisiert über das gesamte Repository durch `encoding.test.ts` abgesichert.
