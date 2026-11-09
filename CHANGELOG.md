# Changelog (`RelationNotes`)

Alle nennenswerten Änderungen an **RelationNotes – NotebookLM & RelationFlow Knowledge Studio** werden in dieser Datei nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/) und [Semantic Versioning](https://semver.org/lang/de/) dokumentiert.

## [0.1.0] - 2026-11-09 — Block 1: Foundation, Single-Worker Edge, CI/CD, OpenSSF & Visual Docs

### Added
- **Monorepo & Tooling (`#1`, `#47`, `#48`, `#49`):** `pnpm`-Workspace (`apps/web`, `apps/worker`, `packages/shared`) mit strengem TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`), Biome (inkl. 29 verpflichtenden WAI-ARIA/JSX-Regeln), Vitest (`>= 90 %` Coverage-Gate), RFC-9457-ProblemDetails-Schemas und automatisiertem Repository-weiten UTF-8-/Anti-Mojibake-Wächter (`encoding.test.ts`).
- **Cloudflare Single-Worker & SQLite Durable Objects (`#2`, `#50`, `#51`, `#52`):** `wrangler.jsonc` mit SPA-Static-Assets, D1 (`DB`), R2 (`MEDIA`), `NotebookDO` und `JobDO` (`new_sqlite_classes`), automatischer Typgenerierung (`wrangler types`), Profil-Management (`demo` vs. `full`) und `GET /api/v1/health`.
- **Plattform-Verifikation & Visuelle Dokumentation (`#3`, `#53`, `#54`, `#55`):** Automatisierter D1-`FTS5`- & `bm25()`-Beweistest (`fts5-probe.test.ts`), WebCrypto-10-ms-CPU-Benchmark (`crypto-benchmark.test.ts`, `< 0,6 ms` kombiniert pro Request) sowie 8 reich bebilderte Architektur-, RAG-, RelationFlow-, Datenbank-, Security- und Loom-Präsentationsdokumente inkl. SVG-Infografiken unter `docs/assets/`.
- **GitHub Actions Security & Checklisten-Gate (`#4`, `#56`, `#57`, `#58`):** 100 % Commit-SHA-gepinnte Workflows für `ci.yml` (Lint, Typecheck, Tests, `gitleaks`, `osv-scanner`), `verify-issue-checklists.yml`, `codeql.yml` (SAST) sowie `renovate.json`.
- **OpenSSF Governance, Wiki-Sync & Agentur-README (`#5`, `#59`, `#60`, `#61`):** `scorecard.yml`, `docs/openssf.md`, `LICENSE` (Apache-2.0), `SECURITY.md`, `CONTRIBUTING.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/`, `CODEOWNERS`, `README.md` mit Hero-Banner und 1:1-Synchronisation in das offizielle GitHub Wiki.
