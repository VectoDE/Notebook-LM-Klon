# Barrierefreiheit nach WCAG 2.2 Level AAA – RelationNotes

**RelationNotes – NotebookLM & RelationFlow Knowledge Studio** erfüllt durchgängig die Anforderungen der **Web Content Accessibility Guidelines (WCAG) 2.2 auf Level AAA** (Entscheidung #31, #61) sowie des Barrierefreiheitsstärkungsgesetzes (BFSG / EN 301 549).

---

## 1. Farbkontraste & Typografie (`>= 7:1` AAA)

Unsere Design-System-Richtung **„Warm Editorial Research Studio“** kombiniert ermüdungsfreie Lesbarkeit für lange Forschungsdokumente mit streng verifizierten AAA-Kontrastwerten:

| Modus | Rolle | Vordergrund | Hintergrund | Kontrastverhältnis | WCAG-2.2-Stufe |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Light Mode** (*Warm Editorial Paper*) | Primärer Fließtext | `#141413` (*Deep Charcoal Ink*) | `#FAF8F5` (*Warm Ivory Paper*) | **16,8 : 1** | **AAA (`>= 7:1`)** |
| **Light Mode** (*Warm Editorial Paper*) | Sekundärer Text / Metadaten | `#3D3935` (*Warm Slate*) | `#FAF8F5` (*Warm Ivory Paper*) | **10,4 : 1** | **AAA (`>= 7:1`)** |
| **Dark Mode** (*Deep Ink Studio*) | Primärer Fließtext | `#F5F2EB` (*Warm Parchment*) | `#0B0F17` (*Obsidian Slate*) | **17,1 : 1** | **AAA (`>= 7:1`)** |
| **Dark Mode** (*Deep Ink Studio*) | Sekundärer Text / Zitate | `#CBD5E1` (*Crisp Silver*) | `#0B0F17` (*Obsidian Slate*) | **12,6 : 1** | **AAA (`>= 7:1`)** |
| **Fokus-Indikator** (WCAG 2.4.13) | 3 px Fokus-Ring mit 2 px Offset | `#1E40AF` (Light) / `#60A5FA` (Dark) | `#FAF8F5` / `#0B0F17` | **> 8,2 : 1** | **AAA (`>= 3:1` + 2 px)** |

Alle Kontrastwerte werden in `packages/shared/src/__tests__/a11y-baseline.test.ts` mathematisch über die relative Luminanz nach WCAG-2.x-Formel bei jedem CI-Lauf verifiziert.

---

## 2. Tastatursteuerung & Fokus-Management (WCAG 2.1.1, 2.4.11, 2.4.13)

- **Vollständige Tastaturbedienbarkeit:** Jede Funktion im 3-Spalten-Arbeitsbereich (*Quellen*, *Chat & Zitate*, *Studio & Artefakte*) ist ohne Maus erreichbar.
- **Skip-Links:** Sprungmarken am Dokumentanfang führen direkt zu `Quellen`, `Chat-Workspace`, `Studio-Artefakte` und `Audio-Player`.
- **Sichtbarer Fokus-Indikator (WCAG 2.4.13 Focus Appearance AAA):** Mindestens `3 px` durchgehender Umriss (`outline-offset: 2px`), niemals `outline: none` ohne hochkontrastreichen Ersatz.
- **Keine Fokus-Überdeckung (WCAG 2.4.11 / 2.4.12 Focus Not Obscured Enhanced AAA):** Sticky Header und der persistente Audio-Player überdecken niemals das aktuell fokussierte Element.
- **Klickflächen (WCAG 2.5.5 / 2.5.8 Target Size):** Interaktive primäre Bedienelemente bieten mindestens `44 × 44 CSS-Pixel` Trefferfläche, Inline-Zitate mindestens `24 × 24 CSS-Pixel` Abstand.

---

## 3. Multimodale Alternativen für Studio-Artefakte (WCAG 1.2.x AAA)

1. **Zwei-Host-Audio-Overview:**
   - Synchrones, wortgenaues **Volltext-Transkript** mit Sprecher-Kennzeichnung (*Host A*, *Host B*).
   - Klickbare Zeitstempel zum direkten Springen im Audio-Stream.
   - Tastatur-Shortcuts (`Leertaste` Play/Pause, `Pfeil links/rechts` ±10 Sekunden, `M` Stummschalten).
2. **Interaktive Mindmap & RelationFlow-Wissensgraph:**
   - Parallele **hierarchische ARIA-Treegrid-/Gliederungsansicht** (`role="tree"`, `aria-expanded`, Pfeiltasten-Navigation) für Screenreader-Nutzer, die keine 2D-Canvas-Fläche visuell abtasten.
   - Keine Pfad-Gesten-Pflicht (WCAG 2.5.1): Zoom, Pan und Knotenauswahl besitzen dedizierte `+`/`-`/`Reset`-Buttons.
3. **Video-Overview / Narrated Slides:**
   - Synchronisierte Untertitel (`WebVTT`), komplettes Sprecher-Skript und Folientexte als barrierefreie HTML-Struktur.

---

## 4. Kognitive Sicherheit, Bewegung & Sitzungsschutz (WCAG 2.2.6, 2.3.3, 3.3.6 AAA)

- **`prefers-reduced-motion: reduce` (WCAG 2.3.3 Animation from Interactions AAA):** Deaktiviert sämtliche Wellenform-Animationen, Graph-Physik-Federbewegungen und weiche Scroll-Übergänge sofort.
- **Sitzungs- & Entwurfsschutz (WCAG 2.2.6 Timeouts & 3.3.6 Error Prevention All AAA):**
  - Entwürfe im Chat und Notizen werden lokal gepuffert, sodass bei Sitzungsablauf (0 Datenverlust) kein geschriebener Text verloren geht.
  - Vor jedem destruktiven Vorgang (Notebook löschen, Konto löschen, API-Schlüssel widerrufen) schützt ein expliziter Bestätigungsdialog mit Rückgängig-/Export-Option.
- **Automatisierte Prüf-Gates:**
  - Statische Analyse durch **29 verschärfte WAI-ARIA-/JSX-Regeln in Biome** (`biome.json`).
  - Kontrast- und Landmark-Tests in Vitest (`a11y-baseline.test.ts`) sowie Ende-zu-Ende-Audits via `@axe-core/playwright`.
