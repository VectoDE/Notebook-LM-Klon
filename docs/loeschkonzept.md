# Löschkonzept

Stand: 2026-11-13 · Issue #258 · ergänzt #170 und #171

> Technische Vorprüfung, keine Rechtsberatung. Vor dem Produktivbetrieb bitte von einer Anwältin oder einem Anwalt für Datenschutzrecht prüfen lassen.

## Grundsatz

Personenbezogene Daten werden sofort aus der Datenbank (D1) und dem Dateispeicher (R2) gelöscht, sobald der Zweck entfällt oder die Person die Löschung verlangt. Backups verschwinden nicht sofort: D1 hält einen Wiederherstellungsverlauf (Time Travel), der nach spätestens 30 Tagen ausläuft.

## Löschwege

| Auslöser | Was gelöscht wird | Wann | Umsetzung |
|---|---|---|---|
| Person löscht ihr Konto (`DELETE /api/v1/me` mit `{"confirm":"DELETE_MY_ACCOUNT"}`) | Nutzerzeile, Passkeys, Sitzungen, Kontingente, Mitgliedschaften, Freigaben, BYOK-Schlüssel; eigene Arbeitsbereiche ohne weitere Mitglieder samt Notebooks, Quellen, Chunks, Vektoren, Chats, Nachrichten, Notizen und Artefakten; R2-Objekte unter `users/{id}/` und den Notebook-Präfixen gelöschter Arbeitsbereiche. Eigene Arbeitsbereiche mit weiteren Mitgliedern und Notebooks in fremden Arbeitsbereichen bleiben erhalten (siehe unten) | sofort, in derselben Anfrage | `apps/worker/src/account-routes.ts`, `purgeUsers()` in `apps/worker/src/cleanup.ts` |
| Gastkonto läuft ab (24 h) | wie Kontolöschung | stündlicher Cron (`0 * * * *`) | `runScheduledCleanup()` |
| Demo-Notebook läuft ab (30 Tage) | Notebook mit allen Inhalten und R2-Objekten | stündlicher Cron | `runScheduledCleanup()` |
| Sitzung oder Magic Link läuft ab | Sitzungs- bzw. Link-Hash | stündlicher Cron | `runScheduledCleanup()` |
| Quelle wird gelöscht | Quelle, Chunks, Vektoren, R2-Datei | sofort | `DELETE /api/v1/sources/:id` |

Die Kontolöschung verlangt eine aktive Sitzung, besteht die CSRF-Prüfung und setzt das Sitzungscookie zurück. Ohne den Bestätigungswert im Body antwortet der Worker mit `400 CONFIRMATION_REQUIRED` und löscht nichts.

Die Tests `apps/worker/src/__tests__/account-routes.test.ts` und `account-purge.test.ts` belegen, dass nach der Löschung in keiner der betroffenen Tabellen mehr eine Zeile der Person steht, dass ihre R2-Objekte weg sind und dass Daten anderer Personen erhalten bleiben.

## Bewusste Entscheidungen

- **Notebooks in fremden Arbeitsbereichen (Entscheidung F361):** Sie bleiben erhalten. `created_by` geht an den Besitzer des Arbeitsbereichs.
- **Eigener Arbeitsbereich mit weiteren Mitgliedern (Entscheidung F365):** Er geht an das am längsten beteiligte Admin-Mitglied (Rolle `owner`), sonst an das älteste Mitglied, das dabei die Rolle `owner` erhält. Nur Arbeitsbereiche ohne weitere Mitglieder werden samt Notebooks gelöscht.
- **Autorfelder:** Kommentare, Notizen, Chats und Artefakte der Person in bleibenden Notebooks werden auf das Platzhalterkonto `user_deleted` (Anzeigename „Gelöschtes Konto“, gesperrt, Migration 0009) umgehängt statt gelöscht.
- **Reihenfolge und Teilfehler:** Die D1-Schritte laufen je Block von höchstens 50 Konten in einem atomaren `D1.batch`; IDs werden in Blöcken zu höchstens 50 gebunden (D1 erlaubt 100 gebundene Parameter je Anfrage, <https://developers.cloudflare.com/d1/platform/limits/>). Erst danach folgt R2. Die R2-Präfixe stehen im selben Batch in `pending_r2_purge` und werden erst nach erfolgreichem Löschen entfernt; bei einem R2-Fehler räumt der stündliche Cron nach. Jeder Cron-Schritt läuft in eigenem `try/catch`, ein Fehler bei der Kontolöschung stoppt die übrigen Schritte nicht.
- **Kurzlebige Tabellen:** Mit dem Konto werden auch Magic Links zur E-Mail-Adresse, Rate-Limit-Zähler (`usr:{id}`) und der Gast-Tageszähler der Embeddings gelöscht.
- **Audit-Log:** Einträge bleiben bis zum Ende ihrer Aufbewahrungsfrist stehen, die Verknüpfung zur Person wird aber gelöscht (`user_id` wird `NULL`). Die IP liegt dort nur als gesalzener Hash vor.
- **Durable Objects:** Zwischengespeicherte Vektoren im `NotebookDO` werden nicht aktiv geleert. Sie hängen an der Notebook-ID, die nach der Löschung nicht mehr erreichbar ist, und werden beim nächsten Neuaufbau verworfen.

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
