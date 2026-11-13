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

Zwei Szenarien laufen gleichzeitig, jeweils mit der Hälfte der Spitzenlast. Jede simulierte Person wartet zwischen den Anfragen 0,5 bis 2 Sekunden, wie ein Mensch.

| Szenario | Ablauf pro Durchlauf |
| :--- | :--- |
| `public_visitors` | `GET /api/v1/health`, `GET /api/v1/demo/info`, `GET /` (Startseite der Web-App) |
| `guest_members` | einmal `POST /api/v1/auth/guest` (Turnstile mit den offiziellen Cloudflare-Testschlüsseln), danach `GET /api/v1/providers`, `POST /api/v1/notebooks/:id/search` (Modus `fts`, ohne KI-Aufruf) und `GET /api/v1/jobs` |

Lastform: 30 s Anlauf auf 25 %, 45 s auf 100 %, 90 s Haltephase, 15 s Auslauf. Spitze: 100 gleichzeitige simulierte Nutzer (50 je Szenario).

Der Rate-Limiter des Workers begrenzt je Client. Damit viele getrennte Nutzer entstehen, startet der Runner den Worker mit `TRUSTED_PROXY_HEADER=x-forwarded-for`, und jede simulierte Person sendet ihre eigene Adresse. Antworten mit Status 429 würden getrennt gezählt (`rate_limited`) und nicht als Fehler gewertet. Im gemessenen Lauf trat keine auf.

Schwellenwerte, bei deren Verletzung der Lauf fehlschlägt: Fehlerquote unter 1 %, unerwartete Status unter 1 %, p95 unter 800 ms, p99 unter 2000 ms, über 99 % erfolgreiche Prüfungen.

## Messwerte

Lauf vom 2026-11-13, GitHub-Actions-Runner `ubuntu-latest`, Node.js 22, wrangler 4.158.0, k6 1.8.2 (linux/amd64), Worker-Profil `demo`. CI-Lauf [43346047873](https://github.com/VectoDE/Notebook-LM-Klon/actions/runs/43346047873).

| Kennzahl | Wert |
| :--- | :--- |
| Simulierte Nutzer (Spitze) | 100 |
| Anfragen gesamt | 10.642 |
| Durchsatz | 58,1 Anfragen pro Sekunde (durch die Wartezeiten der Nutzer begrenzt) |
| Fehlerquote | 0 % |
| Unerwartete Status | 0 % |
| Status 429 (Rate-Limit) | 0 |
| Erfolgreiche Prüfungen | 100 % |
| Latenz p50 | 8,8 ms |
| Latenz p90 | 21,4 ms |
| Latenz p95 | 31,1 ms |
| Latenz p99 | 85,2 ms |
| Latenz Maximum | 459,9 ms |

p95 je Endpunkt: Gastzugang 117,6 ms, Suche (`fts`) 33,9 ms, Jobs 32,9 ms, Provider 28,9 ms, Health 27,3 ms, `demo/info` 26,1 ms, Startseite 24,4 ms.

Einordnung: Der Durchsatz ist bewusst moderat, weil die Nutzer wie Menschen warten. Die Zahlen zeigen, dass 100 gleichzeitige Nutzer den lokal laufenden Worker nicht an eine Grenze bringen. Sie sagen nichts über das Verhalten auf dem Cloudflare-Edge aus, wo andere Limits gelten (siehe [Cloudflare-Free-Limits](platform-limits.md)). Ein Lauf auf einem geteilten CI-Runner schwankt; vergleiche daher Größenordnungen, nicht einzelne Millisekunden.

Berichte im Repository: [`docs/load-test/report-local.html`](load-test/report-local.html) (statischer Report, im Browser öffnen) und [`docs/load-test/summary-local.json`](load-test/summary-local.json) (Kennzahlen und Prüfungen je Endpunkt). Den interaktiven k6-Report (`report-local-k6.html`, mit Zeitverläufen) liefert der Workflow als Artefakt `load-test-report`; er liegt wegen seines mitgelieferten Fremd-Skripts nicht im Repository.

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
node load-test/run-local.mjs --peak 100 --hold 90s

# Live-Rauchtest (nur lesend, kleine Last)
k6 run -e PROFILE=smoke -e BASE_URL=https://deine-live-url.example \
  -e SMOKE_VUS=3 -e SMOKE_DURATION=30s load-test/k6/scenarios.js
```

In GitHub Actions: Workflow „Lasttest – k6 lokal gegen wrangler dev“ per `workflow_dispatch` starten (optional mit `live_url`). Die Reports liegen danach als Artefakt `load-test-report`. Der Workflow läuft zusätzlich wöchentlich und bei Änderungen am Lasttest.

## English summary

RelationNotes is load-tested with k6 1.8.2 (official binary, SHA-256 verified in CI, not stored in the repository). The local test starts the worker with `wrangler dev --local` and simulates up to 100 concurrent users: 50 public visitors (health, demo info, SPA index) and 50 guest members (guest sign-in with the official Cloudflare Turnstile test keys, provider catalogue, FTS search, jobs list). Think time is 0.5 to 2 seconds per step.

Run of 2026-11-13 on a GitHub-hosted `ubuntu-latest` runner (wrangler 4.158.0, profile `demo`): 10,642 requests at 58.1 requests per second, 0 % errors, no rate-limited responses, p50 8.8 ms, p95 31.1 ms, p99 85.2 ms, max 459.9 ms. The throughput is bounded by user think time and says nothing about the Cloudflare edge. Reports (static HTML and JSON): [`docs/load-test/report-local.html`](load-test/report-local.html) and [`docs/load-test/summary-local.json`](load-test/summary-local.json).

The live check is a deliberately small smoke test (3 users, 30 seconds, read-only public endpoints, no accounts, no AI calls) to protect the free-plan daily quota. No live URL is published yet, so it has not been run; see the table above.
