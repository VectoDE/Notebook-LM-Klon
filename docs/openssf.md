# OpenSSF Scorecard & Best Practices Dokumentation (`RelationNotes`)

Stand: 2026-11-13 · Referenzen: Entscheidungen #20, #51, #52, #71, #100, #105

## 1. OpenSSF Scorecard Checks – Status & Architektur-Nachweis

Das Projekt **RelationNotes – NotebookLM & RelationFlow Knowledge Studio** setzt die Sicherheitsanforderungen der Open Source Security Foundation (OpenSSF) konsequent um:

| Scorecard Check | Umsetzung im Repository | Status |
|---|---|---|
| **Token-Permissions** | Alle Workflows unter `.github/workflows/*.yml` deklarieren auf Top-Level restriktive Berechtigungen (`permissions: contents: read` bzw. `permissions: read-all` in `scorecard.yml`); Schreibrechte (`security-events: write`) werden ausschließlich auf Job-Ebene vergeben. | 10/10 |
| **Pinned-Dependencies** | Sämtliche GitHub Actions sind exakt auf ihren 40-stelligen Commit-SHA gepinnt (automatisch geprüft durch `packages/shared/src/__tests__/ci-workflows.test.ts`). Das Basis-Image in `apps/worker/Dockerfile` ist seit 2026-11-13 auf den Digest `node:22-alpine@sha256:1314fb30…481a` gepinnt (Multi-Arch-OCI-Index, direkt aus `registry-1.docker.io` gelesen; geprüft durch `openssf.test.ts`, aktualisiert durch Renovate `config:best-practices`). `pnpm-lock.yaml` nutzt gepinnte Paketversionen. | Ziel 10/10 (Score nach nächstem Scorecard-Lauf auf `main` ablesen) |
| **Dependency-Update-Tool** | `.github/renovate.json` und `.github/dependabot.yml` sind für gepinnte Abhängigkeiten (`rangeStrategy: "pin"`) und GitHub-Action-SHA-Digests (`helpers:pinGitHubActionDigests`) eingerichtet. | 10/10 |
| **SAST** | `.github/workflows/codeql.yml` führt bei jedem Push/PR sowie wöchentlich CodeQL-Analysen (`security-extended,security-and-quality`) aus. | 10/10 |
| **Vulnerabilities** | `.github/workflows/ci.yml` prüft das Lockfile bei jedem Lauf mit `osv-scanner` und den Quellcode mit `gitleaks` (`.github/gitleaks.toml`, aktuell **0 Befunde** bei 183 Paketen). | 10/10 |
| **Security-Policy** | `.github/SECURITY.md` dokumentiert den Coordinated-Vulnerability-Disclosure-Prozess, Reaktionszeiten und Sicherheitsmechanismen. | 10/10 |
| **License** | `LICENSE` im Repository-Root enthält den vollständigen `MIT`-Lizenztext. | 10/10 |
| **Branch-Protection** | Der `main`-Branch ist geschützt: Pull-Request-Pflicht mit `required_approving_review_count: 1`, Pflicht-Status-Checks („Lint, Typecheck, Coverage & Build“, „Secret Scan (Gitleaks) & Dependency Audit (OSV)“, „Verify Sub-Issue Checklists Are 100% Checked“, `strict`), lineare Historie, aufgelöste Konversationen, kein Force-Push, kein Löschen. `enforce_admins` ist aus, damit der einzige Maintainer nach grünen Checks mergen kann (siehe Code-Review). | Hoch, nicht maximal |
| **Code-Review** | Scorecard zählt nur Änderungen, die vor dem Merge von einer **zweiten Person** genehmigt wurden. GitHub erlaubt keine Selbstgenehmigung des eigenen PRs. Solange nur ein Maintainer existiert, bleibt dieser Check niedrig. Ausgleich: jeder PR läuft über Pflicht-Checks, CodeQL und einen dokumentierten Review-Bericht. Abhilfe nur durch einen zweiten Reviewer mit Schreibrechten (Inhaber-Schritt). | Strukturell begrenzt |
| **Maintained** | Scorecard bewertet Commits und Issue-Aktivität der letzten 90 Tage und vergibt 0 Punkte, solange das Repository jünger als 90 Tage ist. Das lässt sich nur durch echte, fortlaufende Pflege über diesen Zeitraum verbessern, nicht durch künstliche Aktivität. | Strukturell begrenzt (Repo-Alter) |
| **CII-Best-Practices** | Erfordert einen Eintrag auf [bestpractices.dev](https://www.bestpractices.dev/). Die Registrierung und Selbstauskunft erfolgt über das Konto des Inhabers (Inhaber-Schritt); danach wird das Badge in `README.md` ergänzt. | Offen (Inhaber-Schritt) |
| **Signed-Releases & Provenance** | Gestaffelte Releases (`v0.1.0` bis `v1.0.0`) werden mit CycloneDX-SBOM und SLSA-Build-Provenance veröffentlicht. | Geplant / Aktiv |

### Transparente Begründung struktureller Grenzen bei einem Einzel-Bewerbungsprojekt
Zwei Teilkriterien der OpenSSF Scorecard bzw. des OpenSSF Best Practices Silver-Levels sind bei einem durch eine einzelne Person entwickelten Bewerbungsprojekt strukturell bedingt eingeschränkt:
1. **Zwei-Personen-Review (`required_approving_review_count >= 2`):** Da auf GitHub der eigene Pull Request nicht durch denselben Account genehmigt werden kann, verlangt die Branch-Protection zwar eine Genehmigung (`required_approving_review_count: 1`), sie wird für Administratoren aber nicht erzwungen (`enforce_admins: false`), damit nach grünen CI-Gates und dokumentierter Qualitätsprüfung (`qualitaetsstandard`) gemergt werden kann. Die Scorecard-Checks `Code-Review` und `Maintained` bleiben dadurch bzw. wegen des jungen Repository-Alters niedrig; das ist hier bewusst offen benannt. Jeder PR erhält jedoch einen vollständigen, strukturierten Review-Bericht als PR-Kommentar sowie ein automatisiertes Checklisten-Gate (`verify-issue-checklists.yml`).
2. **Contributors aus mehreren Organisationen (`Contributors`):** Das Repository repräsentiert die eigenständige Full-Stack-Testaufgabe von Tim Hauke für die Everlast Consulting GmbH.

---

## 2. OpenSSF Best Practices (Passing & Silver Checkliste)

- **Projektname & Zweck:** RelationNotes – NotebookLM & RelationFlow Knowledge Studio (dokumentiert in `README.md`, `docs/` und im GitHub Wiki).
- **Öffentliches Issue-Tracking & Roadmap:** 44 Haupt-Issues + 132 native GitHub Sub-Issues auf dem GitHub Project Board #13 in 4 Meilensteinen.
- **Automatisierte Test-Suite & Coverage-Gate:** Vitest mit `@vitest/coverage-v8` und `fast-check` erzwingt **100 % Abdeckung** (Lines, Functions, Branches, Statements) bei jedem Commit.
- **Kryptografische Standards:** Ausschließliche Verwendung standardisierter WebCrypto-Algorithmen (`AES-256-GCM` mit `AAD`, `SHA-256`, `ECDSA P-256` für WebAuthn). Keine veralteten Algorithmen (`MD5`, `SHA-1`, `RC4`, `DES`).
