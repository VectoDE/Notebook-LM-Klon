# Datenschutzhinweise (Entwurf)

Stand: 2026-11-13 · Issues #258, #259

> Entwurf aus Sicht der Technik, keine Rechtsberatung. Bitte vor Veröffentlichung von einer Anwältin oder einem Anwalt prüfen lassen. Angaben in eckigen Klammern ergänzt der Betreiber.

## Verantwortlicher

[Name, Anschrift, E-Mail des Betreibers, siehe Impressum]

## Welche Daten wir verarbeiten

- **Konto:** E-Mail-Adresse (bei Anmeldung per Magic Link), Anzeigename, Sprache, Passkey-Daten. Gastkonten laufen nach 24 Stunden ab.
- **Inhalte:** Notebooks, hochgeladene Quellen, Chats, Notizen und erzeugte Artefakte. Sie liegen in Cloudflare D1 und R2.
- **Sitzung:** Ein technisch notwendiges Cookie (`__Host-sid`) hält Sie angemeldet. Im Speicher steht nur ein Hash des Tokens, IP-Adresse und Browserkennung nur als tagesweise gesalzener Hash.
- **Sicherheitsprotokoll:** Anmeldungen sowie das Löschen von Quellen und Konten werden mit Zeitpunkt, Art des Ereignisses und der betroffenen ID protokolliert. Die IP-Adresse steht dort nur als tagesweise gesalzener Hash, Inhalte von Quellen nie. Die Einträge werden nach 90 Tagen gelöscht.
- **Einstellungen im Browser:** Design, Farbmodus, Sprache, Spaltenlayout und Ihre Einwilligungsentscheidung liegen im lokalen Speicher Ihres Browsers und verlassen das Gerät nicht.

## Löschung

Sie können Ihr Konto jederzeit löschen. Alle Datensätze und Dateien werden sofort entfernt. Im Wiederherstellungsverlauf der Datenbank (Cloudflare D1 Time Travel) bleiben sie technisch bedingt noch bis zu 30 Tage enthalten und sind danach endgültig gelöscht. Einzelheiten: [Löschkonzept](./loeschkonzept.md).

## Rechte

Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch und Widerruf einer Einwilligung (Art. 15 bis 21 DSGVO, Art. 7 Abs. 3 DSGVO) sowie Beschwerde bei einer Aufsichtsbehörde. Kontakt: [E-Mail des Betreibers].

## Empfänger

Cloudflare, Inc. als Auftragsverarbeiter für Hosting, Datenbank, Dateispeicher und Bot-Schutz (Turnstile). KI-Anbieter erhalten Inhalte nur, wenn Sie selbst einen eigenen Schlüssel hinterlegen und eine Anfrage stellen.
