# Offline-Chat mit lokalem Modell

Stand: 13.11.2026 · Issue [#346](https://github.com/VectoDE/Notebook-LM-Klon/issues/346) · Entscheidung des Inhabers B10.126: Offline-Chat in 0.1, mit lokalem Modell im Browser.

## Ergebnis

- **Laufzeit:** [WebLLM](https://github.com/mlc-ai/web-llm) (MLC) `@mlc-ai/web-llm` 0.2.87, Apache-2.0, exakt gepinnt.
- **Modell:** Qwen2.5-1.5B-Instruct, 4-Bit quantisiert (`q4f16_1`), Apache-2.0.
- **Download:** rund 0,9 GB einmalig (Gewichte, Tokenizer, Konfiguration 880 MB plus WebAssembly-Bibliothek 6,2 MB). Danach lädt der Browser das Modell aus dem Cache Storage.
- **Grafikspeicher:** rund 1,6 GB (WebLLM-Angabe `vram_required_MB` 1629,75 bei 4096 Token Kontext).
- **Voraussetzung:** WebGPU. Ohne WebGPU gibt es keinen lokalen Chat, die Oberfläche sagt das offen.
- **Kosten:** keine. Modell und Laufzeit sind frei nutzbar, der Download kommt von Hugging Face und GitHub.

## Laufzeiten im Vergleich

| Laufzeit | Version, Lizenz | WebGPU / WASM | Größe im Browser | Bewertung |
| --- | --- | --- | --- | --- |
| **WebLLM (MLC)** | 0.2.87, Apache-2.0; einzige Laufzeitabhängigkeit `loglevel` (MIT) | WebGPU Pflicht | 6,1 MB JS (2,2 MB gzip), eigener Chunk | Gewählt. Fertige 4-Bit-Modelle für den Browser, OpenAI-ähnliche Chat-API mit Stream, Cache Storage, IndexedDB oder OPFS als Ablage, SRI-Prüfung für Konfiguration, Tokenizer und WebAssembly. |
| transformers.js (ONNX Runtime Web) | `@huggingface/transformers` 4.3.2, Apache-2.0 | WebGPU, Rückfall auf WASM | Paket 10 MB, zieht `onnxruntime-web` | Hat den WASM-Rückfall. Ein 1,5B-Modell erzeugt auf der CPU aber nur wenige Token pro Sekunde; für einen Chat ist das zu langsam. Der Rückfall hätte also nur auf dem Papier geholfen. |
| MediaPipe LLM Inference | `@mediapipe/tasks-genai` 0.10.30, Apache-2.0 | WebGPU | Paket 82,6 MB (entpackt) | Modelle vor allem Gemma (Gemma-Nutzungsbedingungen). Die Web-Dokumentation leitet inzwischen auf LiteRT-LM weiter (abgerufen am 13.11.2026). Nicht gewählt. |

Versionen und Größen per `npm view` am 13.11.2026. 0.2.87 statt 0.2.88 (10.11.2026), weil die neueste Version erst drei Tage alt war; 0.2.87 ist zwei Wochen veröffentlicht.

## Modelle im Vergleich

Alle Zahlen für die 4-Bit-Fassung `q4f16_1` aus der Modellliste von WebLLM 0.2.87 und der Dateiliste der MLC-Repos auf Hugging Face.

| Modell | Lizenz (Lizenztext geprüft) | Download | Grafikspeicher | Deutsch |
| --- | --- | --- | --- | --- |
| **Qwen2.5-1.5B-Instruct** | Apache-2.0 | 880 MB | 1,6 GB | Laut Qwen „über 29 Sprachen, darunter … Deutsch“ |
| Qwen2.5-0.5B-Instruct | Apache-2.0 | 290 MB | 0,9 GB | wie oben, aber spürbar schwächere Antworten |
| Qwen2.5-3B-Instruct | Qwen Research License, nur nicht-kommerziell | – | 2,5 GB | ausgeschlossen wegen Lizenz |
| Qwen3-1.7B | Apache-2.0 | 984 MB | 2,0 GB | mehrsprachig; Denkmodus müsste abgeschaltet werden, mehr Speicher |
| Llama-3.2-1B-Instruct | Llama 3.2 Community License mit Acceptable Use Policy, Pflicht zum Hinweis „Built with Llama“ | 705 MB | 0,9 GB | Deutsch offiziell unterstützt |
| gemma-2-2b-it | Gemma Terms of Use mit Prohibited Use Policy | 1,5 GB | – | mehrsprachig |
| Phi-3.5-mini-instruct | MIT | 2,2 GB | 3,7 GB | mehrsprachig; zu groß für viele Laptops |

Gewählt ist Qwen2.5-1.5B-Instruct: freie Lizenz ohne Nutzungsbeschränkung, Deutsch ausdrücklich genannt, unter 1 GB Download und unter 2 GB Grafikspeicher. Llama und Gemma wären technisch möglich, bringen aber eigene Nutzungsbedingungen mit, die an Endnutzer weitergegeben werden müssten. Die Wahl steht in `apps/web/src/local-llm-config.ts` und lässt sich dort ändern. Rechtlich verbindlich ist das nicht; vor einem kommerziellen Einsatz sollte jemand mit juristischer Ausbildung die Lizenzen ansehen.

## Ablauf

```text
Frage ─► online (navigator.onLine)?
           ├─ ja ─► Server-Chat (RAG mit geprüften Zitaten)
           │          └─ Netzwerkfehler und Modell vorhanden ─► lokales Modell, Hinweis „Server nicht erreichbar …“
           └─ nein ─► Modell geladen oder gespeichert? ─► lokales Modell
                      Modell fehlt ─► „… noch nicht geladen …“
                      kein WebGPU ─► „… unterstützt kein WebGPU …“
```

1. **Einrichten:** Unter dem Eingabefeld steht „Offline-Chat einrichten“. Erst der Klick lädt den Offline-Teil der Oberfläche (eigener Chunk, 15 kB, 5,9 kB gzip). Die Startseite lädt davon nichts.
2. **Zustimmung:** „Offline-Modell laden (0,9 GB)“ öffnet einen Dialog mit Modell, Lizenz, Downloadgröße, Grafikspeicher und Herkunft der Dateien. Erst „Jetzt laden“ holt die WebLLM-Laufzeit (zweiter Chunk) und das Modell. Abbrechen lädt nichts.
3. **Laden:** Fortschritt als `<progress>` mit Prozent. Vorher prüft die Seite mit `navigator.storage.estimate()`, ob der Speicher reicht, und bittet mit `navigator.storage.persist()` um dauerhaften Speicher.
4. **Wiederverwendung:** Nach dem Laden merkt sich die Seite das in `localStorage` (`rn_local_model`). Beim nächsten Besuch lädt sie den Offline-Teil gleich mit und prüft per `hasModelInCache`, ob das Modell noch im Cache Storage liegt. Dann gilt „Offline-Modell gespeichert“, ohne neue Zustimmung und ohne Download.
5. **Entfernen:** „Offline-Modell entfernen“ entlädt das Modell und löscht Gewichte, Bibliothek und Konfiguration aus dem Cache Storage (`deleteModelAllInfoInCache`).

## Modus-Anzeige

Unter dem Eingabefeld steht ein `<output>`-Element (Rolle `status`, Ansage über `aria-live="polite"`), das bei jedem Wechsel angesagt wird. Der Zustand ist zusätzlich an der Form des Punkts erkennbar (gefüllt online, Ring mit Schrägstrich offline), nicht nur an der Farbe.

| Zustand | Deutsch | Englisch |
| --- | --- | --- |
| online (vor dem Einrichten) | Online | Online |
| online | Online · Antworten vom Server mit geprüften Zitaten | Online · answers from the server with checked citations |
| offline, Modell da | Offline · das lokale Modell antwortet auf diesem Gerät | Offline · the local model answers on this device |
| offline, kein Modell | Offline · kein lokales Modell geladen | Offline · no local model loaded |
| offline, kein WebGPU | Offline · ohne WebGPU ist kein lokales Modell möglich | Offline · a local model needs WebGPU |

## Quellen offline und Zitate

Die lokale Ablage aus #347/#348 (`rn-local-v1`) enthält heute nur den Notebook-Titel und die Sync-Warteschlange, keine Quelltexte oder Chunks (siehe [Offline-Synchronisation](offline-sync.md) und [Lokale Verschlüsselung](local-encryption.md)). Offline nutzt der Chat deshalb die Quelltexte, die die Seite im Speicher hat (`rawText` der ausgewählten Quellen):

- Die Texte werden in Abschnitte bis 700 Zeichen zerlegt, an Absatz- oder Satzgrenzen.
- Eine einfache Wortsuche (Überlappung mit der Frage, seltene Wörter zählen mehr) wählt bis zu vier Abschnitte.
- Diese Auszüge gehen mit der Anweisung „nur aus den Auszügen antworten, sonst sagen, dass die Antwort fehlt“ an das Modell, dazu die letzten vier Nachrichten.

**Zitate:** Offline gibt es keine geprüften Zitate. Das Modell soll keine Marker wie `[1]` schreiben, und die Seite entfernt sie, falls doch. Unter der Antwort steht „Offline-Antwort des lokalen Modells. Zitate lassen sich offline nicht prüfen. Grundlage waren diese Auszüge:“ mit Knöpfen, die in die Quelle springen. Das sind die Stellen, die das Modell gelesen hat, kein Beleg für jede Aussage. Die Antwort trägt den KI-Hinweis mit Modellnamen (EU AI Act Art. 50).

Verschlüsselt lokal gespeicherte Quelltexte für einen Kaltstart ohne Netz sind nicht Teil dieses Issues; sie setzen einen Service Worker voraus, den es noch nicht gibt.

## Sicherheit und Datenschutz

- **Gepinnte Stände:** Modell-URL mit Commit `9bd564b0…` im Hugging-Face-Repo, WebAssembly-Bibliothek mit Commit `146ed9cd…` im Repo `mlc-ai/binary-mlc-llm-libs`. SRI-Hashes (SHA-256) für `mlc-chat-config.json`, `tokenizer.json` und die WebAssembly-Datei; bei Abweichung bricht WebLLM ab (`onFailure: "error"`). Die Gewichtsdateien selbst prüft WebLLM nicht per SRI; sie sind über den Commit festgelegt.
- **CSP:** `connect-src` erlaubt zusätzlich `https://huggingface.co`, `https://*.huggingface.co`, `https://*.hf.co` (Download-CDN) und `https://raw.githubusercontent.com`. `script-src` bleibt bei `'self'` und `'wasm-unsafe-eval'`, das es schon gab.
- **Daten:** Fragen und Quellen verlassen beim Offline-Chat das Gerät nicht. Beim Download sehen Hugging Face und GitHub die IP-Adresse und den Abruf, wie bei jedem Download; deshalb nennt der Dialog beide.
- **Kein Modell im Repository:** Gewichte liegen nur im Browser der Nutzer.

## Speicherbedarf und Voraussetzungen

- **Speicher:** rund 0,9 GB im Browser-Speicher (Cache Storage). Browser räumen ihn bei Platzmangel unter Umständen; die Seite bittet deshalb um dauerhaften Speicher. Wird geräumt, steht wieder „Offline-Modell laden“ da.
- **Grafikspeicher:** rund 1,6 GB während das Modell geladen ist.
- **WebGPU** (laut [gpuweb Implementation Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status), abgerufen am 13.11.2026): Chrome und Edge ab 113 auf Windows, macOS und ChromeOS; Android ab 121 (Android 12+, ARM/Qualcomm/Intel-GPU); Linux nur für bestimmte GPUs; Firefox ab 141 auf Windows, ab 147 auf macOS; Safari 26 auf macOS, iOS und iPadOS.
- **Erstes Laden** braucht Netz. Danach antwortet das Modell in einer bereits geöffneten Seite ohne Netz. Ohne Service Worker lässt sich die Seite selbst offline nicht neu laden.

## Startgewicht

Lighthouse begrenzt Skripte auf 180 000 Byte Transfer. Auf `main` waren es 177 846 Byte. Ins Start-Bundle kommen nur der Knopf „Offline-Chat einrichten“, die schlichte Online/Offline-Anzeige, vier Texte und das Lesen des Merkers (Messung `vite build`: `index` 111,20 → 112,00 kB gzip, `useTheme` 22,61 → 22,80 kB gzip). Der Offline-Teil (5,9 kB gzip) und die WebLLM-Laufzeit (2,2 MB gzip) sind eigene Chunks.

## Tests

| Test | Was er belegt |
| --- | --- |
| `apps/web/src/__tests__/local-llm.test.ts` | WebGPU-Prüfung, Speicherprüfung, Laden nur mit Zustimmung, Fortschritt, ein Download bei parallelen Aufrufen, Cache ohne neue Zustimmung, nie stillschweigend laden, Fehlerarten, Entfernen, gesperrtes `localStorage`, Abbruch |
| `apps/web/src/__tests__/offline-chat.test.ts` | Wahl des Wegs online/offline, lokale Suche, Prompt DE/EN, Marker entfernen, Chat ohne Netz mit gemockter Laufzeit, Fehlertexte, beide Kataloge gleich |
| `apps/web/src/__tests__/local-llm-webllm.test.ts` | WebLLM gemockt: gepinnte URLs, SRI, Cache Storage, Fortschritt, Stream, Abbruch |
| `apps/web/e2e/offline-chat.spec.ts` | Chromium mit `context.setOffline(true)` und ersetzter Laufzeit: Zustimmung mit Größe, Abbrechen lädt nichts, Modus-Wechsel online/offline, lokale Antwort ohne Zitat-Pillen mit Auszügen, Rückkehr zum Server, offline ohne Modell, ohne WebGPU, Server nicht erreichbar, Neuladen aus dem Cache, Entfernen; die Startseite lädt nichts vom Offline-Teil |

In CI wird nie ein echtes Modell geladen. Ein Lauf mit echtem Modell ist in diesem Issue nicht belegt; er braucht einen Rechner mit WebGPU und 0,9 GB Download.

Quellen: [WebLLM](https://github.com/mlc-ai/web-llm), [Qwen2.5-Ankündigung](https://qwenlm.github.io/blog/qwen2.5/) (Sprachen und Lizenzen), [Qwen2.5-1.5B-Instruct auf Hugging Face](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct) (Lizenz apache-2.0), [MLC-Gewichte](https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC), [Llama 3.2 License](https://huggingface.co/meta-llama/Llama-3.2-1B-Instruct), [Gemma Terms of Use](https://ai.google.dev/gemma/terms), [transformers.js](https://huggingface.co/docs/transformers.js), [gpuweb Implementation Status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status), [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
