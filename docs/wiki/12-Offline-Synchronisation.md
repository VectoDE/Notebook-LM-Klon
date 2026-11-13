# Offline-Bearbeiten mit Synchronisation

Stand: 13.11.2026 · Issue [#347](https://github.com/VectoDE/Notebook-LM-Klon/issues/347) · Entscheidung des Inhabers B10.128: Offline-Bearbeiten mit Synchronisation auf Basis von Yjs.

## Ausgangslage

Auf `main` gab es vor dieser Änderung weder Yjs noch eine Synchronisation (`rg -i "yjs|y-indexeddb|y-protocols"` ohne Treffer). Die Echtzeit-Kollaboration über WebSockets im NotebookDO ist eigene Arbeit (#29, #169). Dieses Issue legt deshalb die Grundlage, auf der die Kollaboration später aufsetzen kann: ein Yjs-Dokument je Notebook, gespeichert im NotebookDO, und eine Offline-Warteschlange im Browser.

Was heute synchronisiert wird: der **Notebook-Titel** (die einzige schreibende Bearbeitung, die die Oberfläche bisher nur lokal speicherte). Weitere Felder kommen in dasselbe Dokument (`Y.Map "meta"` oder eigene Typen), ohne die Synchronisation zu ändern.

## Ablauf

```text
Browser                                                       Worker / NotebookDO
Y.Doc ──update──► Warteschlange (IndexedDB, AES-GCM, #348)
                    │ online?
                    ├─ nein ─► Status „Offline · n Änderungen lokal gesichert“
                    └─ ja ──► POST /api/v1/notebooks/:id/doc  { update }  ──► mergeUpdates → SQLite im DO
                              GET  /api/v1/notebooks/:id/doc?sv=…          ◄── diffUpdate(Stand, sv)
                              Y.applyUpdate(remote) → Status „Alles synchronisiert“
```

1. Jede lokale Änderung am `Y.Doc` erzeugt ein Yjs-Update. Es kommt in die Warteschlange und, mit Sitzung, verschlüsselt in IndexedDB (Bereich `outbox:<notebook>`). Dazu wird ein verschlüsselter Schnappschuss des ganzen Dokuments gespeichert (Bereich `doc:<notebook>`). Klartext liegt nicht in IndexedDB, auch nicht in `localStorage`.
2. Ist der Browser online, gehen alle wartenden Updates zusammengeführt (`Y.mergeUpdates`) in **einem** POST raus. Erst nach der Bestätigung werden sie aus der Warteschlange gelöscht.
3. Danach holt der Client mit seinem Zustandsvektor genau das, was ihm fehlt (`Y.diffUpdate` auf dem Server).
4. Auslöser für einen Durchgang: jede Änderung, das Ereignis `online`, ein Neustart der Seite und alle 15 s, solange Änderungen warten.
5. Nach einem Neuladen stellt der Client Schnappschuss und Warteschlange aus der verschlüsselten Ablage wieder her und sendet, was noch offen ist.

## Konfliktauflösung

Yjs ist ein CRDT: Updates sind kommutativ, assoziativ und idempotent. Daraus folgt:

- Ein doppelt gesendetes Update (z. B. Antwort ging verloren, Client sendet erneut) ändert nichts.
- Gleichzeitige Änderungen an **verschiedenen** Feldern bleiben beide erhalten.
- Gleichzeitige Änderungen am **selben** Feld einer `Y.Map` enden auf allen Geräten beim selben Wert. Yjs entscheidet deterministisch nach der Client-ID; es ist nicht „wer zuletzt speichert“. Für einen Titel ist das angemessen. Für Fließtext (`Y.Text`) würden beide Eingaben zusammengeführt.
- Der Server führt nur zusammen und entscheidet nichts selbst. Jeder Client, der alle Updates kennt, hat denselben Stand.

Getestet in `offline-sync.test.ts` („Konflikt: verschiedene Felder bleiben beide …“), `doc-sync.test.ts` („gleichzeitige Offline-Änderungen konvergieren …“) und im Browser in `e2e/offline-sync.spec.ts` („Konflikt: Änderung eines anderen Geräts …“).

## Sichtbarer Status

Neben dem Titel steht ein `<output>`-Element (Rolle `status`, `aria-live="polite"` implizit). Texte auf Deutsch und Englisch:

| Zustand | Deutsch | Englisch |
| --- | --- | --- |
| syncing | Synchronisiert … | Syncing … |
| synced | Alles synchronisiert | All synced |
| pending | n Änderung(en) wartet/warten | n change(s) waiting |
| offline | Offline · n Änderung(en) lokal gesichert | Offline · n change(s) saved locally |
| error | Synchronisierung fehlgeschlagen · n Änderung(en) lokal gesichert | Sync failed · n change(s) saved locally |

Der Zustand ist nicht nur an der Farbe erkennbar: gefüllter Punkt (synchron), Ring (wartet), Ring mit Schrägstrich (offline), Rahmen um den ganzen Status (Fehler). Unter 900 px Breite zeigt die Leiste nur Symbol und Anzahl, damit der Titel Platz behält; der volle Text steht im Tooltip und wird von Screenreadern weiter angesagt.

Ohne Sitzung (kein Schlüssel nach #348) bleibt alles wie bisher: kein Status, der Titel wird lokal gespeichert.

## Server

- `GET /api/v1/notebooks/:id/doc?sv=…` (Rolle viewer) und `POST /api/v1/notebooks/:id/doc` mit `{ "update": "<base64url>" }` (Rolle editor). Beide `Cache-Control: no-store`.
- Der Stand liegt im NotebookDO (SQLite-Tabelle `notebook_doc`, eine Zeile). Durable Objects verarbeiten Anfragen je Objekt nacheinander; Lesen, Zusammenführen und Schreiben passieren ohne Wettlauf.
- Grenzen: 256 KiB je Update, 2 MiB je Notebook (413). Ungültige Updates und Zustandsvektoren werden mit 400 abgelehnt, bevor sie gespeichert werden.

## Abhängigkeit

`yjs` 13.6.33 (MIT, exakt gepinnt, in `apps/web` und `apps/worker`). Grund: Die Inhaber-Entscheidung legt Yjs als Grundlage fest, und ein eigenes CRDT wäre fehleranfälliger. Einzige Laufzeitabhängigkeit ist `lib0` (MIT, gleicher Autor). Im Browser wird Yjs erst nach erfolgreichem Schlüsselabruf per `import()` nachgeladen; das Start-Bundle wächst nicht. `y-protocols` und `y-indexeddb` werden nicht gebraucht: Das Protokoll ist hier ein einfacher HTTP-Austausch, und `y-indexeddb` speichert unverschlüsselt.

## Grenzen

- Die Arbeitsfläche nutzt noch Demo-Notebook-IDs (`nb_active`). Gegen einen echten Server antwortet der Endpunkt für unbekannte Notebooks mit 404; der Status zeigt dann „Synchronisierung fehlgeschlagen“, die Änderung bleibt lokal gesichert. Die Anbindung der Oberfläche an echte Notebooks ist nicht Teil dieses Issues.
- Ohne Service Worker lässt sich die Seite offline nicht neu laden. Offline-Bearbeiten wirkt also in einer bereits geöffneten Seite; nach dem Neuladen mit Verbindung wird gesendet.
- Echtzeit-Zusammenarbeit (WebSockets, Awareness) folgt in #29/#169 und kann dasselbe Dokument nutzen.

## Tests

| Test | Was er belegt |
| --- | --- |
| `apps/web/src/__tests__/offline-sync.test.ts` | Offline-Schreiben, Wiederverbindung mit einem gesammelten Update, Konflikt, Idempotenz, Serverfehler, Neustart mit verschlüsselter Warteschlange |
| `apps/web/src/__tests__/notebook-sync.test.ts` | Titel aus dem Server hat Vorrang vor einem alten lokalen Titel, Umbenennen, Betrieb ohne IndexedDB |
| `apps/web/src/__tests__/sync-status-text.test.ts` | Texte für jeden Zustand in DE und EN, Einzahl und Mehrzahl |
| `apps/worker/src/__tests__/doc-sync.test.ts` | Rechte (401, viewer liest, nur editor schreibt), Diff per Zustandsvektor, Konvergenz, Grenzen, kaputte Eingaben, 503 ohne DO |
| `apps/web/e2e/offline-sync.spec.ts` | `context.setOffline(true)`: offline umbenennen, Status, nur Chiffrat in IndexedDB, Senden bei Wiederverbindung; Konflikt; Neuladen mit wartender Änderung; ohne Sitzung kein Status; schmale Bildschirme ohne Layoutfehler |

Quellen: [Yjs-Dokumentation: Document Updates](https://docs.yjs.dev/api/document-updates), [Yjs: Y.Map](https://docs.yjs.dev/api/shared-types/y.map), [Cloudflare: Durable Objects SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/).
