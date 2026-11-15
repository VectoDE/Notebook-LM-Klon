# Browser- und Geräte-Kompatibilität

Stand: 13.11.2026. Bezug: Issue #255 (Entscheidung E37: aktuelle Chrome, Edge, Firefox, Safari; ältere Safari ab iOS 15; mobile Touch als eigenes Ziel).

## Automatisch geprüft

Stand: 15.11.2026. `apps/web/playwright.config.ts` hat 17 Projekte (15 davon im Job `e2e-matrix`; `chrome-dev` und `msedge-dev` nur im Nachtlauf). Der Job `e2e` führt die vollständige E2E-Suite nur in Chromium aus. Der Job `e2e-matrix` startet je Projekt einen eigenen Job (`fail-fast: false`, kein `allow-failure`, nichts übersprungen) mit den Specs `browser-matrix` (Darstellung je Design), `browser-zoom` (nur Desktop) und `browser-touch` (nur Touch-Geräte). Die Jobs laufen auf den von GitHub gestellten Runnern (öffentliches Repository, kostenlos): ubuntu für alle Projekte, zusätzlich windows (Chrome, Edge stable und Beta, Firefox) und macos (WebKit, Firefox, iPhone und iPad in Hoch- und Querformat). Keine selbst gehosteten Runner. Jede Spec ist per `testMatch` nur den Projekten zugeordnet, für die sie gilt.

| Projekt | Engine und Version | Gerät | Specs |
|---|---|---|---|
| chromium | Playwright-Chromium (aktuell) | Desktop | alle E2E-Specs |
| chrome | Google Chrome stable | Desktop | Matrix, Zoom |
| chrome-beta | Google Chrome Beta (kommende Version) | Desktop | Matrix, Zoom |
| msedge | Microsoft Edge stable | Desktop | Matrix, Zoom |
| msedge-beta | Microsoft Edge Beta (kommende Version) | Desktop | Matrix, Zoom |
| firefox | Playwright-Firefox (entspricht Firefox stable) | Desktop | Matrix, Zoom |
| webkit | Playwright-WebKit (Entwicklungsstand, oft vor Safari) | Desktop | Matrix, Zoom |
| phone-android, phone-android-landscape | Chromium, Pixel 7 | Telefon hoch, quer | Matrix, Touch |
| phone-ios, phone-ios-landscape | WebKit, iPhone 13 | Telefon hoch, quer | Matrix, Touch |
| tablet-ios, tablet-ios-landscape | WebKit, iPad Pro 11 | Tablet hoch, quer | Matrix, Touch |
| tablet-android, tablet-android-landscape | Chromium, Galaxy Tab S4 | Tablet hoch, quer | Matrix, Touch |

Die Matrix prüft je Design: Hell und Dunkel ohne Layoutfehler, keine Schrift unter 14 px, Seitentext mindestens 16 px; am Desktop 200 % Zoom (640 x 400 CSS-Pixel) ohne horizontalen Scroll in allen drei Bereichen; auf Touch-Geräten Wechsel der Bereiche per Tippen (untere Leiste, Reiter oder nebeneinanderliegende Spalten, je nach Breite), Bedienziele mindestens 44 x 44 px und Menü per Tippen.

## Was kostenlos nicht prüfbar ist (Lücken)

Quellen: Playwright-Dokumentation [Browsers](https://playwright.dev/docs/browsers) und [Emulation](https://playwright.dev/docs/emulation), Abruf 15.11.2026.

- **Ältere Versionen und ESR:** Playwright bindet jede Release an genau eine Fassung je Engine. Firefox entspricht dem aktuellen Firefox stable, WebKit dem Entwicklungsstand. Firefox ESR, Firefox Beta/Nightly, die vorige Safari-Hauptversion und ältere Chrome-/Edge-Fassungen sind damit nicht prüfbar. Playwright arbeitet nicht mit gebrandetem Firefox oder Safari.
- **Echtes Safari und iOS:** Die WebKit-Projekte prüfen die Engine, nicht Safari-Release, iOS-Version, Adressleiste oder Tastatur. Geräteprofile emulieren Größe, Touch und User-Agent, keine Hardware.
- **Samsung Internet, Firefox für Android, ältere Android-Versionen:** nicht abgedeckt.
- **Edge/Chrome Dev und Canary:** `chrome-dev` und `msedge-dev` laufen seit Issue #431 nächtlich im nicht blockierenden Workflow `e2e-matrix-nightly.yml` (zusammen mit Chrome/Edge Beta, WebKit und iPhone 13 auf macOS). Canary ist nicht aufgenommen, da instabil.

### Verbleibende Lücken (Stand 15.11.2026, Issue #431)

| Lücke | Warum kostenlos nicht prüfbar |
|---|---|
| Firefox ESR, Firefox Beta/Nightly | Playwright bindet Firefox an die Stable-Fassung eines Releases und unterstützt gebrandetes Firefox nicht. Eine eigene Mozilla-Installation im CI wäre ohne Playwright-Unterstützung fehleranfällig. |
| Echtes Safari, vorige Safari-Hauptversion, iOS | Playwright-WebKit ist nicht Safari (anderer Stand, keine Adressleiste, keine iOS-Tastatur). iPhone-Profile emulieren Größe, Touch und User-Agent, keine Hardware. |
| Samsung Internet | Kein Playwright-Kanal, nur auf echten Geräten oder in einer Gerätefarm. |
| Firefox für Android | Kein Playwright-Support. |
| Ältere Android-Versionen, echte Geräte | Playwright emuliert Android-Profile mit aktuellem Chromium. Ältere WebViews und Herstellerbrowser nur über Gerätefarm oder eigene Geräte. |

Der Nachtlauf schließt diese Lücken nicht. Optionen (nichts angemeldet): kostenlose Kontingente für Open-Source-Projekte bei Gerätefarmen (zum Beispiel BrowserStack Open Source; Voraussetzungen vorher beim Anbieter klären), Stichprobe auf eigenen Geräten vor Releases, Anpassung des Support-Ziels. Die Entscheidung liegt beim Inhaber, siehe Issue #431.

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
