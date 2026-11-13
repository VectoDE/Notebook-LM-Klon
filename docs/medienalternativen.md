# Medienalternativen: Untertitel, Transkript, Audiodeskription, Gebärdensprache

Stand: 2026-11-13, Issue #350. Dieses Dokument beschreibt, was RelationNotes für Audio- und
Videoinhalte anbietet, wie es geprüft wird und was für Deutsche Gebärdensprache (DGS) noch fehlt.
Es ist keine Rechtsberatung. Ob eine Pflicht nach BFSG oder BITV 2.0 besteht, klärt im
Einzelfall eine Anwältin oder ein Anwalt.

## 1. Welche Medien es gibt

| Medium | Wo | Ton | Bild |
| --- | --- | --- | --- |
| Video-Übersicht | Studio, Werkzeug „Video-Übersicht“ | Sprechertext je Folie (`spokenNarration`) | Folien mit Titel, Punkten, Diagramm, Quelle |
| Audio-Übersicht | Studio, Werkzeug „Audio-Übersicht“ | Gespräch der zwei Hosts | keins |
| Deep-Dive-Bühne | Studio, „Bühne“ | dasselbe Gespräch | Orb-Animation ohne Informationsgehalt |
| Antwort der Hosts | Audio-Übersicht nach einer Zwischenfrage | Antwort | steht als Text mit Quellen im Player |

README und Website enthalten keine Videos oder Tonaufnahmen. Kommen später welche hinzu, gelten
für sie dieselben Regeln wie hier.

## 2. Was umgesetzt ist

Alle Alternativen entstehen aus Daten, die das Studio ohnehin hat. Nichts wird übersetzt oder
dazuerfunden. Die Funktionen liegen in `packages/shared/src/media-alternatives.ts` und sind zu
100 % durch Tests abgedeckt.

| Alternative | Video-Übersicht | Audio-Übersicht | Bühne |
| --- | --- | --- | --- |
| Untertitel | Einblendung aus dem Sprechertext, höchstens 84 Zeichen je Untertitel, zeitlich anteilig verteilt; WebVTT-Spur `kind="captions"` am Tonelement | Transkript läuft mit (aktuelle Zeile markiert) | Live-Transkript |
| Transkript | Ansicht mit Kapitel, Sprechertext und Bildbeschreibung, Zeit als Sprungknopf | Ansicht mit Sprecher und Text | Live-Transkript |
| Download | `.txt`, Untertitel `.vtt`, Audiodeskription `.vtt` | `.txt`, Untertitel `.vtt` mit Stimmen (`<v Host Lea>`) | `.txt`, `.vtt` |
| Audiodeskription | Text (sichtbar und über eine Live-Region), Vorlesen per Web Speech API, WebVTT `kind="descriptions"` | nicht nötig (kein Bild) | nicht nötig (Orb trägt keine Information) |
| Gebärdensprache | Option für ein zweites Video (Bild im Bild), sobald eines hinterlegt ist | siehe Abschnitt 4 | siehe Abschnitt 4 |

Bedientexte gibt es auf Deutsch und Englisch. Inhalte tragen ihre eigene Sprache als
`lang`-Attribut (WCAG 3.1.2), die Demo-Inhalte sind deutsch.

### Audiodeskription und WCAG 1.2.5

Die Beschreibung einer Folie setzt sich zusammen aus der Bildbeschreibung des Storyboards, dem
Folientitel, allen Punkten, den Diagrammwerten und der Quelle. Damit ist alles, was nur im Bild
steht, auch hörbar oder lesbar. Zwei Wege, umschaltbar im Player:

1. **Text:** Knopf „Audiodeskription“ (Taste D). Die Beschreibung steht sichtbar unter der Folie
   und wird bei jedem Folienwechsel über eine Live-Region an Screenreader gemeldet.
2. **Vorlesen:** Knopf „Vorlesen“, nur wenn der Browser die Web Speech API hat. Beim
   Folienwechsel hält das Video an, die Beschreibung wird mit deutscher bzw. englischer Stimme
   vorgelesen, danach läuft es weiter. Das ist erweiterte Audiodeskription im Sinne von
   WCAG 1.2.7 (AAA). Wer selbst auf Pause oder Abspielen drückt, beendet das Warten.

Belege: E2E-Test `medienalternativen.spec.ts` („Audiodeskription als Text (Live-Region) und
vorgelesen mit Pause“) prüft Text, Stimme `de-DE`, Pause beim Wechsel und Weiterlaufen.
Die Spur `kind="descriptions"` wird im Test heruntergeladen und auf Zeiten und Inhalt geprüft.

## 3. Prüfung

- **axe** (`@axe-core/playwright` 4.14.0, Regeln WCAG 2.0/2.1/2.2 A und AA): Video-Player mit
  offenem Transkript und eingeschalteter Audiodeskription, Audio-Player mit Transkript und Bühne,
  in allen vier Designs, jeweils hell und dunkel. Erwartung: keine Verstöße.
- **Accessibility-Tree:** Playwright-Snapshots (`toMatchAriaSnapshot`) des Players und des
  Transkripts: Umschalter mit Zustand (`pressed`, `expanded`), Region „Transkript“ mit
  Überschrift, Liste, Sprungknöpfen und Absätzen. So sieht ein Screenreader die Struktur.
- **Nicht gemacht:** Ein Durchgang mit echtem Screenreader (NVDA, JAWS, VoiceOver, TalkBack)
  durch eine Person. Der Accessibility-Tree zeigt, was ein Screenreader bekommt, nicht wie er es
  vorliest. Dieser Durchgang steht im Issue als offene Aufgabe.

## 4. Gebärdensprache (DGS): Konzept

### 4.1 Anforderung

WCAG 1.2.6 (AAA) verlangt Gebärdensprache für aufgezeichnete Audioinhalte in synchronisierten
Medien. Für öffentliche Stellen in Deutschland verlangt § 4 BITV 2.0 auf der Startseite
Erläuterungen in DGS zu Inhalt, Navigation, Erklärung zur Barrierefreiheit und weiteren
Informationen ([gesetze-im-internet.de, § 4 BITV 2.0](https://www.gesetze-im-internet.de/bitv_2_0/__4.html)).
RelationNotes ist keine öffentliche Stelle; die Vorgabe dient hier als Maßstab für gute Praxis.

### 4.2 Was sich übersetzen lässt und was nicht

| Inhalt | Art | DGS sinnvoll? |
| --- | --- | --- |
| Startseite, Hilfe, Erklärung zur Barrierefreiheit | statisch, ändert sich selten | ja, als aufgezeichnetes Video einer Dolmetscherin oder eines Dolmetschers |
| Erklärvideo zum Produkt (falls es eines gibt) | statisch | ja, als zweite Videospur |
| Video- und Audio-Übersichten der Nutzer | entstehen pro Notebook neu aus eigenen Quellen | mit Menschen nicht machbar (jede Übersicht ist neu); Avatar siehe 4.4 |
| Antworten der Hosts | live | nein; Text und Transkript decken das ab |

### 4.3 Umsetzung im Player (fertig)

Das Storyboard hat ein optionales Feld `signLanguageVideo` mit `url` und `language`
(Standard `gsg`, ISO 639-3 für Deutsche Gebärdensprache). Ist es gesetzt, zeigt der Player den
Umschalter „Gebärdensprache“. Das Video erscheint dann unten rechts in der Bildfläche (Bild im
Bild), ohne Ton, mit Untertitelspur, und folgt Start, Pause und Sprüngen des Players. Ohne
Eintrag steht im Player offen: „Für diese Übersicht ist noch kein Video in Deutscher
Gebärdensprache hinterlegt. Transkript und Untertitel enthalten den vollständigen Inhalt.“

Geprüft wird das mit einer Prüfseite (`apps/web/e2e/fixtures/sign-language.html`), die einen
selbst erzeugten, einfarbigen Platzhalter als Video einsetzt. Das ist kein DGS-Inhalt.

### 4.4 Avatare: Bewertung

| Ansatz | Stand | Bewertung |
| --- | --- | --- |
| Aufnahme mit DGS-Dolmetscher | etabliert | beste Qualität; für statische Inhalte der richtige Weg |
| Avatar aus Text (z. B. Forschungsprojekt AVASAG, 2020–2023, BMBF-gefördert) | Demonstrator für Reiseinformationen; rund 70 taube Testpersonen fanden die Gebärden verständlich, Skepsis bleibt ([idw, TH Köln](https://idw-online.de/de/news830493), [techbook](https://www.techbook.de/pc-mac/web-pc-mac/avasag-gebaerdensprache-avatar)) | für eng umrissene, wiederkehrende Texte denkbar, nicht für frei erzeugte Zusammenfassungen |
| Kommunale Avatar-Angebote auf Basis von AVASAG | einzelne Städte im Einsatz ([kommunal.de](https://kommunal.de/ki-avatar-gebaerdensprache-stadtverwaltung)) | kostenpflichtig, Inhalte vorab geprüft |

Der Weltverband der Gehörlosen (WFD) und der Weltverband der Gebärdensprachdolmetscher (WASLI)
raten davon ab, Avatare als Ersatz für menschliche Gebärdende einzusetzen, vor allem bei
komplexen oder wichtigen Inhalten
([WFD/WASLI-Stellungnahme 2018](https://wfdeaf.org/wp-content/uploads/WFD-and-WASLI-Statement-on-Avatar-FINAL-14032018-Updated-14042018.pdf)).
Die Video-Übersichten fassen Quellen zusammen, die Nutzer selbst hochladen. Ein Avatar, der dort
Fehler macht, verfälscht Inhalte. **Empfehlung:** kein Avatar für Übersichten. DGS-Videos für
die statischen Inhalte aus 4.2 aufnehmen lassen.

### 4.5 Inhaber-Schritt: Aufnahme beauftragen

1. Texte festlegen: Startseite, Kurzanleitung, Erklärung zur Barrierefreiheit (je höchstens
   wenige Minuten).
2. Angebote von DGS-Dolmetscherinnen oder -Dolmetschern einholen, idealerweise mit tauber
   Gebärdensprachberatung zur Abnahme. Zur Orientierung: Für gerichtlich herangezogene
   Dolmetscher sieht § 9 Abs. 5 JVEG 93 Euro je Stunde vor
   ([gesetze-im-internet.de, § 9 JVEG](https://www.gesetze-im-internet.de/jveg/__9.html)).
   Private Aufträge mit Studio und Schnitt kosten in der Regel mehr; Angebote einholen.
3. Nutzungsrechte für Web und Wiedergabe in der App schriftlich vereinbaren.
4. Videos als WebM oder MP4 ablegen und `signLanguageVideo.url` setzen. Der Player bietet die
   Option dann automatisch an.

Kosten und Vertrag sind Sache des Inhabers. Dieses Repository legt keine Videos von Personen ab,
ohne dass deren Einwilligung vorliegt.
