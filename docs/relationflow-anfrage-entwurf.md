# Entwurf: Anfrage an Everlast Consulting zur RelationFlow-Schnittstelle

> **Status: Entwurf, nicht versendet.** Versand nur nach Freigabe durch den Inhaber (Issue #249).
> Platzhalter in eckigen Klammern vor dem Versand ersetzen.

**An:** [Ansprechpartner bei Everlast Consulting GmbH, E-Mail-Adresse]
**Betreff:** RelationNotes an RelationFlow anbinden: Fragen zur API

---

Hallo [Name],

im Rahmen der Testaufgabe habe ich RelationNotes gebaut, einen NotebookLM-Klon auf Cloudflare Workers.
Die App soll Chat und Embeddings auch über RelationFlow ausführen können. Auf der Server-Seite ist dafür
ein Adapter für OpenAI-kompatible Endpunkte fertig und gegen einen lokalen Testserver geprüft. Gegen
RelationFlow selbst konnte ich noch nicht testen, weil ich keine Schnittstellenbeschreibung gefunden habe.

Damit die Anbindung nicht auf Vermutungen beruht, hätte ich ein paar Fragen:

**Endpunkt und Format**

1. Gibt es eine öffentliche API, und unter welcher Basis-Adresse ist sie erreichbar?
2. Ist sie OpenAI-kompatibel, also mit `POST /chat/completions`, `GET /models` und `POST /embeddings`?
   Falls nein: Wo finde ich die Beschreibung (z. B. OpenAPI-Datei)?
3. Werden Antworten per Server-Sent Events gestreamt (`stream: true`)?

**Anmeldung**

4. Wie authentifiziert sich ein Client: API-Schlüssel als Bearer-Token, OAuth oder etwas anderes?
5. Gelten Schlüssel pro Person, pro Workspace oder pro Organisation?

**Modelle**

6. Welche Modell-IDs stehen zur Verfügung, und lässt sich die Auto-Auswahl auch über die API nutzen?
7. Welche Modelle laufen in der EU, und wie erkenne ich das in der Antwort oder in `GET /models`?

**Embeddings**

8. Gibt es ein Embedding-Modell? Wenn ja: welches, mit wie vielen Dimensionen, und lässt sich die
   Dimension wählen?

**Grenzen und Betrieb**

9. Welche Rate-Limits und Kontingente gelten (Anfragen pro Minute, Token pro Tag, maximale Kontextlänge)?
10. Wie sehen Fehlerantworten aus, insbesondere bei Limit-Überschreitung (Status 429, `Retry-After`)?
11. Muss ich mit festen Ausgangs-IPs rechnen, oder gibt es eine IP-Freigabe auf Ihrer Seite? Die Aufrufe
    kommen von Cloudflare Workers, deren Adressen nicht fest sind.

**Datenschutz**

12. Werden Eingaben gespeichert oder zum Training verwendet? Gibt es einen AV-Vertrag nach Art. 28 DSGVO?

**Zugang zum Testen**

13. Wäre ein Testzugang mit begrenztem Kontingent möglich, damit ich die Anbindung vor der Abgabe
    einmal echt prüfen kann?

Eine kurze Antwort auf die Punkte 1 bis 4 und 13 reicht mir für den Anfang. Den Rest kann ich auch später
klären.

Viele Grüße
[Name]
[Telefon, optional]

---

## Interne Notizen (nicht Teil der E-Mail)

- Die Fragen decken die offenen Punkte aus Issue #249 ab: Endpunkt (1–3), Auth (4–5), Modelle (6–7),
  Embeddings (8), Limits (9–11). Datenschutz (12) und Testzugang (13) kamen dazu, weil ohne sie kein
  Realtest (Issue #247) und keine saubere DSGVO-Aussage möglich ist.
- Technischer Stand der Anbindung: `apps/worker/src/openai-compatible-provider.ts` (Issue #247). Der
  Betreiber muss den RelationFlow-Host in `BYOM_ALLOWED_HOSTS` freigeben.
- Nach der Antwort: Basis-Adresse und Modell-IDs in den Einstellungen eintragen, Verbindungstest
  ausführen, Ergebnis in #247 und #249 festhalten.
