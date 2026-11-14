# Design-Recherche: 53 öffentliche Startseiten

Stand: 13.11.2026. Bezug: Issue #250, Grundlage für die vier Designs (#251).

Diese Datei enthält nur eigene Messwerte und eigene Einschätzungen. Es gibt keine Screenshots, Logos, Texte oder Farbwerte der untersuchten Seiten im Repository. Firmennamen und Adressen dienen allein der Nachvollziehbarkeit.

## Vorgehen

**Auswahl:** 53 Startseiten in vier Gruppen zu je 13 bis 14 Seiten: Tech-Konzerne, Hoster und Cloud-Anbieter, Start-ups und Produktfirmen, Beratungen und Agenturen. Wo es eine deutsche Fassung gibt, wurde sie aufgerufen.

**Messung:** Ein eigenes Skript mit Playwright (Chromium 1254, Windows 11, Netz des Inhabers) hat jede Seite am 13.11.2026 zweimal geladen: Desktop 1366 x 900 und mobil 390 x 844 (Touch, Gerätepixelverhältnis 3). Gemessen wurde nach dem `load`-Ereignis plus 2,5 s:

| Kriterium | Messgröße |
|---|---|
| Lesbarkeit und Kontrast | Kontrast jedes sichtbaren Textelements zur ersten deckenden Hintergrundfarbe (WCAG-Formel), Median und Minimum, Anteil der Elemente mit mindestens 7:1 (AAA) |
| Mobile Bedienbarkeit | horizontaler Scroll bei 390 px, Anteil der Bedienelemente unter 24 x 24 px (WCAG 2.2 SC 2.5.8), Schriftgröße des ersten Absatzes |
| Geschwindigkeit | Largest Contentful Paint (LCP) Desktop und mobil, übertragene Datenmenge und Zahl der Anfragen |
| Wiedererkennbarkeit | nicht messbar; eigene Einschätzung in der Auswertung, ausdrücklich als solche gekennzeichnet |

Zusätzlich lief Lighthouse (Chrome DevTools, Gerät mobil, Kategorien Barrierefreiheit, Best Practices, SEO; ohne Leistung) für fünf Seiten der engeren Wahl.

**Grenzen der Messung**

- Einmalige Messung, ein Standort, ein Netz. LCP-Werte schwanken; sie zeigen Größenordnungen, keine Rangfolge auf die Zehntelsekunde.
- Cookie-Banner wurden nicht weggeklickt. Sie gehen in Kontrast und LCP ein, so wie sie ein Erstbesucher sieht.
- Text auf Bildern oder Verläufen ist nicht messbar und fehlt in der Kontrastzählung.
- **(B)** Die Seite hat eine Bot-Zwischenseite oder Weiterleitung geliefert (1 bis 7 Anfragen, wenige KB). Die Werte beschreiben diese Zwischenseite, nicht die echte Startseite.
- **(H)** Der Hintergrund lag nicht als Farbe am Element (z. B. Farbe nur auf dem Canvas, Überlagerungen) oder es gab nur sehr wenige messbare Textelemente. Die Kontrastwerte dieser Zeilen sind nicht belastbar.
- McKinsey hat die automatisierte Abfrage abgewiesen (HTTP/2-Fehler); keine Werte.

## Messwerte

Spalten: Kontrast Median / Minimum (Desktop), Anteil Text mit 7:1 (Desktop), horizontaler Scroll mobil, Anteil zu kleiner Bedienziele mobil, Absatzschrift mobil in px, LCP Desktop / mobil in s, Datenmenge und Anfragen (Desktop).

| Seite | Kategorie | URL | Abruf | Kontrast | 7:1 | H-Scroll | Ziele < 24 px | Absatz px | LCP s | Daten / Anfragen |
|---|---|---|---|---|---|---|---|---|---|---|
| Apple | Tech-Konzern | https://www.apple.com/de/ | 2026-11-13 | 8,9:1 / 4,7:1 | 55 % | nein | 0 % | 19 | 1,8 / 1,2 | 2876 KB / 56 |
| Microsoft | Tech-Konzern | https://www.microsoft.com/de-de | 2026-11-13 | 15,1:1 / 1,1:1 | 73 % | nein | 18 % | 13 | 2,7 / 2,9 | 1854 KB / 201 |
| IBM | Tech-Konzern | https://www.ibm.com/de-de | 2026-11-13 | 16,5:1 / 1,0:1 | 86 % | nein | 42 % | 20 | 3,4 / 2,9 | 2250 KB / 211 |
| SAP (B) | Tech-Konzern | https://www.sap.com/germany/index.html | 2026-11-13 | 21,0:1 / 21,0:1 | 100 % | nein | 6 % | 12 | 0,1 / 2,0 | 1 KB / 1 |
| Adobe (B) | Tech-Konzern | https://www.adobe.com/de/ | 2026-11-13 | 21,0:1 / 21,0:1 | 100 % | nein | – | 16 | 0,1 / 0,1 | 1 KB / 1 |
| Salesforce (B) | Tech-Konzern | https://www.salesforce.com/de/ | 2026-11-13 | 21,0:1 / 21,0:1 | 100 % | nein | – | 16 | 0,1 / 0,1 | 1 KB / 1 |
| Oracle | Tech-Konzern | https://www.oracle.com/de/ | 2026-11-13 | 18,2:1 / 6,0:1 | 98 % | nein | 0 % | 16 | 0,9 / 1,1 | 1490 KB / 51 |
| Intel | Tech-Konzern | https://www.intel.de/content/www/de/de/homepage.html | 2026-11-13 | 5,0:1 / 1,0:1 | 36 % | nein | 9 % | 14 | 0,5 / 0,4 | 1166 KB / 81 |
| NVIDIA | Tech-Konzern | https://www.nvidia.com/de-de/ | 2026-11-13 | 17,4:1 / 1,0:1 | 94 % | nein | 7 % | 12 | 3,9 / 0,9 | 3361 KB / 55 |
| Samsung (H) | Tech-Konzern | https://www.samsung.com/de/ | 2026-11-13 | 1,0:1 / 1,0:1 | 35 % | nein | 2 % | 14 | 0,6 / 0,5 | 1950 KB / 92 |
| Atlassian | Tech-Konzern | https://www.atlassian.com/de | 2026-11-13 | 7,4:1 / 1,1:1 | 83 % | nein | 17 % | 14 | 1,6 / 1,0 | 644 KB / 149 |
| Cisco | Tech-Konzern | https://www.cisco.com/site/de/de/index.html | 2026-11-13 | 17,8:1 / 5,1:1 | 83 % | nein | 32 % | 14 | 0,5 / 0,4 | 1506 KB / 85 |
| Siemens (B) | Tech-Konzern | https://www.siemens.com/de/de.html | 2026-11-13 | 17,6:1 / 3,4:1 | 80 % | nein | 5 % | 16 | 0,7 / 2,9 | 3 KB / 7 |
| Cloudflare | Hoster/Cloud | https://www.cloudflare.com/de-de/ | 2026-11-13 | 13,0:1 / 9,4:1 | 100 % | nein | 10 % | 16 | 0,6 / 1,6 | 408 KB / 6 |
| AWS | Hoster/Cloud | https://aws.amazon.com/de/ | 2026-11-13 | 14,3:1 / 4,8:1 | 90 % | ja | 14 % | 14 | 1,3 / 1,0 | 83 KB / 138 |
| Google Cloud | Hoster/Cloud | https://cloud.google.com/?hl=de | 2026-11-13 | 6,0:1 / 1,0:1 | 24 % | nein | 20 % | 16 | 0,8 / 0,7 | 553 KB / 100 |
| Microsoft Azure | Hoster/Cloud | https://azure.microsoft.com/de-de/ | 2026-11-13 | 14,1:1 / 4,5:1 | 81 % | nein | 23 % | 13 | 1,0 / 1,0 | 2049 KB / 159 |
| DigitalOcean | Hoster/Cloud | https://www.digitalocean.com/ | 2026-11-13 | 17,5:1 / 6,0:1 | 98 % | nein | 8 % | 14 | 0,8 / 0,7 | 1429 KB / 149 |
| Hetzner | Hoster/Cloud | https://www.hetzner.com/de/ | 2026-11-13 | 11,7:1 / 1,0:1 | 91 % | nein | 5 % | 10 | 0,5 / 0,5 | 1391 KB / 68 |
| IONOS | Hoster/Cloud | https://www.ionos.de/ | 2026-11-13 | 10,1:1 / 1,0:1 | 63 % | nein | 37 % | 16 | 1,0 / 0,9 | 2254 KB / 180 |
| Vercel | Hoster/Cloud | https://vercel.com/ | 2026-11-13 | 17,2:1 / 8,1:1 | 100 % | nein | 0 % | 16 | 0,6 / 0,5 | 1376 KB / 96 |
| Netlify | Hoster/Cloud | https://www.netlify.com/ | 2026-11-13 | 11,5:1 / 5,5:1 | 84 % | nein | 19 % | 14 | 0,4 / 0,6 | 1464 KB / 81 |
| Fly.io | Hoster/Cloud | https://fly.io/ | 2026-11-13 | 13,6:1 / 5,5:1 | 89 % | nein | 5 % | 12 | 0,7 / 0,6 | 1603 KB / 41 |
| Render | Hoster/Cloud | https://render.com/ | 2026-11-13 | 15,9:1 / 3,4:1 | 79 % | nein | 21 % | 20 | 0,6 / 1,6 | 2386 KB / 152 |
| OVHcloud | Hoster/Cloud | https://www.ovhcloud.com/de/ | 2026-11-13 | 6,8:1 / 4,0:1 | 42 % | nein | 2 % | 16 | 1,2 / 0,4 | 1931 KB / 134 |
| Scaleway | Hoster/Cloud | https://www.scaleway.com/en/ | 2026-11-13 | 17,1:1 / 8,0:1 | 100 % | nein | 9 % | 16 | 0,2 / 1,4 | 26 KB / 16 |
| Linear | Start-up/Produkt | https://linear.app/ | 2026-11-13 | 13,6:1 / 3,4:1 | 54 % | nein | 79 % | 15 | 2,2 / 2,1 | 440 KB / 251 |
| Notion | Start-up/Produkt | https://www.notion.com/de | 2026-11-13 | 19,9:1 / 1,0:1 | 67 % | nein | 0 % | 14 | 0,6 / 0,4 | 1438 KB / 141 |
| Figma | Start-up/Produkt | https://www.figma.com/de-de/ | 2026-11-13 | 21,0:1 / 1,0:1 | 95 % | nein | 20 % | 14 | 2,0 / 2,0 | 2352 KB / 76 |
| Stripe | Start-up/Produkt | https://stripe.com/de | 2026-11-13 | 8,4:1 / 2,4:1 | 57 % | nein | 5 % | 14 | 0,6 / 0,4 | 1726 KB / 115 |
| Supabase (H) | Start-up/Produkt | https://supabase.com/ | 2026-11-13 | 1,0:1 / 1,0:1 | 0 % | nein | 13 % | 14 | 0,6 / 0,4 | 2005 KB / 130 |
| Raycast | Start-up/Produkt | https://www.raycast.com/ | 2026-11-13 | 20,0:1 / 3,8:1 | 80 % | nein | 0 % | 14 | 1,4 / 1,2 | 2758 KB / 146 |
| Anthropic | Start-up/Produkt | https://www.anthropic.com/ | 2026-11-13 | 10,6:1 / 5,0:1 | 64 % | nein | 43 % | 14 | 0,8 / 0,7 | 1842 KB / 70 |
| Mistral AI | Start-up/Produkt | https://mistral.ai/ | 2026-11-13 | 7,0:1 / 1,0:1 | 93 % | nein | 4 % | 16 | 3,0 / 2,1 | 1890 KB / 61 |
| Perplexity (H) | Start-up/Produkt | https://www.perplexity.ai/ | 2026-11-13 | 1,4:1 / 1,0:1 | 6 % | nein | 0 % | 16 | 2,6 / 2,1 | 21 KB / 154 |
| Framer | Start-up/Produkt | https://www.framer.com/ | 2026-11-13 | 16,5:1 / 3,0:1 | 52 % | nein | 38 % | 14 | 0,4 / 0,3 | 5498 KB / 140 |
| PostHog | Start-up/Produkt | https://posthog.com/ | 2026-11-13 | 7,2:1 / 1,1:1 | 56 % | nein | 42 % | 17 | 0,9 / 0,7 | 3882 KB / 81 |
| DeepL | Start-up/Produkt | https://www.deepl.com/de/translator | 2026-11-13 | 14,4:1 / 3,1:1 | 63 % | nein | 36 % | 14 | 1,3 / 0,4 | 2512 KB / 251 |
| Miro | Start-up/Produkt | https://miro.com/de/ | 2026-11-13 | 9,0:1 / 1,0:1 | 93 % | nein | 90 % | 18 | 0,6 / 0,5 | 2306 KB / 99 |
| McKinsey | Beratung/Agentur | https://www.mckinsey.com/de | 2026-11-13 | nicht messbar (page.goto: net::ERR_HTTP2_PROTOCOL_ERROR) |||||||
| BCG | Beratung/Agentur | https://www.bcg.com/ | 2026-11-13 | 15,6:1 / 1,0:1 | 89 % | nein | 17 % | 16 | 0,9 / 0,4 | 2718 KB / 65 |
| Accenture | Beratung/Agentur | https://www.accenture.com/de-de | 2026-11-13 | 21,0:1 / 5,2:1 | 93 % | nein | 2 % | 16 | 0,8 / 0,9 | 243 KB / 30 |
| Deloitte | Beratung/Agentur | https://www.deloitte.com/de/de.html | 2026-11-13 | 13,6:1 / 4,5:1 | 76 % | nein | 47 % | 14 | 2,1 / 1,6 | 2671 KB / 96 |
| PwC | Beratung/Agentur | https://www.pwc.de/ | 2026-11-13 | 21,0:1 / 1,0:1 | 87 % | nein | 33 % | 15 | 0,5 / 0,7 | 2138 KB / 85 |
| KPMG | Beratung/Agentur | https://kpmg.com/de/de/home.html | 2026-11-13 | 11,3:1 / 5,4:1 | 64 % | nein | 19 % | 14 | 3,3 / 3,1 | 2933 KB / 65 |
| EY | Beratung/Agentur | https://www.ey.com/de_de | 2026-11-13 | 13,4:1 / 1,0:1 | 83 % | nein | 7 % | 16 | 3,5 / 3,2 | 11526 KB / 91 |
| Capgemini | Beratung/Agentur | https://www.capgemini.com/de-de/ | 2026-11-13 | 17,4:1 / 4,8:1 | 91 % | nein | 33 % | 16 | 0,8 / 0,4 | 2557 KB / 166 |
| IDEO | Beratung/Agentur | https://www.ideo.com/ | 2026-11-13 | 13,6:1 / 5,2:1 | 68 % | nein | 15 % | 14 | 1,2 / 0,6 | 108 KB / 63 |
| frog | Beratung/Agentur | https://www.frog.co/ | 2026-11-13 | 21,0:1 / 1,0:1 | 79 % | nein | 33 % | 16 | 2,8 / 2,8 | 1823 KB / 120 |
| Metalab (H) | Beratung/Agentur | https://www.metalab.com/ | 2026-11-13 | 21,0:1 / 21,0:1 | 100 % | nein | 23 % | 70 (H) | 0,3 / 0,4 | 1411 KB / 99 |
| adesso | Beratung/Agentur | https://www.adesso.de/de/ | 2026-11-13 | 4,0:1 / 1,0:1 | 26 % | nein | 24 % | 16 | 0,5 / 0,5 | 5468 KB / 52 |
| MHP | Beratung/Agentur | https://www.mhp.com/de/ | 2026-11-13 | 15,1:1 / 1,0:1 | 88 % | nein | 60 % | 18 | 0,7 / 1,2 | 2158 KB / 60 |
| Thoughtworks | Beratung/Agentur | https://www.thoughtworks.com/de-de | 2026-11-13 | 21,0:1 / 1,0:1 | 96 % | nein | 31 % | 14 | 0,5 / 0,4 | 9548 KB / 64 |

### Kennzahlen je Gruppe (ohne McKinsey)

| Gruppe | Seiten | Median Anteil 7:1 | Median LCP Desktop / mobil | Seiten mit H-Scroll mobil | Median Daten |
|---|---|---|---|---|---|
| Tech-Konzerne | 13 | 83 % | 0,7 s / 1,0 s | 0 | 1490 KB |
| Hoster/Cloud | 13 | 89 % | 0,7 s / 0,7 s | 1 (AWS) | 1429 KB |
| Start-ups/Produkt | 13 | 63 % | 0,9 s / 0,7 s | 0 | 2005 KB |
| Beratung/Agentur | 13 | 87 % | 0,8 s / 0,7 s | 0 | 2557 KB |

Die Mediane enthalten die mit (B) und (H) markierten Zeilen und sind deshalb nur grob.

### Lighthouse (mobil, engere Wahl)

| Seite | Barrierefreiheit | Best Practices | SEO | Auffällig |
|---|---|---|---|---|
| Scaleway | 100 | 100 | 100 | keine Fehler |
| Cloudflare | 99 | 96 | 100 | Überschriften-Reihenfolge, Konsolenfehler |
| Vercel | 91 | 96 | 100 | `maximum-scale=1` sperrt Zoom, Link ohne Namen |
| DigitalOcean | 86 | 100 | 100 | Cookie-Link 3,1:1, Label-in-Name, `tabindex` > 0 |
| Notion | 86 | 100 | 100 | Markenblau als Linkfarbe 4,02:1 auf Weiß |

Lighthouse-Berichte liegen nur lokal beim Inhaber (nicht im Repo, da sie Fremdinhalte enthalten).

## Auswertung

### Was die Messung zeigt

1. **AAA ist selten durchgängig.** Nur Cloudflare, Vercel und Scaleway (plus Zwischenseiten) erreichen bei allen gemessenen Textelementen 7:1. Typische Ausreißer sind graue Nebentexte, Fußzeilen, Cookie-Banner und Markenfarben als Linkfarbe. Für RelationNotes folgt daraus: Nebentext und Linkfarbe sind die kritischen Tokens, nicht der Fließtext.
2. **Markenfarbe als Textfarbe ist die häufigste Falle.** Ein mittleres Blau erreicht auf Weiß 4 bis 5:1 und reicht nicht für AAA. Darum nutzt RelationNotes `#2563EB` nur als Fläche und Grafik und `#1E40AF` (8,72:1) für Text und Knöpfe.
3. **Zoom-Sperren kommen auch bei sehr guten Seiten vor** (`maximum-scale=1`). RelationNotes sperrt den Zoom nicht und prüft 200 % per E2E-Test.
4. **Kleine Bedienziele sind verbreitet** (Median rund 17 % unter 24 px, Spitzen 60 bis 90 %). RelationNotes setzt 44 px für Hauptaktionen.
5. **Geschwindigkeit hängt kaum an der Optik.** Schnelle Seiten (LCP unter 1 s) gibt es in jeder Gruppe, mit hellem wie mit dunklem Design. Entscheidend sind Datenmenge und Bildanteil; dunkle Kino-Optik ist ohne Videohintergrund nicht langsamer.
6. **Mobil ohne Querscrollen ist Standard.** Nur eine von 52 Seiten scrollte bei 390 px seitwärts.

### Top-Kandidaten und Zuordnung zu den vier Designs

Wiedererkennbarkeit ist hier eine eigene Einschätzung: eigene Grundfarbe, eigene Schrift, wiederkehrende Formen, Marke auch ohne Logo erkennbar.

| Design in RelationNotes | Vorbilder aus der Messung | Begründung |
|---|---|---|
| **Pure** (NotebookLM-ähnliche Anmutung, eigene Marke) | Notion, Scaleway | Ruhige, helle Arbeitsfläche, weiche Panels, wenig Farbe; Notion zeigt, dass die Markenfarbe als Linkfarbe AAA verfehlt, deshalb eigenes Indigo mit 7:1 statt eines mittleren Blaus. Keine Farbwerte oder Formen von Google übernommen. |
| **Immersive Cinema** | Vercel, NVIDIA, Linear | Dunkle Bühne mit Lichtakzenten; Vercel erreicht trotz dunkler Optik 100 % AAA-Anteil und LCP unter 1 s. Übernommen wird das Prinzip (sehr hell auf sehr dunkel, Akzente nur als Licht), nicht die Farben. |
| **Editorial Calm** (Standard-Palette Everlast-Blau `#2563EB` mit Slate) | Accenture, Oracle, Capgemini | Ruhige Lese-Typografie, Serifen nur für Überschriften, viel Weißraum; Oracle und Accenture halten 93 bis 98 % AAA bei geringer Datenmenge. |
| **Fusion** | Cloudflare, DigitalOcean, Fly.io | Klarer Grundton mit einer warmen Signalfarbe; Cloudflare verbindet starke Wiedererkennung (Signalfarbe) mit 100 % AAA-Anteil und Lighthouse-Barrierefreiheit 99. |

**Engere Wahl insgesamt:** Scaleway (alle Werte top), Cloudflare (AAA plus starke Wiedererkennung), Vercel (dunkel und trotzdem AAA), Oracle und DigitalOcean (98 % AAA), Notion (Vorbild für die ruhige Arbeitsfläche, mit bekanntem Kontrastfehler als Lehre).

### Was RelationNotes daraus übernimmt

- Jede Textfarbe erreicht 7:1 auf jeder Fläche, auf der sie stehen kann (Tests in `apps/web/src/__tests__/design-tokens.test.ts`).
- Markenfarben nur als Fläche, nie als Text unter 7:1.
- Kein Zoom-Verbot, Zoom 200 % ohne Querscrollen (`apps/web/e2e/zoom-200.spec.ts`).
- Bedienziele 44 px (`apps/web/e2e/header-mobile.spec.ts`), kleinste Schrift 14 px, Fließtext 16 px.
- Selbst gehostete Schriften, keine Videohintergründe, damit der LCP unter 1 s bleibt.

## Nachmessen

Das Messskript ist bewusst nicht im Repo (es ruft fremde Seiten ab). Die Messung lässt sich mit Playwright wiederholen: Seite laden, nach `load` 2,5 s warten, dann je sichtbarem Textknoten `getComputedStyle(el).color` gegen die erste deckende `backgroundColor` der Vorfahren nach der WCAG-Formel rechnen, LCP per `PerformanceObserver` erfassen.
