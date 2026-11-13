# KEK: Prüfung des früheren festen Schlüssels und Rotationsprozess

Stand: 2026-11-13 · Bezug: Issue #282, Fix in PR #271 (Commit `9ae35fb`)

## Worum es geht

Bis zum Commit `9ae35fb` (11.11.2026) hat `createKeyVaultFromEnv` ohne gesetztes Secret still einen
festen Schlüssel als KEK v1 benutzt. Dieser Schlüssel steht öffentlich im Repository. Jeder BYOK-Schlüssel,
der in dieser Zeit in einer Umgebung **ohne** eigenes `KEK_V1`/`BYOK_MASTER_KEY` gespeichert wurde, lässt
sich von jedem entschlüsseln, der Lesezugriff auf die Datenbank hat. Solche Schlüssel gelten als
kompromittiert.

Seit `9ae35fb` wirft der Worker einen Fehler, wenn kein KEK konfiguriert ist (fail closed). Neue Schlüssel
können also nicht mehr mit dem festen Wert verschlüsselt werden.

## Befund vom 13.11.2026 (nur lesend geprüft)

| Prüfung | Ergebnis | Beleg |
|---|---|---|
| D1-Datenbank in `apps/worker/wrangler.jsonc` | Platzhalter `00000000-0000-0000-0000-000000000001`, in der gesamten Git-Historie nie eine echte ID | `git log --all -- apps/worker/wrangler.jsonc`, alle Stände geprüft |
| Deploy-Workflow im Repository | Keiner. Vorhanden sind nur `ci.yml`, `codeql.yml`, `scorecard.yml`, `verify-issue-checklists.yml`, `wiki-sync.yml`; kein Workflow ruft `wrangler deploy` auf, auch nicht in der Historie | `.github/workflows/`, `git log -G "wrangler (deploy\|publish)" -- .github` |
| GitHub-Läufe | Nur CI, CodeQL, Scorecard, Checklisten-Prüfung und Wiki-Sync, kein Deploy-Lauf | `gh run list --limit 200` |
| GitHub-Deployments und Environments | 0 Deployments, 0 Environments | `gh api repos/VectoDE/Notebook-LM-Klon/deployments`, `.../environments` |
| Repository-Secrets und -Variablen | Keine (also auch kein `CLOUDFLARE_API_TOKEN` für automatische Deploys) | `gh secret list`, `gh variable list` |
| Cloudflare-Konto (Worker `notebook-lm-klon`, D1 `notebook-lm-db`) | **Nicht prüfbar**: kein Lesezugriff auf das Konto aus dieser Umgebung | Inhaber-Schritt, siehe unten |

**Einschätzung:** Aus dem Repository heraus gibt es keinen Hinweis auf eine Live-Umgebung. Die
Konfiguration verweist auf keine echte Datenbank, und es gab nie einen automatischen Deploy. Ein manueller
`wrangler deploy` vom Rechner des Inhabers lässt sich aus GitHub aber nicht ausschließen. Deshalb bleibt
die Kontoprüfung ein offener Inhaber-Schritt.

## Inhaber-Schritt: Kontoprüfung (nur lesend)

Mit angemeldetem Wrangler (`npx wrangler login`), aus `apps/worker`:

```bash
# 1. Gibt es den Worker überhaupt?
npx wrangler deployments list --name notebook-lm-klon

# 2. Gibt es die Datenbank?
npx wrangler d1 list

# 3. Nur wenn beides existiert: wie viele BYOK-Schlüssel liegen dort, und seit wann?
npx wrangler d1 execute notebook-lm-db --remote --command \
  "SELECT COUNT(*) AS anzahl, MIN(created_at) AS erster, MAX(updated_at) AS letzter FROM provider_keys"

# 4. Waren Secrets gesetzt? (zeigt nur Namen, keine Werte)
npx wrangler secret list --name notebook-lm-klon
```

Auswertung:

- Kein Worker oder keine Datenbank, oder `anzahl = 0`: Es gibt keine betroffenen Daten. Ergebnis im Issue
  #282 festhalten, Issue schließen.
- `anzahl > 0` und `KEK_V1` bzw. `BYOK_MASTER_KEY` war vor dem Deploy des Fixes **nicht** gesetzt:
  alle Schlüssel mit `created_at` bzw. `updated_at` vor diesem Deploy sind kompromittiert. Weiter mit dem
  Vorfallablauf.
- Unklar, ob das Secret damals gesetzt war: wie kompromittiert behandeln.

## Vorfallablauf, falls Live-Daten betroffen sind

Ein Rekey (`POST /api/v1/keys/rekey`) hilft hier **nicht**: Wer die alte Datenbank gelesen hat, kennt den
Klartext-Schlüssel bereits. Der Anbieter-Schlüssel selbst muss ersetzt werden.

1. **Neuen KEK setzen:** `npx wrangler secret put KEK_V2` (32 Byte, zufällig, z. B.
   `openssl rand -hex 32`), danach `KEK_CURRENT_VERSION=2`. Den alten festen Wert nie als Secret
   verwenden.
2. **Betroffene Zeilen löschen:** `DELETE FROM provider_keys WHERE updated_at < <Zeitpunkt des Fix-Deploys>`
   (vorher den genauen Zeitpunkt aus `wrangler deployments list` übernehmen und die Abfrage mit `SELECT`
   gegenprüfen).
3. **Nutzer informieren:** Betroffene Nutzer stammen aus `provider_keys.user_id` → `users.email`. Inhalt:
   was passiert ist, welcher Anbieter betroffen ist (Spalte `provider`, nur `last4` nennen), Bitte, den
   Schlüssel beim Anbieter zu widerrufen und in RelationNotes neu einzugeben.
4. **Neueingabe:** Nutzer speichern ihre neuen Schlüssel über die Einstellungen; sie werden mit KEK v2
   verschlüsselt.
5. **Nachweis:** Ablauf mit Datum, Anzahl betroffener Zeilen und Versand der Information im Issue #282
   festhalten.

## Meldepflichten

API-Schlüssel sind für sich meist keine personenbezogenen Daten, sie hängen in `provider_keys` aber an
einem Nutzerkonto mit E-Mail-Adresse. Ob eine Verletzung des Schutzes personenbezogener Daten nach
Art. 33 DSGVO (Meldung an die Aufsichtsbehörde binnen 72 Stunden) oder Art. 34 DSGVO (Benachrichtigung
der Betroffenen) vorliegt, hängt vom Einzelfall ab, etwa davon, ob ein unbefugter Zugriff wahrscheinlich
ist. Das entscheidet nicht dieses Dokument: Bei betroffenen Live-Daten vor jeder Meldung oder
Nicht-Meldung den Datenschutzbeauftragten bzw. einen Anwalt einbeziehen und die Entscheidung mit
Begründung dokumentieren (Art. 33 Abs. 5 DSGVO).

## Regulärer Rotationsprozess (ohne Vorfall)

Für den geplanten Wechsel des KEK, etwa jährlich oder beim Ausscheiden einer Person mit Zugriff:

1. Neuen KEK als nächste Version anlegen: `npx wrangler secret put KEK_V<n+1>`. Der alte KEK bleibt
   gesetzt, sonst lassen sich bestehende Schlüssel nicht mehr lesen.
2. `KEK_CURRENT_VERSION` auf `n+1` setzen und deployen. Neue Schlüssel werden ab jetzt mit der neuen
   Version verschlüsselt.
3. Bestehende Schlüssel umschlüsseln: `POST /api/v1/keys/rekey` (je Nutzer, Ergebnis `rotated`, `failed`,
   `skipped`). Ein späterer Batch-Lauf für alle Nutzer ist im Code vorbereitet
   (`RagRepository.getAllProviderKeys`).
4. Prüfen, dass keine Zeile mehr die alte Version trägt:
   `SELECT key_version, COUNT(*) FROM provider_keys GROUP BY key_version`.
5. Erst dann den alten KEK entfernen: `npx wrangler secret delete KEK_V<n>`.

Technischer Hintergrund zur Verschlüsselung (AES-256-GCM, Envelope, AAD aus Nutzer und Anbieter):
[security-and-compliance.md](./security-and-compliance.md).

_Dieses Dokument ist eine technische Vorprüfung und ersetzt keine Rechtsberatung._
