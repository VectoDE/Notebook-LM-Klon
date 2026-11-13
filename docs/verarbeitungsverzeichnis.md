# Verarbeitungsverzeichnis (Art. 30 DSGVO), technischer Teil

Stand: 2026-11-13 · Issue #258

> Entwurf auf Basis des Codes, keine Rechtsberatung. Verantwortlicher, Kontaktdaten und Rechtsgrundlagen muss der Betreiber mit anwaltlicher Hilfe festlegen. Angaben in eckigen Klammern sind Platzhalter für den Betreiber.

**Verantwortlicher:** [Name, Anschrift, E-Mail des Betreibers]
**Datenschutzbeauftragter:** [falls bestellt]
**Auftragsverarbeiter:** Cloudflare, Inc. (Workers, D1, R2, Durable Objects, Turnstile); optional Google (Gemini-API, nur mit eigenem Schlüssel der Person)

| Nr. | Verarbeitung | Daten | Betroffene | Zweck | Speicherort | Löschfrist |
|---|---|---|---|---|---|---|
| 1 | Konto | ID, E-Mail, Anzeigename, Sprache, Gast-Kennzeichen | Nutzer | Anmeldung, Zuordnung der Inhalte | D1 `users` | sofort bei Kontolöschung; Gäste nach 24 h |
| 2 | Passkeys | Credential-ID, öffentlicher Schlüssel, Zähler | Nutzer | Anmeldung ohne Passwort | D1 `passkeys` | mit dem Konto |
| 3 | Sitzungen | SHA-256 des Tokens, IP- und User-Agent-Hash (tagesweise gesalzen) | Nutzer | Angemeldet bleiben, Missbrauch erkennen | D1 `sessions`, Cookie `__Host-sid` | 7 Tage nach letzter Nutzung, sofort bei Kontolöschung |
| 4 | Magic Links | SHA-256 des Tokens, E-Mail | Nutzer | Anmeldung per E-Mail | D1 `magic_links` | 15 Minuten |
| 5 | Inhalte | Notebooks, Quellen, Chunks, Vektoren, Chats, Notizen, Artefakte | Nutzer, in Quellen genannte Dritte | Kernfunktion | D1, R2 `notebooks/{id}/` | sofort bei Löschung von Quelle, Notebook oder Konto; Demo-Notebooks nach 30 Tagen |
| 6 | Eigene API-Schlüssel (BYOK) | verschlüsselter Schlüssel, letzte 4 Zeichen | Nutzer | Aufrufe beim gewählten KI-Anbieter | D1 `provider_keys` | sofort bei Entfernen oder Kontolöschung |
| 7 | Kontingente und Rate-Limits | Zähler je Konto, Zähler je IP-Hash | Nutzer, Besucher | Missbrauch und Kosten begrenzen | D1 `quotas`, `rate_limits`, Arbeitsspeicher | Kontingente mit dem Konto; Rate-Limit-Fenster 1 Minute |
| 8 | Audit-Log | Aktion (Login, Quellen- und Kontolöschung), Ziel-ID, tagesweise gesalzener IP-Hash, Zeitpunkt; keine Inhalte, Titel, E-Mail-Adressen | Nutzer | Sicherheit, Nachweis | D1 `audit_log` | 90 Tage (stündlicher Cron); `user_id` wird bei Kontolöschung `NULL` |
| 9 | Missbrauchsmeldungen | Ziel-ID, Grund, meldende Person | Nutzer | Moderation (AI Act) | D1 `abuse_reports` | [Frist festlegen] |
| 10 | Backups | alle Daten aus D1 | alle oben | Wiederherstellung | D1 Time Travel | 30 Tage (Workers Paid), 7 Tage (Free) |

**Technische und organisatorische Maßnahmen:** TLS, HSTS, strenge CSP, CSRF-Prüfung, Hashes statt Klartext für Tokens und IPs, AES-256-GCM für API-Schlüssel, Rollenprüfung je Notebook, Rate-Limits, automatische Löschung per Cron. Details in [security-and-compliance.md](./security-and-compliance.md) und im [Löschkonzept](./loeschkonzept.md).
