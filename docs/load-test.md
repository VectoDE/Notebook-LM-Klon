# Lasttests (lokal und Live-Rauchtest)

Dieses Kapitel beschreibt, wie RelationNotes unter Last geprüft wird, welche Werte gemessen wurden und wie du die Messung selbst wiederholst. Ergebnisse stammen aus echten Läufen, nicht aus Schätzungen. English summary: [below](#english-summary).

## Überblick

| Frage | Antwort |
| :--- | :--- |
| Werkzeug | [k6](https://github.com/grafana/k6) 1.8.2 (AGPL-3.0, eigenständiges Binary, keine npm-Abhängigkeit im Projekt) |
| Ziel lokal | Der Worker, gestartet mit `wrangler dev --local` (lokale D1, R2 und Durable Objects, gebaute Web-Assets) |
| Ziel live | Nur ein kleiner Rauchtest, 2 bis 5 simulierte Nutzer, nur lesende öffentliche Endpunkte |
| Skript | [`load-test/k6/scenarios.js`](../load-test/k6/scenarios.js) |
| Runner lokal | [`load-test/run-local.mjs`](../load-test/run-local.mjs) |
| CI | [`.github/workflows/load-test.yml`](../.github/workflows/load-test.yml), Reports als Artefakt `load-test-report` |

Warum k6: ein einzelnes Binary ohne Konto, Szenarien in JavaScript, Schwellenwerte (p95, p99, Fehlerquote) als Abbruchkriterium und ein eingebauter HTML-Report. Das Binary kommt nur vom offiziellen Release (`github.com/grafana/k6`), die SHA-256-Prüfsumme wird im Workflow geprüft. Es liegt nicht im Repository.

## Was simuliert wird (lokal)

Drei Szenarien laufen gleichzeitig. In der Spitze sind es 200 simulierte Nutzer: 60 Besucher, 60 Gäste mit Suche und 80 aktive Gäste. Jede simulierte Person wartet zwischen den Schritten wie ein Mensch, die aktiven Gäste 6 bis 10 Sekunden je Durchlauf.

| Szenario | Ablauf pro Durchlauf |
| :--- | :--- |
| `public_visitors` | `GET /api/v1/health`, `GET /api/v1/demo/info`, `GET /` (Startseite der Web-App) |
| `guest_members` | einmal `POST /api/v1/auth/guest` (Turnstile mit den offiziellen Cloudflare-Testschlüsseln), danach `GET /api/v1/providers`, `POST /api/v1/notebooks/:id/search` (Modus `fts`, ohne KI-Aufruf) und `GET /api/v1/jobs` |
| `source_creators` | einmal Gastzugang mit eigenem Notizbuch. In den ersten drei Durchläufen eine Quelle hochladen (anlegen, Datei per `PUT`, Prüfung, Chunks speichern). Danach je Durchlauf Suche, Chat mit Antwort-Stream und ein Studio-Job (Mindmap) |

Der Chat läuft gegen ein lokales Test-LLM ([`load-test/fake-ollama.mjs`](../load-test/fake-ollama.mjs)). Es spricht das Ollama-Protokoll, lauscht nur auf Loopback und gibt eine feste Antwort mit Belegstelle zurück. Gemessen wird also der Weg durch den Worker (Sitzung, Rate-Limit, Suche, Kontextaufbau, Stream), nicht ein Sprachmodell. Vor dem Lasttest prüft der Runner einmal Upload und Chat und bricht ab, wenn das nicht klappt.

Lastform: 30 s Anlauf auf 25 %, 45 s auf 100 %, 90 s Haltephase, 15 s Auslauf.

Der Rate-Limiter des Workers begrenzt je Client. Damit viele getrennte Nutzer entstehen, startet der Runner den Worker mit `TRUSTED_PROXY_HEADER=x-forwarded-for`, und jede simulierte Person sendet ihre eigene Adresse. Antworten mit Status 429 würden getrennt gezählt (`rate_limited`) und nicht als Fehler gewertet. Im gemessenen Lauf trat keine auf.

Schwellenwerte, bei deren Verletzung der Lauf fehlschlägt: Fehlerquote unter 1 %, unerwartete Status unter 1 %, p95 unter 800 ms, p99 unter 2000 ms, über 99 % erfolgreiche Prüfungen. Dazu p95 je Ablauf: Gastzugang unter 1000 ms, Suche unter 800 ms, jeder Upload-Schritt unter 1000 ms, Chat unter 2000 ms, Studio-Job unter 800 ms.

## Messwerte

Lauf vom 2026-11-13, GitHub-Actions-Runner `ubuntu-latest`, Node.js 22, wrangler 4.158.0, k6 1.8.2 (linux/amd64), Worker-Profil `demo`. CI-Lauf [43358253288](https://github.com/VectoDE/Notebook-LM-Klon/actions/runs/43358253288). Alle Schwellen eingehalten.

| Kennzahl | Wert |
| :--- | :--- |
| Simulierte Nutzer (Spitze) | 200 |
| Anfragen gesamt | 17.159 |
| Durchsatz | 92,5 Anfragen pro Sekunde (durch die Wartezeiten der Nutzer begrenzt) |
| Fehlerquote | 0 % |
| Unerwartete Status | 0 % |
| Status 429 (Rate-Limit) | 0 |
| Erfolgreiche Prüfungen | 100 % |
| Latenz p50 | 46,5 ms |
| Latenz p90 | 191,4 ms |
| Latenz p95 | 249,0 ms |
| Latenz p99 | 616,3 ms |
| Latenz Maximum | 1388,3 ms |

Durchgeführte Abläufe: 240 Quellen hochgeladen (je 4 Schritte), 1289 Chats mit Antwort-Stream, 1289 Studio-Jobs eingereiht, 3193 Suchen, 140 Gastzugänge.

p95 je Endpunkt: Chat 903,7 ms, Gastzugang 510,6 ms, Upload-Schritte 243,0 ms, Studio-Job 217,8 ms, Suche (`fts`) 214,3 ms, Health 214,0 ms, Jobs 213,1 ms, Provider 206,3 ms, Startseite 201,4 ms, `demo/info` 201,1 ms.

Einordnung: Der Durchsatz ist bewusst moderat, weil die Nutzer wie Menschen warten. Die Zahlen zeigen, dass 200 gleichzeitige Nutzer mit Uploads, Chats und Studio-Jobs den lokal laufenden Worker nicht an eine Grenze bringen. Gegenüber dem ersten Lauf mit 100 Nutzern und nur lesenden Abläufen (p95 31 ms, CI-Lauf [43346047873](https://github.com/VectoDE/Notebook-LM-Klon/actions/runs/43346047873)) steigen die Latenzen, weil jetzt geschrieben wird und alles in einem lokalen Prozess läuft. Die Zahlen sagen nichts über das Verhalten auf dem Cloudflare-Edge aus, wo andere Limits gelten (siehe [Cloudflare-Free-Limits](platform-limits.md)), und nichts über die Antwortzeit eines echten Sprachmodells. Ein Lauf auf einem geteilten CI-Runner schwankt; vergleiche daher Größenordnungen, nicht einzelne Millisekunden.

Berichte im Repository: [`docs/load-test/report-local.html`](load-test/report-local.html) (statischer Report, im Browser öffnen) und [`docs/load-test/summary-local.json`](load-test/summary-local.json) (Kennzahlen und Prüfungen je Endpunkt). Den interaktiven k6-Report (`report-local-k6.html`, mit Zeitverläufen) und das Worker-Protokoll liefert der Workflow als Artefakt `load-test-report`; der k6-Report liegt wegen seines mitgelieferten Fremd-Skripts nicht im Repository.

## Live-Rauchtest

Der Live-Test ist absichtlich klein, weil das Tageskontingent des Cloudflare-Free-Plans (100.000 Worker-Anfragen pro Tag) geschont werden soll. Er nutzt `PROFILE=smoke`: 3 simulierte Nutzer, 30 Sekunden, nur `GET /api/v1/health`, `GET /api/v1/demo/info` und `GET /`. Er legt keine Konten an und löst keine KI-Aufrufe aus.

Stand 2026-11-13: Im Repository ist keine öffentliche Live-URL eingetragen (die Dokumente nennen nur den Platzhalter `workers.dev`), und der Host `notebook-lm-klon.workers.dev` löst nicht auf. Der Rauchtest wurde deshalb noch nicht gegen eine Live-Instanz ausgeführt. Sobald das Deployment steht, genügt der Aufruf unten oder der Workflow mit der Eingabe `live_url`; die Ergebnisse gehören dann in diese Tabelle.

| Datum | Ziel | Nutzer | Dauer | Anfragen | Fehlerquote | p95 | Ergebnis |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| offen | Live-URL steht aus | 3 | 30 s | offen | offen | offen | offen |

## Selbst ausführen

Voraussetzungen: `pnpm install`, `pnpm build`, k6 im `PATH` oder in `K6_BIN`.

```bash
# Lokal, mit Wrangler-Worker, Reports unter load-test/results
node load-test/run-local.mjs --peak 200 --hold 90s

# Live-Rauchtest (nur lesend, kleine Last)
k6 run -e PROFILE=smoke -e BASE_URL=https://deine-live-url.example \
  -e SMOKE_VUS=3 -e SMOKE_DURATION=30s load-test/k6/scenarios.js
```

In GitHub Actions: Workflow „Lasttest – k6 lokal gegen wrangler dev“ per `workflow_dispatch` starten (optional mit `live_url`). Die Reports liegen danach als Artefakt `load-test-report`. Der Workflow läuft zusätzlich wöchentlich und bei Änderungen am Lasttest.

## English summary

RelationNotes is load-tested with k6 1.8.2 (official binary, SHA-256 verified in CI, not stored in the repository). The local test starts the worker with `wrangler dev --local` and simulates up to 200 concurrent users: 60 public visitors (health, demo info, SPA index), 60 guest members (guest sign-in with the official Cloudflare Turnstile test keys, provider catalogue, FTS search, jobs list) and 80 active guests who upload sources, search, chat with a streamed answer and queue a studio job. Chat answers come from a local test LLM that speaks the Ollama protocol on loopback only, so the run measures the worker, not a language model.

Run of 2026-11-13 on a GitHub-hosted `ubuntu-latest` runner (wrangler 4.158.0, profile `demo`, [run 43358253288](https://github.com/VectoDE/Notebook-LM-Klon/actions/runs/43358253288)): 17,159 requests at 92.5 requests per second, 0 % errors, no rate-limited responses, p50 46.5 ms, p95 249.0 ms, p99 616.3 ms, max 1388.3 ms; chat p95 903.7 ms. All thresholds passed. The throughput is bounded by user think time and says nothing about the Cloudflare edge. Reports (static HTML and JSON): [`docs/load-test/report-local.html`](load-test/report-local.html) and [`docs/load-test/summary-local.json`](load-test/summary-local.json).

The live check is a deliberately small smoke test (3 users, 30 seconds, read-only public endpoints, no accounts, no AI calls) to protect the free-plan daily quota. No live URL is published yet, so it has not been run; see the table above.
