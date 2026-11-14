# Browser- und Geräte-Kompatibilität

Stand: 13.11.2026. Bezug: Issue #255 (Entscheidung E37: aktuelle Chrome, Edge, Firefox, Safari; ältere Safari ab iOS 15; mobile Touch als eigenes Ziel).

## Automatisch geprüft

`apps/web/playwright.config.ts` hat fünf Projekte. Chromium führt alle E2E-Prüfungen aus, die übrigen vier die Browser-Matrix `apps/web/e2e/browser-matrix.spec.ts`:

| Projekt | Engine | Entspricht | Geprüft |
|---|---|---|---|
| chromium | Chromium | Chrome, Edge | alle E2E-Specs |
| firefox | Gecko | Firefox | Matrix |
| webkit | WebKit | Safari (Desktop) | Matrix |
| mobile-chrome | Chromium, Pixel 7, Touch | Chrome auf Android | Matrix |
| mobile-safari | WebKit, iPhone 13, Touch | Safari auf iOS | Matrix |

Die Matrix prüft je Design: Hell und Dunkel ohne Layoutfehler, keine Schrift unter 14 px, Seitentext mindestens 16 px; am Desktop 200 % Zoom (640 x 400 CSS-Pixel) ohne horizontalen Scroll in allen drei Bereichen; auf Touch-Geräten Bereichswechsel per Tippen, Menü per Tippen, Bedienziele im Kopf und in der unteren Leiste mindestens 44 x 44 px.

Grenze: Playwright-WebKit ist die aktuelle WebKit-Engine, nicht ein bestimmtes Safari-Release. Ein echter Test auf iOS 15 braucht ein Gerät oder einen Gerätedienst und ist damit nicht automatisiert.

## Safari 15: Befund

Die Oberfläche nutzt Funktionen, die erst nach Safari 15.0 erschienen sind. Versionsangaben nach caniuse.com bzw. MDN (Abruf 13.11.2026):

| Funktion | Verwendung | Safari ab | Folge in Safari 15 |
|---|---|---|---|
| `<dialog>` mit `showModal()` | alle Dialoge, Menü-Sheet | 15.4 ([caniuse](https://caniuse.com/dialog)) | 15.0 bis 15.3: Dialoge öffnen nicht modal |
| `:has()` | Auswahlzustände (`.rn-choice`, `.rn-segment`, Fokus in Feldern) | 15.4 ([caniuse](https://caniuse.com/css-has)) | 15.0 bis 15.3: Markierung der gewählten Option fehlt |
| `dvh` | Höhe der Arbeitsfläche, Dialoge | 15.4 ([caniuse](https://caniuse.com/viewport-unit-variants)) | 15.0 bis 15.3: Höhe fällt weg, Layout bricht |
| `Array.prototype.findLastIndex` | Mitlesetext (LiveLyrics) | 15.4 ([caniuse](https://caniuse.com/mdn-javascript_builtins_array_findlastindex)) | 15.0 bis 15.3: Laufzeitfehler im Audio-Player |
| `@container` | Karten und Leerzustände | 16.0 ([caniuse](https://caniuse.com/css-container-queries)) | Container-Regeln greifen nicht, Grundlayout bleibt |
| `color-mix()` | 24 Stellen in `themes.css` und `workspace.css` | 16.2 ([caniuse](https://caniuse.com/mdn-css_types_color_color-mix)) | Deklaration ungültig, Fläche fällt auf den geerbten Wert zurück; Kontrast dort nicht geprüft |
| `@property` | weiche Ränder an Scrollbereichen | 16.4 ([caniuse](https://caniuse.com/mdn-css_at-rules_property)) | Übergang fehlt, rein dekorativ |
| Build-Ziel `es2022` | `vite.config.ts` | Klassen-`static`-Blöcke erst 16.4 | nicht geprüft, ob das Bundle solche Blöcke enthält |

**Ergebnis:** Safari 15.0 bis 15.3 ist nicht unterstützt. Safari 15.4 bis 15.6 läuft voraussichtlich mit Einschränkungen (fehlende Container-Regeln, getönte Flächen ohne Farbe); das ist nicht gemessen. Für echte Unterstützung ab iOS 15 bräuchte es Ersatzwerte vor jedem `color-mix()`, ein Build-Ziel `safari15` und eine Prüfung auf einem Gerät mit iOS 15.4 oder neuer. Die Entscheidung, ob das Ziel "Safari ab iOS 15" bleibt oder auf iOS 16.4 angehoben wird, liegt beim Inhaber (Issue #255).
