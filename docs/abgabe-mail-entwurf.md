# Abgabe-Mail an Everlast Consulting (Entwurf)

Stand: 2026-11-13 · Issue #269 · Nicht versendet. Der Inhaber prüft den Text, ersetzt die Platzhalter und schickt ihn selbst ab.

Offen, bevor die Mail rausgehen kann (Inhaber-Schritte):

- [ ] `{{LIVE_URL}}`: Deploy des Workers über `deploy.yml` mit Freigabe im Environment `production`, dazu die Secrets in Cloudflare. Ohne Live-Link und Demo-Zugang bleibt die Mail ein Entwurf.
- [ ] `{{LOOM_URL}}`: Video nach dem Drehbuch in [`loom-guide.md`](loom-guide.md) aufnehmen.
- [ ] Die Eingangsbestätigung enthielt laut Inhaber Aussagen, die nicht stimmten. Den genauen Wortlaut kenne ich nicht. Vor dem Versand die gesendete Mail gegenlesen und den Absatz „Korrektur“ unten anpassen oder streichen.
- [ ] Freigabe durch den Inhaber, Versand durch den Inhaber.

## Entwurf

**Betreff:** Re: Testprojekt Junior Entwickler (m/w/d), Abgabe RelationNotes

Hallo Yassmine,

hier ist meine Abgabe zum Testprojekt: ein NotebookLM-Klon, der sich an RelationFlow anschließen lässt.

- Live-Test: {{LIVE_URL}} (Gastzugang auf der Startseite)
- Code: https://github.com/VectoDE/Notebook-LM-Klon
- Video (10 Minuten): {{LOOM_URL}}

**Was funktioniert.** Chat über ein Notebook, bei dem jede Aussage ein Zitat mit Quelle trägt. Dazu Studio-Werkzeuge: Audio-Overview mit Rückfrage, Video-Overview, Mindmap, Lernkarten, Quiz, Zeitleiste und Beziehungsgraph. Die Oberfläche gibt es in vier Designs, jeweils hell, dunkel und mit Hochkontrast. Bearbeiten geht auch offline, die Änderungen werden danach abgeglichen. Lokale Daten im Browser sind verschlüsselt.

**Was noch fehlt.** Der Upload eigener Dateien und der URL-Import sind in der Oberfläche noch nicht an die Verarbeitung angeschlossen. Im Demo-Notebook arbeitet man mit den mitgelieferten Quellen. Der Austausch von Entitäten und Kanten mit RelationFlow (`relationflow/export/v1`) ist beschrieben, aber nicht gebaut. Barrierefreiheit nach WCAG 2.2 AAA ist mein Ziel, zertifiziert ist sie nicht.

**Zu RelationFlow.** Agenten können ein Notebook über `POST /api/v1/notebooks/:id/search` abfragen und bekommen Fundstellen mit Quelle, Seite und Score. Rollen (Owner, Editor, Viewer) und ein Modell-Router mit Datenschutzmodus sind vorhanden.

**Wie ich gearbeitet habe.** Zuerst die Anforderungen als Issues, dann jede Änderung als Pull Request. Gemergt wird nur mit grünem Lint, Typecheck, Tests (Schwelle 100 Prozent Abdeckung) und Secret-Scan. KI-Werkzeuge habe ich dabei eingesetzt; Anforderungen, Architektur und Abnahme lagen bei mir. Das steht auch in der README.

**Korrektur.** [Hier nach Gegenlesen der Eingangsbestätigung einsetzen, welche Aussage richtigzustellen ist. Wenn nichts zu korrigieren ist: Absatz löschen.]

Über Rückmeldungen freue ich mich.

Viele Grüße
Tim Hauke

## Belegliste

Jede Aussage der Mail, mit dem Nachweis auf `main` (Stand `17cd9c7`). Genannte Pull Requests sind gemergt.

| Aussage | Beleg |
|---|---|
| Chat mit Zitaten und Quelle | `apps/web/src/chat-client.ts` (Aufruf `POST /api/v1/notebooks/:id/chat`), PR #401 (Abbruch, Markdown-Export), Chat-Tests im Worker |
| Audio-Overview mit Rückfrage | `apps/worker/src/audio-routes.ts` (`POST /api/v1/notebooks/:id/audio-interject`), `apps/web/src/InteractiveAudioHostPlayer.tsx`. Eingeschränkt: Nachweis über Komponenten- und Routentests, nicht über einen Live-Lauf mit echtem Modell |
| Video-Overview | `apps/web/src/video-exporter.ts`, PR #223. Der WebM-Export ist in der Oberfläche nicht eingebunden, deshalb nicht erwähnt |
| Mindmap, Lernkarten, Quiz | PR #224, PR #404 (Quiz-Modell mit vier Fragetypen), E2E `apps/web/e2e/mindmap-tastatur.spec.ts`, `quiz-lernkarten.spec.ts` |
| Zeitleiste | PR #407 |
| Beziehungsgraph | PR #390, E2E `apps/web/e2e/graph.spec.ts`, `beziehungsgraph.spec.ts` |
| Vier Designs, hell, dunkel, Hochkontrast | `apps/web/src/design-tokens.ts`, `apps/web/src/__tests__/design-tokens.test.ts`, PR #225 |
| Offline-Bearbeitung mit Abgleich | PR #409 und #410, E2E `apps/web/e2e/offline-sync.spec.ts` |
| Lokale Daten verschlüsselt | PR #403, E2E `apps/web/e2e/lokale-verschluesselung.spec.ts`, `docs/local-encryption.md` |
| Such-API für Agenten | `apps/worker/src/search-routes.ts`, `docs/openapi.json`; `packages/shared/src/__tests__/openapi.test.ts` prüft, dass keine Route fehlt |
| Rollen und Modell-Router | `apps/worker/src/auth-middleware.ts`, `GET /api/v1/providers`, `POST /api/v1/providers/route` |
| Pflicht-Checks vor jedem Merge | Branch-Schutz auf `main`: `Lint, Typecheck, Coverage & Build`, `Secret Scan (Gitleaks) & Dependency Audit (OSV)`, `Verify Sub-Issue Checklists Are 100% Checked` (siehe `docs/openssf.md`) |
| Schwelle 100 Prozent Abdeckung | `vitest.config.ts` (Thresholds), Pflicht-Check `Lint, Typecheck, Coverage & Build` |
| CI auf `main` grün | Läufe auf `17cd9c7`: CI, CodeQL, Lighthouse CI, Scorecard, Wiki Sync alle `success` (`gh run list --branch main`) |
| KI-Einsatz offengelegt | README, Kapitel „Ehrlicher KI-Einsatz“ |
| Upload/URL-Import nicht angeschlossen | In `apps/web/src` gibt es keine `new Worker(...)`-Instanz für `ingest.worker.ts`; der Parser `apps/web/src/workers/ingest-parser.ts` existiert, wird in der Oberfläche nicht aufgerufen |
| `relationflow/export/v1` nicht gebaut | README, Kapitel „Andocken an RelationFlow“ |
| WCAG 2.2 AAA nicht zertifiziert | `docs/accessibility-wcag-aaa.md` (Ziel und Kontrasttests, keine Prüfbescheinigung) |

## Nicht in die Mail aufnehmen

Diese Aussagen sind nicht belegt und stehen deshalb nicht im Entwurf: „WCAG 2.2 AAA erreicht“, „60 fps“, Messwerte zur Suchlatenz (der Test erlaubt unter 1000 ms, nicht unter 5 ms), Zahlen zu Issues oder Pull Requests (vorher am Project Board nachzählen), Lastwerte (der k6-Lauf läuft in der CI, ein veröffentlichter Report liegt nicht vor), ein bestimmter Scorecard-Wert (Stand in `docs/openssf.md`).
