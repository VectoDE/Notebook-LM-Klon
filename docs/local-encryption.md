# Verschlüsselte lokale Ablage (IndexedDB)

Stand: 13.11.2026 · Issue [#348](https://github.com/VectoDE/Notebook-LM-Klon/issues/348) · Entscheidung des Inhabers B10.129: IndexedDB wird verschlüsselt.

Diese Seite beschreibt, wie RelationNotes Daten im Browser ablegt, woher der Schlüssel kommt, was beim Abmelden passiert und welche Grenzen bleiben.

## Was lokal liegt

| Ablage | Inhalt | Schutz |
| --- | --- | --- |
| IndexedDB `rn-local-v1`, Store `records` | Nutzerinhalte, die ohne Netz gebraucht werden: Offline-Warteschlange (`outbox:<notebook>`) und Dokumentstand (`doc:<notebook>`) aus Issue #347, siehe [Offline-Synchronisation](offline-sync.md) | AES-GCM 256, nur Chiffrat |
| IndexedDB `rn-local-v1`, Store `meta` | Salz der Schlüsselableitung (16 Byte, nicht geheim) und ein verschlüsselter Prüfwert | Salz im Klartext, Prüfwert verschlüsselt |
| `localStorage` `rn_notebook_titles` | Notebook-Titel aus der Zeit vor der verschlüsselten Ablage | Klartext, wird beim Abmelden gelöscht |
| `localStorage` `rn_design`, `rn_color_mode`, `rn_language` und weitere `rn_*` | Darstellung und Bedienung | Klartext, keine Inhalte; bleibt nach dem Abmelden erhalten |

Vor dieser Änderung nutzte der Code keine IndexedDB (geprüft mit `rg -i indexeddb apps packages`). Die Architekturbilder nennen „Service Worker + IndexedDB“ als Ziel; einen Service Worker gibt es noch nicht.

## Schlüssel

Der Inhaber hat keine Schlüsselquelle festgelegt (Passphrase oder Konto-Sitzung). Gewählt ist die **Konto-Sitzung**, weil sie ohne zusätzliche Eingabe funktioniert und beim Abmelden automatisch ungültig wird. Eine Passphrase wäre stärker gegen einen Angreifer mit gültigem Sitzungs-Cookie, kostet aber eine weitere Eingabe und kann vergessen werden. Sie lässt sich später als zweite Stufe ergänzen.

```text
Server (Worker)                                     Browser
SESSION_SALT_SECRET ─┐
Nutzer-ID ───────────┼─ HKDF-SHA-256 ─► 32 Byte ──► GET /api/v1/auth/local-key (no-store)
Sitzungs-Hash ───────┘   (nicht gespeichert)            │
                                                        ▼
                                  Salz aus IndexedDB ─► HKDF-SHA-256 ─► AES-GCM-256-CryptoKey
                                                                         extractable: false
```

1. **Server:** `GET /api/v1/auth/local-key` verlangt eine gültige Sitzung. Das Material wird bei jedem Aufruf neu aus `SESSION_SALT_SECRET`, Nutzer-ID und Hash der Sitzung abgeleitet (`apps/worker/src/local-data-routes.ts`). Der Server speichert es nicht. Die Antwort trägt `Cache-Control: no-store`. Ohne `SESSION_SALT_SECRET` antwortet der Endpunkt mit 503.
2. **Browser:** Das Material geht direkt in `crypto.subtle.importKey("raw", …, "HKDF", false, …)` und wird danach mit Nullen überschrieben. Daraus entsteht per HKDF mit dem Salz der lokalen Datenbank ein AES-GCM-Schlüssel mit `extractable: false` (`apps/web/src/local-crypto.ts`). Weder Material noch Schlüssel landen in IndexedDB, `localStorage` oder `sessionStorage`; der `CryptoKey` lebt nur im Arbeitsspeicher der Seite.
3. **Neu laden:** Gleiche Sitzung ergibt gleiches Material, die Daten bleiben lesbar. Dafür braucht der Browser einmal Verbindung zum Server.
4. **Andere Sitzung:** Ein neuer Login (oder eine Sitzungsrotation) liefert anderes Material. Der verschlüsselte Prüfwert in `meta` lässt sich dann nicht entschlüsseln; die Ablage löscht die alten Chiffrate und beginnt neu (`reset: true`). Mit fremdem Schlüssel wären sie ohnehin unlesbar.

## Verschlüsselung

- Verfahren: AES-GCM mit 256-Bit-Schlüssel und 128-Bit-Tag über Web Crypto.
- Nonce: 96 Bit aus `crypto.getRandomValues` je Verschlüsselung. Nach NIST SP 800-38D (Abschnitt 8.3) sind mit zufälligen 96-Bit-Nonces höchstens 2^32 Verschlüsselungen je Schlüssel zulässig. `LocalCipher` zählt mit und verweigert danach weitere Aufrufe (`nonce-limit`). Weil jede Sitzung einen eigenen Schlüssel hat, wird die Grenze praktisch nicht erreicht.
- AAD: `["rn-local", 1, Bereich, ID]` als JSON. Damit fällt auf, wenn ein Chiffrat unter einer anderen ID oder in einem anderen Bereich eingespielt wird. Die JSON-Form verhindert Mehrdeutigkeiten durch Trennzeichen.
- Datensatz: `{ area, id, v, iv, ct }`. Bereich und ID stehen im Klartext, weil IndexedDB sie als Schlüssel braucht. Sie enthalten keine Inhalte (z. B. `outbox` und eine zufällige ID).

## Abmelden

Der Knopf „Abmelden und lokale Daten löschen“ steht im Konto-Menü und im Menü auf dem Telefon. Ablauf (`apps/web/src/local-session.ts`):

1. Offene Verbindungen der Seite schließen, dann `indexedDB.deleteDatabase("rn-local-v1")`. Andere Tabs schließen ihre Verbindung über `onversionchange`, danach läuft das Löschen durch.
2. `rn_notebook_titles` aus `localStorage` entfernen.
3. `POST /api/v1/auth/logout`: Der Server löscht die Sitzung und setzt ein abgelaufenes Cookie. Antwortet auch ohne Sitzung mit 204.

Das lokale Löschen kommt zuerst, damit es auch ohne Netz gelingt. Ist der Server nicht erreichbar, meldet die Oberfläche das offen; die Sitzung endet dann spätestens nach ihrer Laufzeit (7 Tage, gleitend). Selbst wenn ein Rest der Datenbank überlebt (abgestürzter Tab, voller Datenträger), ist er nach dem Ende der Sitzung nicht mehr entschlüsselbar, weil das Material nur für eine lebende Sitzung abgeleitet wird.

## Was die Verschlüsselung schützt und was nicht

| Szenario | Geschützt? |
| --- | --- |
| Jemand kopiert das Browserprofil oder liest die Festplatte (gestohlenes Gerät, Backup, Forensik) | Ja. Es liegen nur Chiffrat, Salz und Prüfwert vor; der Schlüssel liegt nicht auf dem Datenträger. |
| Gleiches Szenario, aber das Sitzungs-Cookie ist noch gültig und wird mitkopiert | Nein. Wer das Cookie hat, kann das Material beim Server abrufen. Abhilfe: abmelden. Eine optionale Passphrase wäre die nächste Stufe. |
| Schadcode in der Seite (XSS) | Nein. Er kann alles lesen, was die Seite entschlüsselt. Schutz dagegen leisten CSP und die übrigen Sicherheits-Header, nicht die Verschlüsselung. |
| Bösartige Browser-Erweiterung | Nein, aus demselben Grund. |
| Datensätze vertauschen oder verändern | Ja, AES-GCM-Tag und AAD erkennen es (`decrypt`-Fehler). |
| Gerät nach dem Abmelden | Ja, die Datenbank ist gelöscht (Test unten) und die Sitzung serverseitig beendet. |

## Sicherheitsprüfung des Diffs

Geprüft am 13.11.2026 anhand des Diffs von Issue #348:

- **Nonce-Eindeutigkeit:** Jede Verschlüsselung zieht 12 neue Zufallsbytes aus `crypto.getRandomValues` (CSPRNG). Keine Wiederverwendung im Code, kein Zähler, der über Tabs kollidieren könnte. Obergrenze 2^32 je Schlüssel durchgesetzt und getestet (`local-crypto.test.ts`, „verweigert nach der Nonce-Obergrenze …“). Zwei Verschlüsselungen desselben Werts ergeben verschiedene Nonces und Chiffrate (getestet).
- **AAD:** Bereich, ID und Formatversion sind gebunden. Getestet: anderer Bereich, andere ID und ein in IndexedDB roh umbenannter Datensatz schlagen fehl (`encrypted-store.test.ts`, „erkennt vertauschte Datensätze über die AAD“).
- **Schlüssel-Lebenszyklus:** Ableitung nur serverseitig aus Geheimnis plus Sitzung, nicht gespeichert; Abruf nur mit Sitzung (401 ohne), `no-store`. Im Browser nicht exportierbar (`exportKey` schlägt fehl, getestet), Rohmaterial nach Import genullt (getestet, auch im Fehlerfall). Nach `POST /api/v1/auth/logout` liefert derselbe Cookie 401 (getestet in `local-data-routes.test.ts`). Andere Sitzung oder anderer Nutzer ergibt anderes Material (getestet).
- **Klartext auf dem Datenträger:** Test liest die Rohdatensätze aus IndexedDB und findet die gespeicherten Texte nicht (`encrypted-store.test.ts`, „… nur Chiffrat in IndexedDB“); im Browser zusätzlich per Playwright (`e2e/lokale-verschluesselung.spec.ts`).
- **Domain-Trennung:** `SESSION_SALT_SECRET` dient bisher als Salz für IP- und User-Agent-Hashes. Die neue Nutzung läuft über HKDF mit eigenem Salz (`relationnotes/local-idb-key/v1`) und eigenem `info`; die Ausgaben sind voneinander unabhängig. Wird das Geheimnis gewechselt, werden lokale Daten unlesbar und neu angelegt; das ist gewollt.
- **CSRF:** `POST /api/v1/auth/logout` läuft durch die globale CSRF-Prüfung (Origin und `Sec-Fetch-Site`). `GET /api/v1/auth/local-key` ist lesend und liefert Material nur an Aufrufer mit Cookie; fremde Seiten können die Antwort wegen der Same-Origin-Policy nicht lesen (keine CORS-Freigabe).
- **Offen:** Keine Passphrase-Stufe. Kein Service Worker, deshalb kein Kaltstart ohne Netz. Beides ist bewusst nicht Teil dieses Issues.

## Tests

| Test | Was er belegt |
| --- | --- |
| `apps/web/src/__tests__/local-crypto.test.ts` | Ableitung, `extractable: false`, Nullen des Materials, Nonce-Frische und -Obergrenze, AAD, Manipulation, Formatprüfung |
| `apps/web/src/__tests__/encrypted-store.test.ts` | Speichern, Lesen, Listen, Löschen; nur Chiffrat in IndexedDB; Wiederöffnen; Sitzungswechsel; Löschen der Datenbank nachweisbar (`localDataExists` danach `false`) |
| `apps/web/src/__tests__/local-session.test.ts` | Schlüsselabruf (401, 503, Netzfehler, kaputte Antworten), Reihenfolge beim Abmelden, Abmelden offline |
| `apps/worker/src/__tests__/local-data-routes.test.ts` | 401 ohne Sitzung, stabiles Material je Sitzung, verschieden je Sitzung und Nutzer, Abmelden beendet die Sitzung, 503 ohne Geheimnis |
| `apps/web/e2e/lokale-verschluesselung.spec.ts` | In Chromium: verschlüsselt schreiben, Rohdaten ohne Klartext, Abmelden über die Oberfläche, danach keine Datenbank `rn-local-v1` mehr |

Quellen: [NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final) (GCM, Abschnitt 8.3), [W3C Web Cryptography API](https://www.w3.org/TR/WebCryptoAPI/), [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869) (HKDF), [W3C Indexed Database API 3.0](https://www.w3.org/TR/IndexedDB/).
