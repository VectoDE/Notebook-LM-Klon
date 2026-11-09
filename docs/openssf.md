# OpenSSF Scorecard & Best Practices Dokumentation (`RelationNotes`)

Stand: 2026-11-09 · Referenzen: Entscheidungen #20, #51, #52, #71, #100, #105

## 1. OpenSSF Scorecard Checks – Status & Architektur-Nachweis

Das Projekt **RelationNotes – NotebookLM & RelationFlow Knowledge Studio** setzt die Sicherheitsanforderungen der Open Source Security Foundation (OpenSSF) konsequent um:

| Scorecard Check | Umsetzung im Repository | Status |
|---|---|---|
| **Token-Permissions** | Alle Workflows unter `.github/workflows/*.yml` deklarieren auf Top-Level restriktive Berechtigungen (`permissions: contents: read` bzw. `permissions: read-all` in `scorecard.yml`); Schreibrechte (`security-events: write`) werden ausschließlich auf Job-Ebene vergeben. | 10/10 |
| **Pinned-Dependencies** | Sämtliche GitHub Actions sind exakt auf ihren 40-stelligen Commit-SHA gepinnt (automatisch geprüft durch `packages/shared/src/__tests__/ci-workflows.test.ts`). `pnpm-lock.yaml` nutzt gepinnte Paketversionen. | 10/10 |
| **Dependency-Update-Tool** | `renovate.json` ist für gepinnte Abhängigkeiten (`rangeStrategy: "pin"`) und GitHub-Action-SHA-Digests (`helpers:pinGitHubActionDigests`) eingerichtet. | 10/10 |
| **SAST** | `.github/workflows/codeql.yml` führt bei jedem Push/PR sowie wöchentlich CodeQL-Analysen (`security-extended,security-and-quality`) aus. | 10/10 |
| **Vulnerabilities** | `.github/workflows/ci.yml` prüft das Lockfile bei jedem Lauf mit `osv-scanner` und den Quellcode mit `gitleaks` (aktuell **0 Befunde** bei 181 Paketen). | 10/10 |
| **Security-Policy** | `SECURITY.md` dokumentiert den Coordinated-Vulnerability-Disclosure-Prozess, Reaktionszeiten und Sicherheitsmechanismen. | 10/10 |
| **License** | `LICENSE` im Repository-Root enthält den vollständigen `Apache-2.0`-Lizenztext. | 10/10 |
| **Branch-Protection** | Der `main`-Branch ist geschützt (Pull-Request-Pflicht, Status-Checks `quality-and-tests`, `secret-and-dependency-scan`, `verify-subissue-checklists`, lineare Historie, kein Force-Push). | Hoch |
| **Signed-Releases & Provenance** | Gestaffelte Releases (`v0.1.0` bis `v1.0.0`) werden mit CycloneDX-SBOM und SLSA-Build-Provenance veröffentlicht. | Geplant / Aktiv |

### Transparente Begründung struktureller Grenzen bei einem Einzel-Bewerbungsprojekt
Zwei Teilkriterien der OpenSSF Scorecard bzw. des OpenSSF Best Practices Silver-Levels sind bei einem durch eine einzelne Person entwickelten Bewerbungsprojekt strukturell bedingt eingeschränkt:
1. **Zwei-Personen-Review (`required_approving_review_count >= 2`):** Da auf GitHub der eigene Pull Request nicht durch denselben Account genehmigt werden kann, steht die formale GitHub-Reviewer-Anzahl auf `0`, damit nach grünen CI-Gates und dokumentierter Qualitätsprüfung (`qualitaetsstandard`) gemergt werden kann. Jeder PR erhält jedoch einen vollständigen, strukturierten Review-Bericht als PR-Kommentar sowie ein automatisiertes Checklisten-Gate (`verify-issue-checklists.yml`).
2. **Contributors aus mehreren Organisationen (`Contributors`):** Das Repository repräsentiert die eigenständige Full-Stack-Testaufgabe von Tim Hauke für die Everlast Consulting GmbH.

---

## 2. OpenSSF Best Practices (Passing & Silver Checkliste)

- **Projektname & Zweck:** RelationNotes – NotebookLM & RelationFlow Knowledge Studio (dokumentiert in `README.md`, `docs/` und im GitHub Wiki).
- **Öffentliches Issue-Tracking & Roadmap:** 44 Haupt-Issues + 132 native GitHub Sub-Issues auf dem GitHub Project Board #13 in 4 Meilensteinen.
- **Automatisierte Test-Suite & Coverage-Gate:** Vitest mit `@vitest/coverage-v8` erzwingt $\ge 90\text{ \%}$ Abdeckung bei jedem Commit.
- **Kryptografische Standards:** Ausschließliche Verwendung standardisierter WebCrypto-Algorithmen (`AES-256-GCM` mit `AAD`, `SHA-256`, `ECDSA P-256` für WebAuthn). Keine veralteten Algorithmen (`MD5`, `SHA-1`, `RC4`, `DES`).
