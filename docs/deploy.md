# Deploy auf Cloudflare Workers

Der Deploy läuft ausschließlich über den Workflow [`deploy.yml`](../.github/workflows/deploy.yml).
Er startet nur von Hand (**Actions → Deploy (manuelle Freigabe) → Run workflow**) und wartet
danach auf die Freigabe im GitHub Environment `production`. Push, Pull Request oder Zeitplan
lösen nie einen Deploy aus.

## Ablauf des Workflows

1. Prüft, ob `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DEPLOY_URL` und
   `VITE_TURNSTILE_SITE_KEY` gesetzt sind, ob in `apps/worker/wrangler.jsonc` noch die
   Platzhalter-`database_id` steht und ob `APP_ORIGIN` eine HTTPS-Adresse ist, die genau mit
   `DEPLOY_URL` übereinstimmt. Fehlt etwas, bricht er vor jedem Zugriff auf Cloudflare ab.
2. Installiert die Abhängigkeiten und liest die Namen der Worker-Secrets
   (`wrangler secret list`): fehlt `TURNSTILE_SECRET_KEY`, `SESSION_SALT_SECRET`,
   `DEMO_GEMINI_KEY` oder `KEK_V1`, bricht er ab, bevor Migrationen laufen. Werte liest er nie.
   Lässt sich die Liste nicht abrufen, warnt er nur.
3. Führt die Tests aus und baut die Web-Oberfläche. Der Build bekommt `VITE_TURNSTILE_SITE_KEY`
   und `VITE_PUBLIC_BASE_URL` (= `DEPLOY_URL`) aus den Variablen des Environments. Ohne Site-Key
   würde die Anmeldung im Produktions-Build nur einen Fehler zeigen.
4. Wendet die D1-Migrationen remote an (`wrangler d1 migrations apply notebook-lm-db --remote`,
   abschaltbar über den Eingang `run_migrations`).
5. Deployt den Worker (`wrangler deploy`). Cron (`0 * * * *`) und `nodejs_compat` kommen aus
   `apps/worker/wrangler.jsonc`. Worker-Secrets bleiben dabei erhalten.
6. Smoke-Check gegen `DEPLOY_URL` (`apps/worker/src/smoke-check.ts`, bis zu drei Versuche):
   Health 200 mit `status: ok`, Web-Oberfläche liefert HTML, Gastzugang ohne Turnstile-Token
   wird mit 403 abgelehnt (ein 503 hieße: Secrets fehlen), Chat ohne Sitzung antwortet 401.
   Ob Turnstile- und Gemini-Schlüssel stimmen, prüft er nicht (siehe Schritt 7 unten).

Lokal lässt sich der Smoke-Check gegen jede laufende Instanz ausführen:

```bash
pnpm --filter @notebook-lm/worker exec tsx src/smoke-check.ts http://localhost:8787
```

## Schritte des Inhabers vor dem ersten Deploy

1. Environment `production` unter **Settings → Environments** anlegen bzw. prüfen und sich selbst
   als *Required reviewer* eintragen, Deploy-Branch auf `main` beschränken.
2. D1-Datenbank mit EU-Jurisdiktion anlegen und die ID eintragen:
   `pnpm --filter @notebook-lm/worker exec wrangler d1 create notebook-lm-db --jurisdiction=eu`,
   dann `database_id` in `apps/worker/wrangler.jsonc` per Pull Request ersetzen
   (für `notebook-lm-db` ist das geschehen).
3. R2-Bucket mit Location Hint Westeuropa anlegen:
   `pnpm --filter @notebook-lm/worker exec wrangler r2 bucket create notebook-lm-media --location=weur`.

### Region (Entscheidung F249)

| Dienst | Festlegung | Wo sie gilt | Quelle (abgerufen 2026-11-14) |
| --- | --- | --- | --- |
| D1 `notebook-lm-db` | Jurisdiktion `eu`: Daten bleiben in der EU | Nur beim Anlegen (`--jurisdiction=eu`). Lässt sich danach nicht mehr setzen oder ändern. Im Binding in `wrangler.jsonc` gibt es dafür kein Feld. Wird zusätzlich `--location` angegeben, ignoriert Cloudflare den Hint, die Jurisdiktion gewinnt. | [D1 Data location](https://developers.cloudflare.com/d1/configuration/data-location/) |
| R2 `notebook-lm-media` | Location Hint `weur` (Westeuropa) | Nur beim ersten Anlegen des Bucket-Namens (`--location=weur`), auch nach Löschen und Neuanlegen bleibt der alte Ort. Kein Feld im Binding. Der Hint ist „best effort“, keine Zusage. | [R2 Data location](https://developers.cloudflare.com/r2/reference/data-location/), [`wrangler r2 bucket create`](https://developers.cloudflare.com/workers/wrangler/commands/r2/) |

Ein Location Hint ist keine Jurisdiktion: Er garantiert nicht, dass R2-Daten in der EU bleiben.
Der Standort der hochgeladenen Dateien ist ein Wunsch ohne Garantie. Datenschutzerklärung und
Verarbeitungsverzeichnis dürfen deshalb nicht zusagen, dass Uploads in der EU gespeichert werden;
zutreffend ist: „bevorzugt Westeuropa, ohne Garantie“. Die EU-Zusage gilt nur für die Datenbank (D1).
Das leistet nur ein Bucket mit `--jurisdiction=eu`. Dann braucht das Binding in `wrangler.jsonc`
zusätzlich `"jurisdiction": "eu"`, und Presigned URLs laufen über
`https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`. Der Upload-Code baut Presigned URLs derzeit
nur für Buckets ohne Jurisdiktion; im Profil `demo` sind sie ohnehin abgeschaltet
(siehe `docs/platform-limits.md`, Abschnitt 5).

### R2-Freimenge und Upload-Grenzen

Im Profil `demo` hält der Worker R2 innerhalb der Hälfte der Cloudflare-Freimenge
(Rechnung und Fehlercodes in `docs/platform-limits.md`, Abschnitt 5). Das ist eine Grenze der App,
kein Schutz auf Kontoebene: Andere Buckets oder Worker im selben Konto zählen zur selben
Freimenge. Ob das Konto über der Freimenge liegt, zeigt nur das Cloudflare-Dashboard
(R2-Übersicht des Kontos). Migration `0007_upload_grenzen.sql` legt die Zähler `r2_usage` und
`upload_daily` an und wird mit den übrigen Migrationen im Deploy-Workflow angewendet.
4. Environment `production`, Secrets: `CLOUDFLARE_API_TOKEN` (Konto-Token mit Workers Scripts
   Edit, D1 Edit, R2 Read, Account Settings Read), `CLOUDFLARE_ACCOUNT_ID`. Variablen:
   `DEPLOY_URL` (die `*.workers.dev`-Adresse, ohne Pfad) und `VITE_TURNSTILE_SITE_KEY`
   (öffentlicher Site-Key des Turnstile-Widgets).
5. Worker-Secrets setzen (Werte nur durch den Inhaber, nie im Repository):
   `wrangler secret put <NAME>` für `SESSION_SALT_SECRET`, `TURNSTILE_SECRET_KEY`,
   `DEMO_GEMINI_KEY` und `KEK_V1` (mindestens 32 Zeichen; ein Secret namens `KEK` wirkt nicht).
   `RESEND_API_KEY` und `MAIL_FROM` sind optional und nur für Magic-Link per Mail nötig; ohne
   sie meldet der Magic-Link einen Zustellfehler, Gastzugang und Passkey laufen. Weitere
   optionale Namen stehen in `apps/worker/.env.example`.
6. `APP_ORIGIN` in `apps/worker/wrangler.jsonc` steht auf der echten HTTPS-Adresse. Sie muss
   exakt `DEPLOY_URL` entsprechen und gilt für CSRF-Prüfung, Passkey-RP-ID und das Hostname des
   Turnstile-Widgets; ein späterer Subdomain-Wechsel bricht alle drei.
   Für `wrangler dev` lokal überschreiben:
   `pnpm --filter @notebook-lm/worker exec wrangler dev --var APP_ORIGIN:http://localhost:8787`
   (sonst setzt die App Secure-Cookies für die HTTPS-Adresse).
   Eigene KI-Endpunkte der Nutzer (BYOM, `docs/relationflow-integration.md`, Abschnitt 5):
   Optional `BYOM_ALLOWED_HOSTS` als Variable in `wrangler.jsonc` (kommagetrennt, z. B.
   `api.example.com,*.example.com`) schränkt sie auf diese Hosts ein. Ohne Wert ist jeder
   öffentliche HTTPS-Host auf Port 443 erlaubt; interne und private Ziele sind immer gesperrt.
   Die Tabelle `provider_endpoints` legt Migration `0006_custom_endpoints.sql` an (läuft mit den
   übrigen Migrationen im Deploy-Workflow). Schlüssel für eigene Endpunkte speichert der Worker
   nur mit gesetztem `KEK_V1`, verschlüsselt und an den Origin des Endpunkts gebunden.
7. Nach dem Deploy einmal im Browser als Gast anmelden und eine Chat-Frage stellen. Das braucht
   ein echtes Turnstile-Token und lässt sich deshalb nicht automatisch prüfen. Erst das beweist,
   dass `TURNSTILE_SECRET_KEY` und `DEMO_GEMINI_KEY` stimmen.

## Workers AI (Embeddings)

`apps/worker/wrangler.jsonc` bindet Workers AI als `AI` (`"ai": { "binding": "AI" }`). Ein eigenes
Anlegen im Dashboard ist nicht nötig; Workers AI ist im Free-Plan enthalten (10.000 Neuronen pro
Tag, siehe [platform-limits.md](./platform-limits.md)). Die Migration
`0008_ai_embedding_usage.sql` legt den Tageszähler an und läuft mit Schritt 4 des Workflows.

- **Token-Recht:** Laut Cloudflare braucht der Deploy eines Workers mit Bindings nur Editor-Rechte
  am Worker, keine eigenen Rechte an den gebundenen Ressourcen
  (<https://developers.cloudflare.com/workers/authorization/>, abgerufen 2026-11-14). Workers AI ist
  dort nicht ausdrücklich genannt. Scheitert der Deploy mit einem Berechtigungsfehler zu Workers AI,
  dem `CLOUDFLARE_API_TOKEN` zusätzlich *Account → Workers AI → Read* geben.
- **Lokal:** Workers AI läuft nie lokal. `wrangler dev` verbindet das Binding deshalb mit dem
  angemeldeten Konto und verbraucht dessen Kontingent. Der Lasttest
  (`load-test/run-local.mjs`) startet mit einer Kopie der Konfiguration ohne `ai` und läuft ohne
  Konto; Suche und Chat nutzen dort den Volltext-Rückfall. Die Node/Docker-Laufzeit hat kein
  Binding und arbeitet ebenfalls nur mit Volltext.
- **Nach dem Deploy prüfen:** eine Quelle hochladen und in D1
  `SELECT model, COUNT(*) FROM chunk_vectors GROUP BY model` abfragen; es sollte
  `@cf/google/embeddinggemma-2` erscheinen. Den Verbrauch zeigt
  `SELECT * FROM ai_embedding_usage`.
