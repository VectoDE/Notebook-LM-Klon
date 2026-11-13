# C2PA-Herkunftsnachweis für Exporte

Stand: Issue #353. Diese Seite beschreibt, welche Exporte RelationNotes mit einem
C2PA-Manifest signiert, womit, wo das nicht geht und was der Betreiber für den Echtbetrieb
selbst einrichten muss.

## Was im Manifest steht

Jede signierte Datei trägt ein eingebettetes C2PA-Manifest (Spezifikation 2.x, Claim v2) mit:

- **Erzeuger** (`claim_generator_info`): `RelationNotes` und die Version des Servers.
- **Titel** der Datei (Steuerzeichen entfernt, höchstens 200 Zeichen).
- **Aktion** `c2pa.created` in `c2pa.actions.v2` mit IPTC `digitalSourceType`:
  `trainedAlgorithmicMedia` für Studio-Ausgaben (von einem KI-Modell erzeugt), sonst
  `digitalCreation`.
- **Signatur** mit ES256 über die Zertifikatskette des Servers.

Das Manifest wird aus `packages/shared/src/provenance.ts` (`buildManifestDefinition`) gebaut.

## Architektur

| Teil | Datei | Aufgabe |
| --- | --- | --- |
| Formate, Manifest | `packages/shared/src/provenance.ts` | signierbare Medienarten, Manifest-Definition |
| API | `apps/worker/src/provenance-routes.ts` | `GET /api/v1/provenance/status`, `POST /api/v1/provenance/sign` |
| Signierer | `apps/worker/src/node/c2pa-signer.ts` | ruft `c2patool` im Node-Server auf |
| Oberfläche | `apps/web/src/provenance-client.ts` | signiert vor dem Download, sonst ehrlicher Hinweis |

`POST /api/v1/provenance/sign` braucht eine Sitzung, nimmt höchstens 64 MB und fällt unter
das Ratenlimit für Uploads. Fehler kommen als Problem Details (RFC 9457): 503 ohne Zertifikat,
415 für nicht unterstützte Formate, 413 bei zu großen Dateien, 502 wenn c2patool scheitert
(ohne Pfade oder Schlüsseldetails in der Antwort).

## Warum c2patool im Node-Server

Geprüfte Implementierungen der Content Authenticity Initiative (Stand November 2026):

| Option | Lizenz | Größe | Laufzeit | Ergebnis |
| --- | --- | --- | --- | --- |
| `c2patool` 0.29.0 (contentauth/c2patool) | Apache-2.0 | ein Binärprogramm | Node-Server (Prozess) | **gewählt** |
| `@contentauth/c2pa-node` 0.11.0 | MIT | 52,6 MB mit nativen Binärdateien | nur Node | unnötig groß für zwei Aufrufe |
| `@contentauth/c2pa-web` 0.17.0 (WASM) | MIT | WASM-Modul rund 3,3 MB gzip | Browser, Worker | über dem 3-MB-Limit (komprimiert) des Workers-Free-Plans |
| `@trustnxt/c2pa-ts` 0.14.1 | Apache-2.0 | klein | überall | noch unreif, kein WAV und kein SVG |

Folge: Signiert wird nur in der Node-Laufzeit (Docker-Image oder `pnpm start:node`). Auf
Cloudflare Workers gibt es keinen Signierer; `/sign` antwortet dort 503 und die Oberfläche
lädt die Datei unsigniert herunter und sagt das offen. Eine unsignierte Datei wird nie als
signiert ausgegeben.

## Formate

| Export | Medienart | Signiert | Nachweis |
| --- | --- | --- | --- |
| Mindmap als Bild | `image/png` | ja | CI, `c2pa-integration.test.ts` |
| Mindmap als Vektorgrafik | `image/svg+xml` | ja | CI, `c2pa-integration.test.ts` |
| Audio | `audio/wav` (auch `audio/mpeg`, `audio/mp4`) | ja | CI, `c2pa-integration.test.ts` (WAV) |
| Video Overview | `video/mp4` | ja | CI, `c2pa-integration.test.ts` (fragmentiertes MP4 wie aus `MediaRecorder`) |
| Video Overview | `video/webm` | **nein** | CI: c2patool lehnt WebM eingebettet und als Sidecar ab |

### WebM

C2PA (c2pa-rs, damit auch c2patool) unterstützt WebM, Ogg und Opus nicht. Geprüft mit
c2patool 0.29.0: Einbetten endet mit „type is unsupported“, ein externes Manifest (`-s`,
Sidecar `.c2pa`) mit „Unsupported file type“. Ein Sidecar ist damit keine Lösung.

Entscheidung: Das Video Overview wird bevorzugt als **MP4** aufgenommen
(`getSupportedVideoMimeType` versucht MP4 zuerst). Browser, deren `MediaRecorder` kein MP4
aufnehmen kann, erhalten eine unsignierte WebM-Datei mit dem sichtbaren
Hinweis „Ohne C2PA-Signatur: WebM unterstützt C2PA nicht“. Der Integrationstest
„weist WebM ab; c2patool selbst kann WebM weder einbetten noch als Sidecar signieren“ hält
das in jeder CI-Ausführung fest.

## Sichtbarer Hinweis und Metadaten

- Nach jedem Export zeigt das Studio einen Hinweis neben dem Download-Knopf: signiert mit
  Testzertifikat, signiert mit eigenem Zertifikat oder ohne Signatur samt Grund.
- SVG-Exporte tragen zusätzlich, auch unsigniert, ein `<metadata>`-Element mit Erzeuger und
  IPTC `digitalSourceType`.

## Testzertifikat (Entwicklung und CI)

Für Entwicklung und CI dient das öffentliche Testzertifikat aus dem offiziellen Repository
`contentauth/c2pa-rs`, fest auf einen Commit gepinnt und per SHA-256 geprüft:

| Datei | Quelle | SHA-256 |
| --- | --- | --- |
| `es256.pub` (Kette) | `sdk/tests/fixtures/certs/es256.pub` @ `0e92435c6d621c02c9bde2a8d82346295ed1f509` | `2bf499037fd1fa7d803e3052c7b4ef6a0e67564aa2b805c0d7ae64d25a13c07b` |
| `es256.pem` (Schlüssel) | `sdk/tests/fixtures/certs/es256.pem` @ demselben Commit | `f547ec8dbf24e50b51cf9924e58c250d246ed8844304408a072801fcf70a95d7` |
| c2patool Linux | `v0.29.0-x86_64-unknown-linux-gnu.tar.gz` (GitHub-Release contentauth/c2patool) | `af5494722fc8c3f239980f36ceb3acf496d1481850d356a4bb34777b33b08043` |

Der Schlüssel wird nur im CI-Job heruntergeladen und liegt nie im Repository. Er ist
öffentlich und darf **nicht** für echte Exporte verwendet werden: Prüfwerkzeuge wie
contentcredentials.org/verify melden ihn als nicht vertrauenswürdig. Gegen die
Vertrauensanker aus dem c2patool-Release (`sample/trust_anchors.pem`) meldet c2patool
`validation_state: Trusted`; ohne diese Anker `Valid` mit `signingCredential.untrusted`.

Lokal ausprobieren:

```sh
C2PATOOL_PATH=/pfad/zu/c2patool \
C2PA_SIGN_CERT=/pfad/zu/es256.pub \
C2PA_PRIVATE_KEY=/pfad/zu/es256.pem \
C2PA_TRUST_ANCHORS=/pfad/zu/c2patool/sample/trust_anchors.pem \
pnpm exec vitest run apps/worker/src/__tests__/c2pa-integration.test.ts
```

## Echtbetrieb (Inhaber-Schritt)

Für echte Exporte braucht der Betreiber ein eigenes Signaturzertifikat. Seit 2025 führt die
C2PA eine Liste vertrauenswürdiger Zertifizierungsstellen (C2PA Trust List / Conformance
Program); nur Zertifikate daraus zeigen Prüfwerkzeuge als vertrauenswürdig an.

1. Zertifikat für die Signatur von Inhalten bei einer Stelle der C2PA Trust List beantragen
   (ES256, Kette mit Leaf zuerst, Schlüssel im PKCS#8-PEM-Format).
2. Schlüssel nur auf dem Server ablegen (Dateirechte 600, z. B. Docker Secret), nie ins
   Repository.
3. Im Node-Server setzen: `C2PATOOL_PATH`, `C2PA_SIGN_CERT`, `C2PA_PRIVATE_KEY`,
   `C2PA_CERT_KIND=production` und möglichst `C2PA_TSA_URL` (RFC-3161-Zeitstempeldienst,
   damit Signaturen nach Ablauf des Zertifikats gültig bleiben).
4. Eine signierte Datei auf contentcredentials.org/verify prüfen.

Ohne `C2PA_CERT_KIND=production` zeigt die Oberfläche immer „Testzertifikat“ an.
