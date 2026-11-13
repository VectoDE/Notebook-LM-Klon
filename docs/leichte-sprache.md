# Leichte Sprache (Issue #349)

Stand: 13.11.2026. RelationNotes hat eine dritte Sprachstufe: **Deutsch – Leichte Sprache**. Sie gilt für die
ganze Oberfläche und lässt sich in den Einstellungen unter „Sprache“ wählen (Deutsch, Deutsch – Leichte Sprache,
English). Dieses Dokument beschreibt Technik, Regeln, die Selbstprüfung und was noch aussteht.

> **Wichtig:** Die Texte sind **nicht** von einer Prüfgruppe (Menschen mit Lernschwierigkeiten) geprüft. Das
> Projekt führt deshalb **kein** Siegel oder Prüfzeichen für Leichte Sprache und behauptet keine geprüfte
> Leichte Sprache. Die Prüfung durch eine Prüfgruppe ist ein offener Inhaber-Schritt (siehe unten).

## Technik

| Baustein | Datei | Aufgabe |
| --- | --- | --- |
| Katalog | `apps/web/src/locales/de-x-ls.json` | Alle 604 Oberflächenschlüssel in Leichter Sprache, `$meta.fallback: ["de"]`. |
| Sprachwahl | `apps/web/src/theme-preferences.ts` (`LANGUAGES`) | `de`, `de-x-ls`, `en`; gespeichert unter `rn_language`. |
| Nachladen | `apps/web/src/locale-registry.ts` (`createLocaleRegistry`, `LOCALE_LOADERS`) | Der Katalog ist ein eigener Chunk (rund 35 kB, gzip rund 12 kB) und lädt erst bei Wahl der Sprache. Das Start-Bundle bleibt unter dem Lighthouse-Skriptbudget. |
| Dokumentsprache | `documentLanguage()` | `<html lang="de">` auch in Leichter Sprache, damit Screenreader die deutsche Stimme und Aussprache nutzen. Die Wahl steht zusätzlich in `<html data-language="de-x-ls">`. |
| Kommentare | `apps/web/src/translations-comments.ts` (`commentTexts`) | Der nachgeladene Kommentar-Katalog übernimmt die Leichte-Sprache-Texte einzeln. |
| KI-Antworten | `WorkspaceLayout.tsx` | Der Chat fragt die KI weiter auf Deutsch an. Leichte Sprache gilt für die Oberfläche, nicht für erzeugte Antworten. |

Der Rückfall auf Deutsch je Schlüssel (`de-x-ls` → `de` → `en`) ist nur Sicherheitsnetz: Bis der Katalog geladen ist
(oder wenn das Laden scheitert), erscheinen die deutschen Texte. Ein Test stellt sicher, dass der Katalog jeden
deutschen Schlüssel selbst enthält.

### Tests

- `apps/web/src/__tests__/leichte-sprache.test.ts`: Abdeckung 100 % gegen den deutschen Katalog (Haupt- und
  Kommentar-Katalog), keine fremden Schlüssel, **ein Test je Schlüssel** (604) mit Platzhaltern und den prüfbaren
  Regeln unten; Umschalter in den Einstellungen; Kommentar-Texte.
- `apps/web/src/__tests__/i18n.test.ts`: Nachladen einmalig, Rückfall vor dem Laden, neuer Versuch nach Ladefehler.
- `apps/web/e2e/leichte-sprache.spec.ts`: In allen vier Designs bei 1440 und 390 px: Umschalten, `lang="de"`,
  Katalog erst nach der Wahl angefragt, kein Überlauf und kein abgeschnittener Text in Einstellungen, Kopf,
  Menü, allen drei Bereichen; dazu jede Studio-Ansicht, Teilen und Konto bei 1440 und 390 px und die Prüfung
  „sichtbare Beschriftung steht am Anfang des zugänglichen Namens“ (WCAG 2.5.3).

## Grundlagen

- Netzwerk Leichte Sprache e. V.: *Die Regeln für Leichte Sprache* (Regelwerk, abgerufen am 13.11.2026 als PDF
  „Regelwerk_NLS_web“ von netzwerk-leichte-sprache.de). Regeln W1–W12 (Wörter), Z1–Z9 (Zahlen und Zeichen),
  S1–S4 (Sätze), T1–T5 (Texte), G1–G17 (Gestaltung).
- DIN SPEC 33429:2025-03 *Empfehlungen für Deutsche Leichte Sprache* (DIN Media, kostenlos). Eine DIN SPEC ist
  keine Norm, sondern eine Empfehlung einer Arbeitsgruppe. Die Einzelregeln wurden für dieses Projekt **nicht im
  Wortlaut** gegen die DIN SPEC abgeglichen; die Checkliste folgt dem Regelwerk des Netzwerks und den Vorgaben
  des Inhabers. Ein Abgleich mit der DIN SPEC gehört zur ausstehenden Prüfung.
- BITV 2.0 verlangt Leichte Sprache für Informationen öffentlicher Stellen; RelationNotes ist keine öffentliche
  Stelle. Das Angebot ist freiwillig.

**Abweichung, bewusst:** Das Netzwerk trennt lange Wörter mit Bindestrich (Regel W5: „Bundes-Gleichstellungs-Gesetz“).
Der Inhaber hat den **Mediopunkt** festgelegt („Lern·karten“, zweiter Teil klein). Er lässt die Rechtschreibung des
Wortes unverändert (Forschungsstelle Leichte Sprache, Universität Hildesheim). Screenreader lesen „·“ in der
Grundeinstellung meist nicht vor; das muss die Prüfung mit NVDA, JAWS und VoiceOver bestätigen.

## Regel-Checkliste

**A** = automatisch je Schlüssel geprüft (Test schlägt fehl), **H** = beim Schreiben und in einer zweiten Lesung von Hand
geprüft, nicht automatisierbar.

| Nr | Regel | Quelle | Prüfung |
| --- | --- | --- | --- |
| 1 | Kurze Sätze, höchstens 15 Wörter je Satz (Ziel 12) | NLS S1 | A: Wortzahl je Satz |
| 2 | Ein Gedanke je Satz, keine Neben-Sätze | NLS S1, S4 | A: Komma vor weil, dass, damit, obwohl, falls, nachdem, sodass, wenn, welche; H: Relativsätze |
| 3 | Aktiv statt Passiv, Verben statt Haupt-Wörter | NLS W7, W8 | H |
| 4 | Kein Konjunktiv | NLS W10 | A: würde, könnte, hätte, wäre, müsste, sollte |
| 5 | Kein Genitiv | NLS W9 | H |
| 6 | Positive Sprache, keine Verneinungsketten | NLS W11 | A: höchstens eine Verneinung je Satz, kein „weder … noch“ |
| 7 | Lange Wörter gliedern | NLS W5, Inhaber: Mediopunkt | A: Wörter über 16 Buchstaben brauchen „·“ (Ausnahme: Markennamen) |
| 8 | Keine Abkürzungen | NLS W6 | A: z. B., d. h., bzw., ggf., usw., u. a., inkl., ca., evtl., etc. |
| 9 | Fremd- und Fachwörter erklären oder ersetzen | NLS W3 | H: Wortliste unten; Erklärungen in Hinweis- und Beschreibungstexten |
| 10 | Immer dasselbe Wort für dieselbe Sache | NLS W4 | H: Abgleich über den ganzen Katalog, Wortliste |
| 11 | Anrede „Sie“ | NLS T1 | H |
| 12 | Kein Semikolon, möglichst keine Klammern, keine Fragen im Fließtext | NLS Z9, T3 | A: Semikolon; H: Klammern, Fragen |
| 13 | Zahlen als Ziffern | NLS Z1 | H |
| 14 | Platzhalter und Belegmarken unverändert | Technik | A: gleiche Platzhalter je Schlüssel; H: Belegmarke [1] in `chatWelcome` |
| 15 | Beschriftungen passen auf Knöpfe | Layout | A: kurze Beschriftungen höchstens 1,6-mal so lang; E2E ohne Überlauf |
| 16 | Sichtbare Beschriftung am Anfang des zugänglichen Namens | WCAG 2.5.3 | A: E2E in allen Bereichen und Studio-Ansichten |
| 17 | Sachlich gleich wie das Original (Datenschutz, Recht, Fristen) | Inhaber | H: zweite Lesung aller `policy*`, `aiAct*`, `gdpr*`, `prov*`, `signIn*` |
| 18 | Verständlich für die Zielgruppe | NLS „Prüfen“ | **offen:** nur eine Prüfgruppe kann das bestätigen |

## Selbstprüfung (was wirklich geprüft wurde)

Die Texte hat der Entwicklungs-Agent erstellt, nicht ein ausgebildetes Übersetzungsbüro. Ablauf:

1. Fünf Teilkataloge übertragen, jeder gegen die Regeln oben und ein Prüfskript (gleiche Regeln wie der Test).
2. Zweite Lesung über den ganzen Katalog durch einen getrennten Prüfdurchgang: Einheitlichkeit der Begriffe
   (38 Schlüssel angeglichen), Relativsätze, Passiv, Fremdwörter, sachliche Treue der Datenschutz- und Rechtstexte.
3. Automatische Prüfung je Schlüssel im Test (604 Tests, alle grün) und E2E-Prüfung der Darstellung und der
   zugänglichen Namen (in der E2E-Prüfung gefundene 10 Namen angepasst, etwa „Bestätigen: {name}“).

Ergebnis: 604 von 604 Schlüsseln übertragen, 211 davon unverändert (schon leicht, etwa „Quellen“, „Chat“), Texte im
Mittel 1,29-mal so lang wie Deutsch, 104 Texte mit Mediopunkt.

**Nicht geprüft:** Verständlichkeit für Menschen mit Lernschwierigkeiten (Prüfgruppe), Abgleich mit der DIN SPEC 33429
im Wortlaut, Vorlesen mit Screenreadern (Mediopunkt), Rechtstexte durch einen Anwalt. KI-Antworten im Chat und
erzeugte Inhalte (Audio, Quiz, Lernkarten) sind **nicht** in Leichter Sprache. Bilder und Symbole zur Erklärung
(NLS G-Regeln) sind nicht ergänzt.

Bekannte Zweifel aus der Selbstprüfung:

- „Deep Dive“ heißt „Genau erklärt“, „Briefing“ „Kurz·bericht“, „Timeline“ „Zeit·leiste“: freie Übertragungen.
- „Owner“ heißt „Besitzer“ (deutsch „Inhaber“), „Viewer“ heißt „Leser“; die Rechte der Rollen sind nicht erklärt,
  weil der Katalog dafür keinen Hinweistext hat.
- „Notebook“ bleibt ohne Erklärung als Arbeits·mappe, aus demselben Grund.
- Die DSGVO heißt vereinfacht „Gesetz von der EU“ (rechtlich eine Verordnung).
- Vorschlagsfragen an die KI (`chatChip1`–`chatChip3`) sind umformuliert; die KI bekommt damit leichtere Fragen.

## Inhaber-Schritt: Prüfung durch eine Prüfgruppe

Nach dem Netzwerk Leichte Sprache ist ein Text erst Leichte Sprache, wenn Prüferinnen und Prüfer aus der Zielgruppe
ihn verstanden haben. Das kann der Entwicklungs-Agent nicht leisten. Vorschlag:

1. Prüfbüro beauftragen (etwa über das Netzwerk Leichte Sprache oder eine Lebenshilfe-Einrichtung). Kosten und
   Vertrag sind Sache des Inhabers.
2. Prüfgegenstand: die laufende App in Leichter Sprache, nicht nur die JSON-Datei; Schwerpunkte Einstellungen,
   Quellen, Chat, Studio, Fehlermeldungen, Datenschutzangaben.
3. Ergebnisse als Änderungen an `de-x-ls.json` übernehmen; die Tests sichern Platzhalter und Regeln.
4. Erst danach darf ein Prüfsiegel gezeigt werden, und nur das, was die Prüfstelle tatsächlich vergibt.

## Wortliste

Begriffe, die überall gleich übertragen sind:

| Begriff im Original | Wort in Leichter Sprache |
| --- | --- |
| Quelle / Quellen | Quelle / Quellen |
| hochladen | in die App laden |
| Notebook | Notebook |
| Chat | Chat |
| Chat-Verlauf | Bisheriger Chat |
| Studio | Studio |
| Panel | Bereich |
| Lernkarten / Lernkartei | Lern·karten |
| Vorderseite / Rückseite | Vorder·seite / Rück·seite |
| Quiz / Wissens-Quiz | Quiz |
| Mindmap / Wissens-Mindmap | Mindmap |
| Baumliste | Liste |
| Briefing | Kurz·bericht |
| Timeline | Zeit·leiste |
| Infografik | Infografik |
| Datentabelle | Daten·tabelle |
| Audio-Überblick / Audio Overview | Überblick als Audio |
| Video-Überblick | Überblick als Video |
| Hosts / Podcast-Hosts | Sprecher |
| Zwischenfrage | Frage |
| Beitreten / Frage stellen | Mitreden und fragen |
| Bühne / Stage | Bühne |
| Deep Dive | Genau erklärt |
| Wissensgraph / Graph | Wissens·netz |
| Beziehungsgraph | Wissens·netz mit Personen, Organisationen und Themen |
| Knoten | Punkt (Begriffe und Quellen) / Eintrag (Personen, Organisationen, Themen) |
| Legende | Erklärung |
| durchgezogen / gestrichelt | volle Linie / Strich·linie |
| Prüfstatus | Stand der Prüfung |
| berichtigen | verbessern |
| wiederherstellen | zurückholen |
| Zitat (Quellenverweis mit Nummer, citation) | Beleg |
| Zitat (wörtlicher Text, quote) | Zitat |
| Originalzitat | Original·text |
| Quellenangabe | Quellen·angabe |
| URL | Internet·adresse (Feldname bleibt „URL“) |
| importieren | hinzufügen |
| exportieren / herunterladen / sichern | als Datei speichern |
| Exportiert am | Gespeichert am |
| Download gestartet | Die App lädt die Datei auf Ihr Gerät |
| synchronisieren | online speichern |
| offline | ohne Internet |
| lokal gesichert | auf diesem Gerät gespeichert |
| Darstellung | Aussehen |
| Design | Stil |
| Farbschema | Farben |
| Hoher Kontrast (AAA) | Starker Kontrast |
| Animationen | bewegte Bilder |
| einklappen / ausklappen | verstecken / zeigen |
| eingeklappt / ausgeklappt | versteckt / zu sehen |
| ausblenden | verstecken |
| Eigentümer / Inhaber (Rolle) | Besitzer |
| Bearbeiten / Bearbeiter (Rolle) | Bearbeiter |
| Betrachten / Betrachter (Rolle) | Leser |
| Freigabe | Teilen |
| Anmeldelink | Anmelde·link |
| Passkey | Passkey (digitaler Schlüssel) |
| Bot-Prüfung | Prüfung auf Bots |
| Inhaltsblocker | Werbe·blocker |
| Server | Server (Computer im Internet, der die App betreibt) |
| Browser | Browser (Ihr Programm für das Internet) |
| Screenreader | Screen·reader (Programm, das den Bild·schirm vorliest) |
| Audiodeskription | Hör·beschreibung |
| Untertitel | Unter·titel |
| Eingabe / Enter | Eingabe·taste |
| Leertaste | Leer·taste |
| Pfeiltasten | Pfeil·tasten |
| Pausieren / pausiert | Anhalten / angehalten |
| Erneut versuchen | Noch einmal versuchen |
| Fehler | Fehler |
| KI / KI-generiert | KI (Künstliche Intelligenz) / Von KI gemacht |
| KI-Modell | KI-Modell |
| API-Schlüssel (BYOK) | Eigene Schlüssel für KI-Anbieter |
| verschlüsselt | geschützt (Fach·wort: verschlüsselt) |
| Training | Training (Die KI lernt aus den Eingaben) |
| Feedback | Rück·meldung |
| Signatur / signiert | Unterschrift / mit Unterschrift |
| C2PA-Herkunftsnachweis | C2PA-Herkunfts·nachweis (digitale Unterschrift) |
| Metadaten | Meta·daten (Zusatz·angaben in der Datei) |
| Rechtsberatung | Beratung zum Recht |
| DSGVO | DSGVO (Gesetz von der EU zum Daten·schutz) |
| EU AI Act | EU AI Act (Gesetz von der EU für KI) |
| EWR | EWR (Europäischer Wirtschafts·raum) |
| Einstellungen | Einstellungen |
| Arbeitsbereich | Arbeits·bereich |
