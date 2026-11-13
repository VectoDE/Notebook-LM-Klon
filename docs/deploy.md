# Deploy auf Cloudflare Workers

Der Deploy läuft ausschließlich über den Workflow [`deploy.yml`](../.github/workflows/deploy.yml).
Er startet nur von Hand (**Actions → Deploy (manuelle Freigabe) → Run workflow**) und wartet
danach auf die Freigabe im GitHub Environment `production`. Push, Pull Request oder Zeitplan
lösen nie einen Deploy aus.

## Ablauf des Workflows

1. Prüft, ob `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` und `DEPLOY_URL` gesetzt sind und
   ob in `apps/worker/wrangler.jsonc` noch die Platzhalter-`database_id` steht. Fehlt etwas,
   bricht er vor jedem Zugriff auf Cloudflare ab.
2. Installiert die Abhängigkeiten, führt die Tests aus und baut die Web-Oberfläche.
3. Wendet die D1-Migrationen remote an (`wrangler d1 migrations apply notebook-lm-db --remote`,
   abschaltbar über den Eingang `run_migrations`).
4. Deployt den Worker (`wrangler deploy`). Cron (`0 * * * *`) und `nodejs_compat` kommen aus
   `apps/worker/wrangler.jsonc`.
5. Smoke-Check gegen `DEPLOY_URL` (`apps/worker/src/smoke-check.ts`): Health 200 mit
   `status: ok`, Web-Oberfläche liefert HTML, Gastzugang ohne Turnstile-Token wird mit 403
   abgelehnt (ein 503 hieße: Secrets fehlen), Chat ohne Sitzung antwortet 401.

Lokal lässt sich der Smoke-Check gegen jede laufende Instanz ausführen:

```bash
pnpm --filter @notebook-lm/worker exec tsx src/smoke-check.ts http://localhost:8787
```

## Schritte des Inhabers vor dem ersten Deploy

1. Environment `production` unter **Settings → Environments** anlegen bzw. prüfen und sich selbst
   als *Required reviewer* eintragen, Deploy-Branch auf `main` beschränken.
2. D1-Datenbank anlegen und die ID eintragen:
   `pnpm --filter @notebook-lm/worker exec wrangler d1 create notebook-lm-db`, dann
   `database_id` in `apps/worker/wrangler.jsonc` per Pull Request ersetzen.
3. R2-Bucket `notebook-lm-media` anlegen (`wrangler r2 bucket create notebook-lm-media`).
4. Environment-Secrets für den Workflow: `CLOUDFLARE_API_TOKEN` (Token mit Rechten für Workers,
   D1 und R2), `CLOUDFLARE_ACCOUNT_ID`; Environment-Variable `DEPLOY_URL`
   (z. B. die `*.workers.dev`-Adresse nach dem ersten Deploy).
5. Worker-Secrets setzen (Werte nur durch den Inhaber, nie im Repository):
   `wrangler secret put <NAME>` für `SESSION_SALT_SECRET`, `TURNSTILE_SECRET_KEY`,
   `RESEND_API_KEY`, `MAIL_FROM`, `DEMO_GEMINI_KEY`, `KEK`.
6. `APP_ORIGIN` in `apps/worker/wrangler.jsonc` auf die echte HTTPS-Adresse setzen.
7. Nach dem Deploy einmal im Browser als Gast anmelden und eine Chat-Frage stellen. Das braucht
   ein echtes Turnstile-Token und lässt sich deshalb nicht automatisch prüfen.
