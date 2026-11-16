# Löschkonzept

Stand: 2026-11-13 · Issue #258 · ergänzt #170 und #171

> Technische Vorprüfung, keine Rechtsberatung. Vor dem Produktivbetrieb bitte von einer Anwältin oder einem Anwalt für Datenschutzrecht prüfen lassen.

## Grundsatz

Personenbezogene Daten werden sofort aus der Datenbank (D1) und dem Dateispeicher (R2) gelöscht, sobald der Zweck entfällt oder die Person die Löschung verlangt. Backups verschwinden nicht sofort: D1 hält einen Wiederherstellungsverlauf (Time Travel), der nach spätestens 30 Tagen ausläuft.

## Löschwege

| Auslöser | Was gelöscht wird | Wann | Umsetzung |
|---|---|---|---|
| Person löscht ihr Konto (`DELETE /api/v1/me` mit `{"confirm":"DELETE_MY_ACCOUNT"}`, Sitzung höchstens 5 Minuten alt) | Nutzerzeile, Passkeys, Sitzungen, Kontingente, Mitgliedschaften, Freigaben, BYOK-Schlüssel; eigene Arbeitsbereiche ohne weitere Mitglieder samt Notebooks, Quellen, Chunks, Vektoren, Chats, Nachrichten, Notizen und Artefakten; R2-Objekte unter `users/{id}/` und den Notebook-Präfixen gelöschter Arbeitsbereiche; Durable-Object-Zustand der gelöschten Notebooks. Eigene Arbeitsbereiche mit weiteren Mitgliedern und Notebooks in fremden Arbeitsbereichen bleiben erhalten (siehe unten) | sofort, in derselben Anfrage | `apps/worker/src/account-routes.ts`, `purgeUsers()` in `apps/worker/src/cleanup.ts` |
| Gastkonto läuft ab (Lebensdauer 24 h) | wie Kontolöschung | beim ersten stündlichen Cron-Lauf (`0 * * * *`) nach Ablauf, also spätestens rund 25 Stunden nach der Anmeldung; je Lauf höchstens 100 Konten, ein größerer Rückstau wird in den Folgeläufen abgebaut | `runScheduledCleanup()` |
| Demo-Notebook läuft ab (30 Tage) | Notebook mit allen Inhalten und R2-Objekten | stündlicher Cron | `runScheduledCleanup()` |
| Sitzung oder Magic Link läuft ab (Link: 15 Minuten gültig) | Sitzungs- bzw. Link-Hash | beim nächsten stündlichen Cron-Lauf | `runScheduledCleanup()` |
| Rate-Limit-Zähler und Gast-Tageszähler der Embeddings | Zähler je Konto oder IP | Rate-Limit-Zeilen älter als 24 h und Embedding-Zähler früherer UTC-Tage beim nächsten stündlichen Cron-Lauf | `runScheduledCleanup()` |
| Quelle wird gelöscht | Quelle, Chunks, Vektoren, R2-Datei | sofort | `DELETE /api/v1/sources/:id` |

Die Kontolöschung verlangt eine aktive Sitzung, besteht die CSRF-Prüfung und setzt das Sitzungscookie zurück. Ohne den Bestätigungswert im Body antwortet der Worker mit `400 CONFIRMATION_REQUIRED` und löscht nichts.

**Frische Anmeldung (Re-Authentifizierung):** Konten mit Anmeldung (Passkey oder Magic-Link) können nur gelöscht werden, wenn die Sitzung höchstens 5 Minuten alt ist (`sessions.created_at`). Ist sie älter, antwortet der Worker mit `403 REAUTH_REQUIRED` und löscht nichts; die Person meldet sich neu an und wiederholt die Löschung. Begründung der Variante: Beide Anmeldewege des Projekts erzeugen beim Erfolg eine neue Sitzung, das Sitzungsalter ist also der Zeitpunkt des letzten Identitätsnachweises. Das braucht keinen zusätzlichen Mailversand, keinen neuen Zustand und keinen zweiten Anmeldeweg; ein gestohlenes Cookie reicht damit nicht für die unwiderrufliche Löschung, sobald der Diebstahl mehr als 5 Minuten nach der Anmeldung geschieht. Ein Cookie-Dieb im 5-Minuten-Fenster wird dadurch nicht abgewehrt; das wäre nur mit einer zusätzlichen Passkey- oder Mail-Bestätigung je Löschung möglich. Gastkonten sind ausgenommen: Sie haben weder E-Mail noch Passkey, die man erneut bestätigen könnte, und laufen nach 24 Stunden ohnehin ab.

Die Tests `apps/worker/src/__tests__/account-routes.test.ts` und `account-purge.test.ts` belegen, dass nach der Löschung in keiner der betroffenen Tabellen mehr eine Zeile der Person steht, dass ihre R2-Objekte weg sind und dass Daten anderer Personen erhalten bleiben.

## Bewusste Entscheidungen

- **Notebooks in fremden Arbeitsbereichen (Entscheidung F361):** Sie bleiben erhalten. `created_by` geht an den Besitzer des Arbeitsbereichs.
- **Eigener Arbeitsbereich mit weiteren Mitgliedern (Entscheidung F365):** Er geht an das am längsten beteiligte Admin-Mitglied (Rolle `owner`), sonst an das älteste Mitglied, das dabei die Rolle `owner` erhält. Gastkonten kommen nur infrage, wenn es kein anderes Mitglied gibt. Konten, die im selben Lauf gelöscht werden (auch in anderen Blöcken von 50), scheiden aus. Nur Arbeitsbereiche ohne weitere Mitglieder werden samt Notebooks gelöscht.
- **Autorfelder:** Kommentare, Notizen, Chats und Artefakte der Person in bleibenden Notebooks werden auf das Platzhalterkonto `user_deleted` (Anzeigename „Gelöschtes Konto“, gesperrt, Migration 0009) umgehängt statt gelöscht.
- **Reihenfolge und Teilfehler:** Die D1-Schritte laufen je Block von höchstens 50 Konten in einem atomaren `D1.batch`; IDs werden in Blöcken zu höchstens 50 gebunden (D1 erlaubt 100 gebundene Parameter je Anfrage, <https://developers.cloudflare.com/d1/platform/limits/>). Erst danach folgt R2. Die R2-Präfixe stehen im selben Batch in `pending_r2_purge` und werden erst nach erfolgreichem Löschen entfernt; bei einem R2-Fehler räumt der stündliche Cron nach. Jeder Cron-Schritt läuft in eigenem `try/catch`, ein Fehler bei der Kontolöschung stoppt die übrigen Schritte nicht.
- **Kurzlebige Tabellen:** Mit dem Konto werden auch Magic Links zur E-Mail-Adresse, Rate-Limit-Zähler (`usr:{id}`) und der Gast-Tageszähler der Embeddings gelöscht. Ohne Kontolöschung räumt der stündliche Cron auf: Magic Links nach Ablauf der 15 Minuten, Rate-Limit-Zeilen (der Schlüssel kann eine Client-IP enthalten) sobald ihr Fenster (1 Minute) mehr als 24 Stunden zurückliegt, Embedding-Zähler früherer UTC-Tage. Die Fristen sind damit je Tabelle: Magic Link 15 Minuten plus bis zu 1 Stunde, Rate-Limit höchstens 24 Stunden plus bis zu 1 Stunde, Embedding-Zähler bis zum Ende des UTC-Tages plus bis zu 1 Stunde. Die Angabe „24 h“ gilt also für Rate-Limit-Zeilen und für die Lebensdauer von Gastkonten, nicht für Magic Links.
- **Audit-Log:** Einträge bleiben bis zum Ende ihrer Aufbewahrungsfrist von 90 Tagen stehen (`AUDIT_RETENTION_DAYS` in `apps/worker/src/audit-log.ts`, durchgesetzt vom stündlichen Cron in einem eigenen, von der Kontolöschung unabhängigen Schritt). Die Verknüpfung zur Person wird gelöscht: `user_id` wird `NULL`, und das Feld `target` enthält nie eine Konto-ID. Anmeldungen schreiben `user:self`, die Kontolöschung `account.delete` mit `user:deleted`; ältere Zeilen mit `user:<id>` setzt `purgeUsers` beim Löschen auf `user:deleted`. Die IP liegt nur als tagesweise gesalzener Hash vor, Quelleninhalte nie. Der Cron löscht abgelaufene Einträge in Blöcken zu 1.000 Zeilen, höchstens 5 Blöcke je Lauf; Cloudflare empfiehlt für große Löschungen Blöcke (Abfragedauer höchstens 30 Sekunden, 50 Abfragen je Aufruf im Free-Tarif, <https://developers.cloudflare.com/d1/platform/limits/>), ein größerer Rückstau verschwindet über die folgenden stündlichen Läufe. Es gibt nur Audit-Aktionen, die der Code schreibt (Anmeldung, Quellenlöschung, Kontolöschung); Aktionen für Freigaben und Exporte fehlen bewusst, weil es dafür keine Routen gibt. Scheitert das Schreiben des Eintrags `account.delete`, läuft die Löschung durch, der Fehler wird als strukturierte Logzeile `audit_log_critical_failed` ausgegeben (Anlass für einen Alarm) und der Eintrag samt Originalzeit mit Präfix `audit-retry:` in `pending_r2_purge` vorgemerkt; der stündliche Cron schreibt ihn nach. Scheitert auch das Vormerken (Datenbank nicht erreichbar), meldet `audit_log_lost` den Verlust.
- **Durable Objects:** Der `NotebookDO` speichert je Notebook das gemeinsam bearbeitete Yjs-Dokument (`notebook_doc`) und einen Vektor-Cache (`do_vectors`, nur eine Kopie der Vektoren aus D1). Beides wird beim Löschen eines Notebooks aktiv geleert (`POST /purge`, intern, `storage.deleteAll()`; offene WebSockets werden geschlossen). Die Anfrage steht im selben atomaren Batch wie die Löschung als Eintrag `notebook-state:<id>` in `pending_r2_purge`; scheitert sie, räumt der Cron nach. Vor jedem Leeren prüft der Worker, dass das Notebook nicht mehr existiert, damit nie das Dokument eines bestehenden Notebooks verloren geht. Gilt auch für abgelaufene Demo-Notebooks. Notebooks, die erhalten bleiben (fremde Arbeitsbereiche, übergebene Bereiche), behalten ihren Zustand. Der `JobDO` (eine Instanz je Notebook) hält Aufträge samt Payload, darin die Nutzer-ID des Auftraggebers, und Ergebnis; er wird deshalb auf demselben Weg geleert (`POST /purge` mit `deleteAll()`, im selben Nachlauf-Eintrag wie der NotebookDO). In Notebooks, die erhalten bleiben, bleiben die Aufträge liegen: Dort steht die ID eines Kontos, dessen Zeile gelöscht ist, die Artefakte selbst gehören dem Platzhalterkonto. Ein Rückschluss auf eine Person ist nur über Backups (Time Travel) möglich.

## Backups: D1 Time Travel

D1 schreibt laufend einen Wiederherstellungsverlauf mit, aus dem sich die Datenbank auf einen beliebigen Zeitpunkt zurücksetzen lässt. Laut Cloudflare-Dokumentation (<https://developers.cloudflare.com/d1/reference/time-travel/>, abgerufen 2026-11-13):

- Time Travel ist immer aktiv und lässt sich nicht abschalten.
- Aufbewahrung: bis zu 30 Tage im Workers-Paid-Tarif, 7 Tage im Workers-Free-Tarif.
- Die Dauer lässt sich nicht selbst einstellen.

Folgen für das Löschkonzept:

- Gelöschte Daten sind im Verlauf noch bis zu 30 Tage (Free: 7 Tage) enthalten und danach endgültig weg. Ein eigener Backup-Rhythmus muss nicht eingerichtet werden; die 30 Tage ergeben sich aus dem Tarif.
- Wird die Datenbank auf einen Zeitpunkt vor einer Löschung zurückgesetzt, tauchen gelöschte Konten wieder auf. Nach jeder Wiederherstellung muss deshalb die Löschung erneut ausgeführt werden. Dazu reicht es, die Kontolöschungen seit dem Wiederherstellungszeitpunkt zu wiederholen; Gastkonten und Demo-Notebooks räumt der Cron von selbst wieder ab.
- R2 hat keine Versionierung in diesem Projekt. Gelöschte Objekte sind sofort weg und kehren bei einer D1-Wiederherstellung nicht zurück.
- Weitere Backups (Exporte mit `wrangler d1 export`) werden nicht angelegt. Wer sie anlegt, muss sie spätestens nach 30 Tagen löschen.

## Grenzen

- Die Löschung im Time-Travel-Verlauf lässt sich nicht beschleunigen.
- Logs von Cloudflare (Observability) liegen außerhalb dieses Konzepts und folgen den Aufbewahrungsfristen von Cloudflare.
- Die Wiederholung von Löschungen nach einer Wiederherstellung ist ein manueller Betriebsschritt.

Siehe auch [Verarbeitungsverzeichnis](./verarbeitungsverzeichnis.md) und [Datenschutzhinweise](./datenschutz.md).
