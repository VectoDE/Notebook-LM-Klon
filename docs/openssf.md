# OpenSSF Scorecard & Best Practices Dokumentation (`RelationNotes`)

Stand: 2026-11-13 · Referenzen: Entscheidungen #20, #51, #52, #71, #100, #105 · Issue #148

Diese Seite hält fest, was bei **RelationNotes – NotebookLM & RelationFlow Knowledge Studio** für die Open Source Security Foundation (OpenSSF) belegt ist und was nicht. Jede Aussage verweist auf eine Datei, einen Workflow oder einen Messwert. Was nicht erreicht ist, steht in Kapitel 5.

## 1. OpenSSF Scorecard Checks – Status & Nachweis

Der Workflow `.github/workflows/scorecard.yml` läuft bei Push auf `main`, bei Änderungen der Branch-Schutzregeln und wöchentlich. Das Badge in der `README.md` zeigt den veröffentlichten Wert.

**Messwert vom 2026-11-12** (öffentliche API `api.scorecard.dev`, Commit `db99076`): Gesamtwert **7,5 / 10**.

| Scorecard Check | Messwert | Umsetzung im Repository und Einordnung |
|---|---|---|
| **Token-Permissions** | 10 | Alle Workflows setzen `permissions` auf Top-Level auf `contents: read` (in `scorecard.yml`: `read-all`). Schreibrechte (`security-events`, `id-token`, `attestations`, `contents: write`) stehen nur auf Job-Ebene. |
| **Pinned-Dependencies** | 6 | Alle GitHub Actions sind auf einen 40-stelligen Commit-SHA gepinnt (geprüft in `packages/shared/src/__tests__/ci-workflows.test.ts`). Offen: Die drei Basis-Images in `apps/worker/Dockerfile` sind nicht per Digest gepinnt, daher nur 6 statt 10. |
| **Dependency-Update-Tool** | 10 | `.github/renovate.json` (`rangeStrategy: "pin"`, `helpers:pinGitHubActionDigests`) und `.github/dependabot.yml`. |
| **SAST** | 10 | `.github/workflows/codeql.yml` analysiert JavaScript/TypeScript bei Push, Pull Request und wöchentlich. |
| **Vulnerabilities** | 10 | `ci.yml` führt `osv-scanner` über `pnpm-lock.yaml` und `gitleaks` über die Historie aus. Scorecard meldet 0 bekannte Schwachstellen. |
| **Security-Policy** | 10 | `.github/SECURITY.md` (Coordinated Vulnerability Disclosure, privater Meldeweg über GitHub Security Advisories). |
| **License** | 10 | `LICENSE` (MIT). |
| **Dangerous-Workflow** | 10 | Kein `pull_request_target`, keine Skript-Injektion über Eingaben. In `release.yml` und `deploy.yml` laufen Eingaben nur über Umgebungsvariablen. |
| **Binary-Artifacts** | 10 | Keine Binärdateien im Repository. |
| **Fuzzing** | 10 | Property-Based-Tests mit `fast-check` (`apps/worker/src/__tests__/worker-fuzz.test.ts`, `apps/worker/src/__tests__/ssrf-guard-fuzz.test.ts`, `packages/shared/src/__tests__/property-fuzz.test.ts`, `packages/shared/src/__tests__/property-fuzz-core.test.ts`). Chunker, SSRF-Prüfung, Zitat-Parser und int8-Quantisierung laufen mit je 1.000 Fällen und festem Seed. Beim Aufbau fiel auf: Bereichsmarker wie `[1-999999999]` wurden Zahl für Zahl aufgezählt; sie werden jetzt ab 100 Einträgen ignoriert. |
| **CI-Tests** | 10 | 30 von 30 gemergten Pull Requests liefen mit CI-Tests. |
| **Contributors** | 3 | Ein Beitragender aus einer Organisation. Strukturell, siehe Kapitel 3. |
| **Code-Review** | 0 | 0 von 30 Änderungen mit zweiter Freigabe. Strukturell, siehe Kapitel 3. |
| **Maintained** | 0 | Das Repository ist jünger als 90 Tage. Der Wert steigt mit der Zeit ohne Zutun. |
| **CII-Best-Practices** | 0 | Es existiert noch kein Projekt auf bestpractices.dev. Inhaber-Schritt, siehe Kapitel 5. |
| **Signed-Releases** | nicht bewertbar (-1) | Es gibt noch kein Release. `release.yml` ist vorbereitet, siehe Kapitel 4. |
| **Packaging** | nicht bewertbar (-1) | Es wird kein Paket in einer Registry veröffentlicht. Der Check erkennt nur Registry-Workflows. |
| **Branch-Protection** | nicht bewertbar (-1) | Der Scorecard-Lauf bekommt mit dem Standard-Token keinen Zugriff auf die Schutzregeln. Der tatsächliche Stand steht unten. |

### Tatsächlicher Stand des Branch-Schutzes auf `main`

Abgefragt am 2026-11-13 über `gh api repos/VectoDE/Notebook-LM-Klon/branches/main/protection`:

- Pflicht-Checks: `Lint, Typecheck, Coverage & Build`, `Secret Scan (Gitleaks) & Dependency Audit (OSV)` und `Verify Sub-Issue Checklists Are 100% Checked`, jeweils auf aktuellem Stand des Branches (`strict`).
- Lineare Historie erforderlich, Force-Push verboten.
- **Keine** erforderliche Freigabe durch eine zweite Person (`required_pull_request_reviews` ist leer). Die Regeln gelten nicht für Administratoren (`enforce_admins: false`).
- Secret Scanning mit Push-Protection und Dependabot Security Updates sind aktiv.

## 2. OpenSSF Best Practices (Passing) – Kriterien mit Begründung

Es gibt noch kein Projekt auf bestpractices.dev, daher auch kein Badge. Die Tabelle ist die Vorlage für die Antworten, sobald der Inhaber das Projekt anlegt. Status: **Erfüllt** (belegt), **Teilweise**, **Offen**. Die Kriterien stammen aus der Passing-Liste unter <https://www.bestpractices.dev/en/criteria>. Vor dem Ausfüllen die Liste gegen den dann gültigen Stand prüfen.

### Grundlagen (Basics)

| Kriterium | Status | Nachweis / Begründung |
|---|---|---|
| Beschreibung, wie die Software funktioniert und was sie tut | Erfüllt | `README.md`, `docs/architecture.md`, GitHub Wiki |
| Wie man beiträgt, Beitragsregeln | Erfüllt | `.github/CONTRIBUTING.md` (Conventional Commits, Tests, Coverage-Gate), `.github/PULL_REQUEST_TEMPLATE.md` |
| FLOSS-Lizenz, OSI-anerkannt, Lizenz auffindbar | Erfüllt | `LICENSE` (MIT) im Repository-Root |
| Dokumentation der Grundlagen und der Schnittstelle | Erfüllt | `README.md`, `docs/`, `docs/openapi.json` (OpenAPI 3.1) |
| Projektseiten über HTTPS | Erfüllt | GitHub und GitHub Wiki liefern ausschließlich HTTPS |
| Diskussionsort, Englisch lesbar | Teilweise | GitHub Issues und Discussions. Die Projektdokumentation ist überwiegend deutsch. Fehlerberichte auf Englisch werden angenommen. |
| Wird gepflegt | Erfüllt | Laufende Commits und Pull Requests, Wartung durch eine Person |

### Änderungskontrolle (Change Control)

| Kriterium | Status | Nachweis / Begründung |
|---|---|---|
| Öffentliches Versionskontroll-Repository, verteilt, mit Zwischenständen | Erfüllt | GitHub (öffentlich), Git-Historie mit Pull Requests |
| Eindeutige Versionsnummern, Release-Tags | Offen | Es wurde noch kein Release veröffentlicht. `release.yml` verlangt Tags nach `vMAJOR.MINOR.PATCH`. |
| Release Notes, bei Schwachstellen mit CVE-Hinweis | Teilweise | `CHANGELOG.md` und `.github/release.yml` (Kategorien für generierte Notes). Erste Release Notes entstehen mit dem ersten Release. |

### Meldewege (Reporting)

| Kriterium | Status | Nachweis / Begründung |
|---|---|---|
| Prozess für Fehlerberichte, Issue-Tracker, Archiv | Erfüllt | `.github/ISSUE_TEMPLATE/*`, öffentliche GitHub Issues |
| Antworten auf Fehlerberichte und Wünsche | Teilweise | `.github/SUPPORT.md` beschreibt den Ablauf. Es gibt nur einen Maintainer, eine feste Antwortzeit ist daher nicht zugesichert. |
| Privater Meldeweg für Schwachstellen, Reaktionszeit | Erfüllt | `.github/SECURITY.md` (Security Advisories, Reaktionszeiten) |

### Qualität (Quality)

| Kriterium | Status | Nachweis / Begründung |
|---|---|---|
| Reproduzierbarer Build mit gängigen FLOSS-Werkzeugen | Erfüllt | `pnpm install --frozen-lockfile`, `pnpm build` (Vite, TypeScript, wrangler) |
| Automatisierte Testsuite, als FLOSS, dokumentierter Aufruf | Erfüllt | Vitest (`pnpm test`), Aufruf in `README.md` und `CONTRIBUTING.md` |
| Testabdeckung, Tests laufen in der CI | Erfüllt | `pnpm test:coverage` erzwingt **100 % Abdeckung** (Lines, Functions, Branches, Statements) für die in `vitest.config.ts` gelisteten Module, geprüft in `ci.yml` |
| Testpolitik: neue Funktionen bekommen Tests | Erfüllt | `CONTRIBUTING.md` (TDD-Pflicht), `PULL_REQUEST_TEMPLATE.md` |
| Compiler-Warnungen und Linter, Warnungen behoben | Erfüllt | TypeScript `strict: true`, Biome (`pnpm lint`) als Pflicht-Check |

### Sicherheit (Security)

| Kriterium | Status | Nachweis / Begründung |
|---|---|---|
| Kenntnis sicherer Entwicklung und typischer Fehler | Teilweise | Selbsteinschätzung des Maintainers. Dokumentiert in `docs/security-and-compliance.md` und `SECURITY.md`. Eine externe Prüfung gibt es nicht. |
| Veröffentlichte, getestete kryptografische Verfahren | Erfüllt | WebCrypto: `AES-256-GCM` mit AAD, `SHA-256`, `ECDSA P-256` (WebAuthn). Keine `MD5`-, `SHA-1`-, `RC4`- oder `DES`-Verwendung für Sicherheitszwecke. |
| Auslieferung gegen Man-in-the-Middle geschützt | Erfüllt | Quellcode und Releases über HTTPS von GitHub |
| Keine geleakten Zugangsdaten im Repository | Erfüllt | `gitleaks` in `ci.yml`, GitHub Secret Scanning mit Push-Protection |
| Bekannte Schwachstellen zeitnah beheben | Erfüllt | Scorecard `Vulnerabilities`: 10 (keine bekannten), Dependabot und Renovate |

### Analyse (Analysis)

| Kriterium | Status | Nachweis / Begründung |
|---|---|---|
| Statische Codeanalyse, Befunde werden behoben | Erfüllt | CodeQL (`codeql.yml`) bei jedem Push und Pull Request |
| Dynamische Analyse | Teilweise | Property-Based-Tests mit `fast-check` und End-to-End-Tests mit Playwright. Es gibt keinen DAST-Scanner gegen eine laufende Instanz. |

**Einordnung:** Passing ist mit den Punkten „Erfüllt“ bis auf Release-Tags und Release Notes erreichbar. Beide entstehen mit dem ersten Release (Kapitel 4). Es wird kein Badge gezeigt, bevor bestpractices.dev den Status bestätigt.

## 3. Strukturelle Einzelentwickler-Ausnahmen (Zwei-Reviewer-Regel)

Das Projekt hat einen Maintainer. Drei Kriterien lassen sich damit nicht ehrlich erfüllen und werden nicht vorgetäuscht:

1. **Zweite Freigabe (`Code-Review`, Gold-Kriterium `two_person_review`).** GitHub erlaubt keine Freigabe des eigenen Pull Requests durch dasselbe Konto. Eine Pflicht-Freigabe (`required_approving_review_count >= 1`) würde jeden Merge blockieren. Ersatzmaßnahmen: Änderungen laufen über Pull Requests, dazu drei Pflicht-Checks (Lint/Typecheck/100-%-Coverage, Secret- und Abhängigkeits-Scan, Checklisten-Gate) und ein schriftlicher Review-Bericht pro Pull Request. Scorecard bewertet diese Ersatzmaßnahmen nicht, `Code-Review` bleibt daher bei 0.
2. **Mehrere unabhängige Beitragende (`Contributors`, Gold-Kriterium `contributors_unassociated`).** Das Projekt ist eine Einzelarbeit. Der Wert bleibt niedrig, bis weitere Organisationen beitragen.
3. **Bus-Faktor und Zugriffskontinuität (Silver-Kriterien `bus_factor`, `access_continuity`).** Beides setzt mindestens zwei Personen mit Schreibrechten voraus. Mit einem Maintainer nicht erfüllbar. Silver und Gold sind deshalb nicht erreichbar, solange sich das nicht ändert.

## 4. Release-Checkliste (signierte Releases mit Provenance)

Der Workflow `.github/workflows/release.yml` startet bei einem Tag `v*.*.*`. Der Job `build` prüft die Version gegen den Tag, führt die Tests mit Coverage-Schwelle aus, baut, packt das Web-Paket und das Quellarchiv als `tar.gz`, erzeugt eine CycloneDX-SBOM (`anchore/sbom-action`), einen Changelog aus den Commits und `SHA256SUMS.txt`. Der Job `publish` läuft erst nach Freigabe im Environment `release`, erstellt SLSA-Build-Provenance (`actions/attest-build-provenance`), attestiert die SBOM (`actions/attest-sbom`), signiert alle Dateien keyless mit `cosign` und legt das GitHub Release an. `workflow_dispatch` ist ein Probelauf ohne Attestierung, Signatur und Release.

**Vor dem Tag**

- [ ] Alle Pflicht-Checks auf `main` sind grün (`Lint, Typecheck, Coverage & Build`, Scan, Checklisten-Gate, E2E).
- [ ] `CHANGELOG.md` enthält die Änderungen der Version, Schwachstellen-Fixes sind benannt (Release Notes).
- [ ] Die Versionsnummer folgt SemVer (`vMAJOR.MINOR.PATCH`) und ist in den `package.json`-Dateien abgestimmt.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage` und `pnpm build` laufen lokal ohne Fehler.
- [ ] `docs/openapi.json` stimmt mit den Routen überein (der Test `openapi.test.ts` ist grün).

**Tag setzen (Inhaber)**

- [ ] Annotierten Tag auf den geprüften Commit von `main` setzen und pushen: `git tag -a vX.Y.Z -m "vX.Y.Z"` und `git push origin vX.Y.Z`.
- [ ] Den Job `publish` im Environment `release` freigeben und den Lauf von `release.yml` abwarten. Bei einem Fehler den Tag nicht verschieben, sondern eine neue Patch-Version vergeben.

**Nach dem Release prüfen**

- [ ] Das Release enthält `notebook-lm-klon-web-<version>.tar.gz`, `notebook-lm-klon-<version>-source.tar.gz`, `notebook-lm-klon-<version>.cdx.json`, `CHANGELOG-<version>.md`, `SHA256SUMS.txt` und zu jeder Archiv-, SBOM- und Prüfsummendatei ein `.sigstore.json`-Bundle.
- [ ] Prüfsummen: `sha256sum -c SHA256SUMS.txt`.
- [ ] Herkunft: `gh attestation verify notebook-lm-klon-web-<version>.tar.gz --repo VectoDE/Notebook-LM-Klon`.
- [ ] Signatur: `cosign verify-blob --bundle <datei>.sigstore.json --certificate-identity-regexp "https://github.com/VectoDE/Notebook-LM-Klon/" --certificate-oidc-issuer https://token.actions.githubusercontent.com <datei>`.
- [ ] Scorecard-Lauf abwarten und `Signed-Releases` prüfen. Ob Scorecard die Sigstore-Bundles als Signatur wertet, zeigt erst der erste Lauf nach dem Release.
- [ ] Ein Deploy ist ein getrennter Schritt: Workflow `deploy.yml` manuell starten und im Environment `production` freigeben.

## 5. Offene Punkte und Inhaber-Schritte

| Punkt | Art | Beschreibung |
|---|---|---|
| bestpractices.dev-Projekt anlegen | Inhaber-Schritt | Konto bei bestpractices.dev, Projekt für das Repository anlegen, Antworten aus Kapitel 2 übernehmen. Das Badge erst danach in die `README.md` aufnehmen. |
| Erstes Release `v0.1.0` | Inhaber-Schritt | Tag setzen (Kapitel 4). Danach entfallen „Offen“ bei Release-Tags und Release Notes sowie `Signed-Releases` mit -1. |
| Docker-Basis-Images per Digest pinnen | Technische Schuld | Hebt `Pinned-Dependencies` von 6 auf 10. Noch nicht umgesetzt. |
| Zweite Freigabe, weitere Beitragende | Strukturell | Nicht erreichbar mit einem Maintainer (Kapitel 3). |
| DAST gegen eine Staging-Instanz | Verbesserung | Erst sinnvoll, wenn eine Instanz deployt ist. |
