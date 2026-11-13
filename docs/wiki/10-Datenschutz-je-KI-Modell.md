# Datenschutz je KI-Modell: Training mit Eingaben

Stand: 2026-11-13 · Referenzen: Issue #302, Entscheidungen #8, #41, #45

> **Kein Rechtsrat:** Diese Seite fasst die öffentlichen Angaben der Anbieter zusammen. Sie ersetzt keine Rechtsberatung. Vor einem produktiven Einsatz, vor Werbeaussagen und bei Zweifeln bitte eine Anwältin oder einen Anwalt fragen. Maßgeblich sind immer die aktuellen Vertragsbedingungen des jeweiligen Anbieters.

## Worum es geht

Die Einstellungen der App zeigen beim gewählten KI-Modell an, ob der Anbieter Eingaben zum Training verwendet, unter welchen Bedingungen und mit welcher Quelle. Eine pauschale Aussage „ohne Training“ gibt es nicht mehr, weil sie nicht für jedes Modell und jeden Zugangsweg stimmt.

Die Daten für die Anzeige stehen in [`apps/web/src/model-data-policy.ts`](../apps/web/src/model-data-policy.ts). Ein Test (`model-data-policy.test.ts`) prüft, dass jede dort genannte Quelle auch in dieser Tabelle steht.

## Was in dieser Installation tatsächlich angebunden ist

Der Worker registriert derzeit zwei Anbieter: **Google Gemini** über die Gemini Developer API (`generativelanguage.googleapis.com`, mit Demo-Schlüssel oder eigenem Schlüssel) und **Ollama** (Standard `http://localhost:11434` auf dem Server, auf dem der Worker bzw. der Node-Server läuft). Anthropic, OpenAI und Groq sind noch nicht angebunden (Issues #158, #159, #160).

- Wer **Claude 3.7 Sonnet** oder **GPT-4o** wählt, bekommt derzeit eine Fehlermeldung. Es gehen keine Daten an diese Anbieter.
- Wer **DeepSeek R1 (Groq)** wählt, landet derzeit bei Gemini 2.5 Flash, weil das Modell im Katalog des Routers fehlt und der Router auf das Standardmodell zurückfällt. Für diese Anfragen gelten Googles Bedingungen. Die App sagt das beim Modell offen.
- **Ollama** läuft nicht auf dem Gerät der Nutzerin oder des Nutzers, sondern auf dem Server dieser Installation. Die frühere Bezeichnung „100% On-Device“ war deshalb falsch und ist entfernt.

## Tabelle je Modell

| Modell in der App | Anbieter und Zugangsweg | Angebunden | Training mit Eingaben laut Anbieter | Bedingungen und Ausnahmen | Quelle | Abgerufen |
|---|---|---|---|---|---|---|
| Google Gemini 2.5 Flash (Standard), Gemini 2.5 Pro | Google, Gemini Developer API | ja | **Nur unter Bedingungen ausgeschlossen** | Kein Training bei kostenpflichtiger Nutzung (Paid Services). Für Nutzer im EWR, in der Schweiz und im Vereinigten Königreich gelten die Paid-Regeln auch für die kostenlose Stufe. Sonst (kostenlose Stufe außerhalb dieser Regionen) nutzt Google Eingaben und Antworten zur Verbesserung und lässt sie teils von Menschen prüfen. Google speichert Prompts und Antworten auch bei Paid Services für begrenzte Zeit. | [Gemini API Additional Terms of Service](https://aistudio.google.com/docs/terms) (gültig ab 23.03.2026; `ai.google.dev/gemini-api/terms` leitet dorthin weiter) | 2026-11-13 |
| Anthropic Claude 3.7 Sonnet | Anthropic API (BYOK, noch nicht angebunden) | nein, Anfragen schlagen fehl | **Kein Training** (Standard) | Ausnahmen: Feedback oder Fehlerberichte, ausdrückliche Zustimmung. Feedback wird bis zu 5 Jahre gespeichert. | [Anthropic Privacy Center: Is my data used for model training?](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training) (Stand 18.08.2026) | 2026-11-13 |
| OpenAI GPT-4o | OpenAI API (BYOK, noch nicht angebunden) | nein, Anfragen schlagen fehl | **Kein Training** (Standard seit 01.03.2023) | Ausnahme: ausdrückliche Zustimmung (Opt-in). Protokolle zur Missbrauchserkennung bis zu 30 Tage, außer bei genehmigter Zero Data Retention. | [OpenAI API: Data controls (Your data)](https://developers.openai.com/api/docs/guides/your-data) | 2026-11-13 |
| DeepSeek R1 (Groq) | Groq, GroqCloud API (noch nicht angebunden) | nein, Anfragen gehen an Gemini 2.5 Flash | Groq: **kein Training**; tatsächlich gilt derzeit die Gemini-Zeile | Groq-Dienstvertrag Ziffer 4.2: kein Training oder Fine-Tuning mit Inputs oder Outputs, außer mit Erlaubnis des Kunden. | [GroqCloud Services Agreement, 4.2](https://console.groq.com/docs/legal/services-agreement) (Last Modified 22.06.2026) | 2026-11-13 |
| Ollama Llama 3 (auf dem Server) | Ollama, lokal auf dem Server dieser Installation | ja | **Kein externer Anbieter** | Laut Ollama sieht Ollama bei lokaler Nutzung keine Prompts. Cloud-Modelle von Ollama nutzt die App nicht; sie lassen sich mit `OLLAMA_NO_CLOUD=1` abschalten. | [Ollama FAQ](https://docs.ollama.com/faq) | 2026-11-13 |

## Wortlaut der Quellen (Auszüge)

- **Google, Paid Services:** „When you use Paid Services, including, for example, the paid quota of the Gemini API, Google doesn't use your prompts (including associated system instructions, cached content, and files such as images, videos, or documents) or responses to improve our products […]“
- **Google, Unpaid Services:** „When you use Unpaid Services, including, for example, Google AI Studio and the unpaid quota on Gemini API, Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services and machine learning technologies […]“ sowie „human reviewers may read, annotate, and process your API input and output.“
- **Google, EWR/CH/UK:** „If you're in the European Economic Area, Switzerland, or the United Kingdom, the terms under "How Google uses Your Data" in "Paid Services" apply to all Services, including Google AI Studio and unpaid quota in the Gemini API, even though they are offered free of charge.“
- **Anthropic:** „By default, we will not use your inputs or outputs from our commercial products (e.g. Claude for Work, Anthropic API, Claude Gov, etc.) to train our models.“ Ausnahmen laut derselben Seite: gemeldetes Feedback oder Fehlerberichte und ausdrückliche Zustimmung.
- **OpenAI:** „As of March 1, 2023, data sent to the OpenAI API is not used to train or improve OpenAI models (unless you explicitly opt in to share data with us).“
- **Groq:** „For clarity, Groq is not permitted to use Inputs or Outputs for training or fine-tuning any AI Model Services […]“
- **Ollama:** „Ollama runs locally. We don't see your prompts or data when you run locally.“

## Hinweise für den Betrieb (Inhaber)

1. **Demo-Schlüssel und EWR:** Die Gemini-Bedingungen erlauben für Anwendungen, die Nutzern im EWR, in der Schweiz oder im Vereinigten Königreich bereitgestellt werden, nur Paid Services („You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom.“). Der zentrale Demo-Schlüssel (Entscheidung #45) sollte deshalb zu einem Projekt mit aktivem Abrechnungskonto gehören. Das ist ein Inhaber-Schritt und vor dem Livegang rechtlich zu prüfen.
2. **Interne Bezeichnung im Worker:** Der Modellkatalog in `apps/worker/src/auto-router.ts` führt Anthropic und OpenAI als `zero-retention`. Beide Anbieter speichern API-Daten aber bis zu 30 Tage (siehe oben). Die Bezeichnung erscheint nicht in der Oberfläche; sie sollte bei der Anbindung der Adapter (#158, #159) korrigiert werden.
3. **Prüfen bei Änderungen:** Anbieter ändern ihre Bedingungen. Bei jeder Anbindung eines neuen Anbieters und mindestens vor jedem Release die Quellen neu abrufen, `POLICY_RETRIEVED` und diese Seite aktualisieren.
