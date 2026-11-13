# Loom-Leitfaden (10 Minuten) und Entwurf der Antwort-E-Mail

Stand: 2026-11-13 · Issue #151 · Ergänzt den [visuellen Präsentations-Leitfaden](loom-presentation-guide.md), der die Schaubilder für die Minuten 5 bis 9 liefert.

Das Drehbuch ist kein Text zum Ablesen. Die Sätze sind Sprechvorschläge. Alles, was gezeigt oder behauptet wird, muss vor der Aufnahme auf dem Live-System funktionieren. Was nicht läuft, wird nicht gezeigt, sondern als offen benannt.

## Vor der Aufnahme (Inhaber-Schritte)

Diese Punkte gibt es heute noch nicht und sie werden hier bewusst nicht erfunden:

- [ ] **Live-Link** zum deployten Worker. Deploy über den Workflow `deploy.yml`, Freigabe im Environment `production`. Der Link ersetzt `{{LIVE_URL}}`.
- [ ] **Loom-Link** nach der Aufnahme. Er ersetzt `{{LOOM_URL}}`.
- [ ] Schlüssel und Secrets in Cloudflare gesetzt (Turnstile, `SESSION_SALT_SECRET`, ein Demo-Schlüssel für Audio), sonst starten Gastzugang und Audio nicht.
- [ ] Die Antwort-E-Mail wird vom Inhaber selbst versendet. Der Entwurf unten ist nur ein Text.

**Technische Vorbereitung:** Browser mit Tabs für die Live-App, das Demo-Notebook, das Repository (README, Pull Requests, Project Board) und VS Code mit dem Monorepo. Benachrichtigungen aus, Mikrofon testen, Browser-Zoom auf 100 %. Einmal alles probehalber durchklicken.

## Drehbuch mit Zeitmarken

Ziel: 9:30 Minuten, harte Obergrenze 10:00.

| Zeit | Abschnitt | Auf dem Bildschirm | Sprechvorschlag |
|---|---|---|---|
| 0:00 – 0:40 | Einstieg | Startseite der Live-App | „Hallo zusammen. Ich zeige kurz, wie ich die Aufgabe angegangen bin, und führe dann durch meinen NotebookLM-Klon. Zum Schluss gehe ich darauf ein, wie er sich an RelationFlow anschließen lässt.“ |
| 0:40 – 2:00 | Vorgehen | GitHub Project Board, ein Issue mit Aufgabenliste, ein gemergter Pull Request mit grünen Checks | „Ich habe zuerst die Anforderungen aufgeschrieben und daraus Issues gemacht. Jede Änderung läuft über einen Pull Request. Gemergt wird erst, wenn Lint, Typprüfung, Tests mit 100 Prozent Abdeckung und die Sicherheits-Scans grün sind. KI-Werkzeuge habe ich dabei genutzt. Architektur und Abnahme lagen bei mir. Das steht auch offen in der README.“ |
| 2:00 – 3:30 | Demo-Einstieg und Chat | Gastzugang, Demo-Notebook „RelationFlow & KI im Mittelstand“, eine Frage im Chat, Klick auf ein Zitat | „Ohne Registrierung bin ich im Demo-Notebook. Ich stelle eine Frage. Jede Aussage trägt ein Zitat. Ein Klick darauf springt zur Textstelle in der Quelle.“ |
| 3:30 – 5:30 | Studio-Werkzeuge | Audio-Overview mit Rückfrage („Beitreten / Frage stellen“), Video-Overview (ohne WebM-Export, der ist in der Oberfläche nicht eingebunden), Mindmap, Lernkarten, Quiz | „Das Studio hat sechs Werkzeuge. Beim Audio kann ich mitten im Gespräch eine Frage stellen. Der Host antwortet aus den Quellen. Das Video wird im Browser aus Folien und Kapiteln gebaut. Die Mindmap gibt es auch als Baumliste für Screenreader.“ |
| 5:30 – 6:30 | Designs | Umschalter für die vier Designs, dann Hell, Dunkel, Hochkontrast | „Vier Designs, jedes mit eigener Farbwelt und Schrift. Dazu Hochkontrast. Das Ziel für Text ist ein Kontrast von mindestens 7:1. Das ist als Test hinterlegt.“ |
| 6:30 – 8:00 | Code-Walkthrough | VS Code: `apps/worker/src/search-routes.ts`, `packages/shared/src/index.ts` (Zod-Schemas), `docs/openapi.json` | „Der Worker ist ein einziger Cloudflare Worker mit D1, R2 und Durable Objects. Das Parsen der Dateien passiert im Browser, weil das CPU-Limit im Free-Plan knapp ist. Die Schemas liegen geteilt in `packages/shared`. Die API ist als OpenAPI 3.1 beschrieben, und ein Test prüft, dass keine Route fehlt.“ |
| 8:00 – 9:15 | Andocken an RelationFlow | README-Kapitel „Andocken an RelationFlow“, Beispielaufruf der Such-API | „Für RelationFlow gibt es eine eigene Such-API: `POST /api/v1/notebooks/:id/search`. Ein Agent bekommt Fundstellen mit Quelle, Seite und Score. Rollen und Modell-Router sind dafür vorbereitet. Offen ist der Austausch von Entitäten und Kanten. Das Format ist beschrieben, aber noch nicht gebaut.“ |
| 9:15 – 9:30 | Abschluss | Live-App | „Den Link und den Code schicke ich in der Mail mit. Ich freue mich auf das Gespräch.“ |

## Prüfliste: nur sagen, was belegt ist

| Aussage im Video | Beleg im Repository |
|---|---|
| Zitate verweisen auf die Textstelle | Chat-Antworten mit Zitaten, Suche liefert `page`, `startOffset`, `endOffset` (`openapi.json`, `SearchCitation`) |
| Sechs Studio-Werkzeuge | `apps/web/src/StudioPanel.tsx` (`StudioTool`) |
| Audio-Rückfrage | `POST /api/v1/notebooks/:id/audio-interject` |
| Video-Overview (WebM-Export nur als Modul, nicht in der Oberfläche) | `apps/web/src/video-exporter.ts` |
| Vier Designs, drei Farbmodi | `apps/web/src/design-tokens.ts` |
| 100 % Testabdeckung als Schwelle | `vitest.config.ts`, Pflicht-Check `Lint, Typecheck, Coverage & Build` |
| OpenAPI-Abdeckung aller Routen | `packages/shared/src/__tests__/openapi.test.ts` |
| Offenlegung des KI-Einsatzes | README-Kapitel „Ehrlicher KI-Einsatz“ |
| Austausch `relationflow/export/v1` | **nicht gebaut**, nur beschrieben. Im Video als offen nennen. |

Nicht sagen, solange es nicht geprüft ist: Zahlen zu Issues oder Pull Requests (vorher am Project Board nachzählen), „WCAG 2.2 AAA erreicht“ (belegt ist das Ziel und die Kontrast-Tests, nicht eine Zertifizierung), Lastwerte, Scorecard-Wert (zeigt sich im Badge, der Stand steht in [`docs/openssf.md`](openssf.md)).

## Antwort-E-Mail

Die Abgabe-Mail wird nicht im Repository gepflegt. Der Inhaber schreibt sie selbst und schickt sie selbst ab.
