# Security Policy (`RelationNotes`)

## Unterstützte Versionen / Supported Versions

| Version | Unterstützt / Supported |
|---|---|
| `0.1.x` – `1.0.x` (`main`) | Ja / Yes |

## Sicherheitslücke melden / Reporting a Vulnerability (Coordinated Vulnerability Disclosure)

Sicherheit hat in **RelationNotes – NotebookLM & RelationFlow Knowledge Studio** höchste Priorität. Bitte melde potenzielle Sicherheitslücken **nicht** über öffentliche GitHub-Issues, sondern vertraulich über einen der folgenden Kanäle:

1. **GitHub Private Vulnerability Reporting (empfohlen):**
   Über den Reiter **[Security → Report a vulnerability](https://github.com/VectoDE/Notebook-LM-Klon/security/advisories/new)** in diesem Repository.
2. **Direkter E-Mail-Kontakt:**
   An `timhauke99@gmail.com` mit dem Betreff `[SECURITY] RelationNotes Vulnerability Report`.

### Reaktionszeiten (SLA)
- **Eingangsbestätigung:** innerhalb von 24 Stunden.
- **Erste technische Einschätzung & Triage:** innerhalb von 72 Stunden.
- **Behebung kritischer Lücken (CVSS ≥ 7.0):** innerhalb von 7 Tagen inkl. veröffentlichtem Security Advisory und gepatchtem Release.

## Überblick über die Sicherheitsarchitektur

- **Authentifizierung & Sitzungen:** WebAuthn Passkeys (`ES256`/`RS256` mit `sign_count`-Klon-Erkennung), gehärtetes `__Host-sid`-Cookie (`Secure; HttpOnly; SameSite=Lax; Path=/`), Speicherung ausschließlich als `SHA-256`-Hash in Cloudflare D1.
- **BYOK Envelope Encryption:** Nutzer-API-Keys werden mit `AES-256-GCM` über die native WebCrypto-API verschlüsselt; `AAD` bindet jeden Chiffretext an `user_id|provider|key_version`. Klartext-Keys verlassen niemals den Request-Scope des Workers.
- **SSRF- & Upload-Schutz:** Strenge Blockade privater IPv4/IPv6-Netze, Loopback-Adressen und Cloud-Metadaten-Endpunkte (`169.254.169.254`) beim URL-Import sowie Magic-Byte-Prüfung hochgeladener Dateien.
- **Browser-Hardening:** Strikte Content-Security-Policy (CSP), Trusted Types, HSTS, `X-Content-Type-Options: nosniff`, `Frame-Options: DENY` und Cloudflare Turnstile Bot-Schutz.
- **Supply-Chain-Sicherheit:** 40-stelliges Commit-SHA-Pinning aller GitHub Actions, automatische Scans mit `gitleaks`, `osv-scanner`, `CodeQL` und `OpenSSF Scorecard`.
