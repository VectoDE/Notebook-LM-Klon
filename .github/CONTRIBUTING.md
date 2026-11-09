# Contributing to RelationNotes

Vielen Dank für dein Interesse an **RelationNotes – NotebookLM & RelationFlow Knowledge Studio**! Dieses Dokument beschreibt den verbindlichen Entwicklungs-, Test- und Pull-Request-Prozess.

## 1. Verbindlicher Git- & Pull-Request-Workflow

1. **Nie direkt auf `main` committen:** Jede Änderung erfolgt über ein GitHub-Issue (inkl. verknüpfter Sub-Issues) und einen eigenen Feature-Branch (`feat/issue-<nr>-<slug>`, `fix/issue-<nr>-<slug>`, `docs/issue-<nr>-<slug>`, `ci/issue-<nr>-<slug>`).
2. **Test-Driven Development (TDD):** Für jedes Sub-Issue wird zuerst der Test geschrieben bzw. erweitert, danach die streng typisierte Implementierung (`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`).
3. **Echtzeit-Checklisten-Pflicht (Entscheidung #90 & #102):**
   - Nach jedem Teil-Commit für ein Sub-Issue werden die erledigten Checkboxen (`- [ ]` → `- [x]`) im Sub-Issue abgehakt und mit dem verifizierenden Commit-SHA dokumentiert.
   - Ein Sub-Issue oder Haupt-Issue darf **niemals** geschlossen werden, solange noch eine Checkbox `- [ ]` offen ist. Der CI-Workflow `verify-issue-checklists.yml` erzwingt diese Regel bei jedem Pull Request.
4. **Conventional Commits (Englisch):**
   - Format: `<type>(<scope>): <imperative summary> (#<sub-issue>)`
   - Beispiele: `feat(rag): implement symmetric int8 scalar quantization (#95)`, `test(db): verify D1 FTS5 virtual table creation (#53)`
5. **Striktes Verbot von KI-Kennzeichnungen:**
   - Weder in Commit-Messages noch in Pull Requests, Issues, Kommentaren, Quellcode oder Dokumentation dürfen Zeilen wie `Generated with ...` oder `Co-Authored-By: ...` enthalten sein.
6. **Striktes UTF-8 ohne BOM / Kein Mojibake:**
   - Alle Dateien müssen als reines UTF-8 ohne BOM mit `LF`-Zeilenenden gespeichert werden (`packages/shared/src/__tests__/encoding.test.ts` prüft dies bei jedem Testlauf).

## 2. Lokale Qualitäts- & Sicherheitsprüfungen vor jedem Push

Vor dem Erstellen oder Aktualisieren eines Pull Requests müssen folgende Befehle lokal zu 100 % fehlerfrei durchlaufen:

```bash
pnpm lint          # Biome Linter, Formatter & 29 WAI-ARIA/JSX-A11y-Regeln
pnpm typecheck     # TypeScript strict über alle Workspace-Pakete
pnpm test:coverage # Vitest Unit-, Integration-, Property/Fuzz- & Worker-Tests (100 % Coverage-Gate!)
pnpm build         # Produktions-Build aller Pakete
```

## 3. Barrierefreiheit (WCAG 2.2 AAA) & Datenschutz

- Alle interaktiven UI-Elemente müssen mindestens $44 \times 44\text{ px}$ groß sein, vollständige Tastaturbedienung bieten und in allen 4 Design-Systemen (inkl. AAA-Hochkontrast-Modus) fehlerfrei durch `axe-core` validiert werden.
- Keine personenbezogenen Geheimnisse, API-Keys oder privaten Wohnadressen in das öffentliche Repository committen.
