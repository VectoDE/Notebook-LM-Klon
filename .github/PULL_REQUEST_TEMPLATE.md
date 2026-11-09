## Zusammenfassung & Verknüpfte Issues
<!-- Referenz auf das Haupt-Issue und die zugehörigen Sub-Issues (keine vorzeitigen Auto-Close-Keywords verwenden, solange Checkboxen offen sind!) -->
- Haupt-Issue: Refs #
- Sub-Issues: Refs #

## Umgesetzte Teilaufgaben (Commits `a`, `b`, `c`)
- [ ] **Sub-Issue a** implementiert, getestet, Checkboxen im Sub-Issue auf `[x]` gesetzt und Sub-Issue geschlossen.
- [ ] **Sub-Issue b** implementiert, getestet, Checkboxen im Sub-Issue auf `[x]` gesetzt und Sub-Issue geschlossen.
- [ ] **Sub-Issue c** implementiert, getestet, Checkboxen im Sub-Issue auf `[x]` gesetzt und Sub-Issue geschlossen.
- [ ] Alle Akzeptanzkriterien und Unterissue-Checkboxen im **Haupt-Issue** sind verifiziert und auf `- [x]` gesetzt.

## Qualitäts-, Sicherheits- & Barrierefreiheits-Checkliste (`qualitaetsstandard`)
- [ ] **100 % Testabdeckung (TDD):** `pnpm test:coverage` erreicht **100 %** über Lines, Functions, Branches und Statements (Unit-, Integrations-, Contract-, Property/Fuzz- und A11y-Tests grün).
- [ ] **Statische Analyse & Typisierung:** `pnpm lint` (Biome inkl. 29 A11y-Regeln) und `pnpm typecheck` (`strict: true`, `noUncheckedIndexedAccess: true`) melden 0 Fehler.
- [ ] **Security & Supply-Chain:** `gitleaks detect --config .github/gitleaks.toml --no-git` und `osv-scanner scan source -r .` melden **0 Funde**.
- [ ] **Barrierefreiheit (WCAG 2.2 Level AAA):** Kontrast `>= 7:1` für Fließtext, semantische Landmarks, Fokus-Ringe und Tastaturbedienbarkeit geprüft.
- [ ] **UTF-8 & Encoding-Hygiene:** Alle Dateien sind valides UTF-8 ohne BOM (`0xEF 0xBB 0xBF`), LF-Zeilenenden, 0 Mojibake-Muster.
- [ ] **Keine KI-Kennzeichnung:** Weder Commits noch Code, Kommentare oder PR-Texte enthalten `Generated with ...` oder `Co-Authored-By: ...`.
