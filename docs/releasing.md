# Releases: signiert, mit SBOM und Provenance

Der Workflow [`release.yml`](../.github/workflows/release.yml) baut und veröffentlicht Releases.

| Auslöser | Ergebnis |
| --- | --- |
| `workflow_dispatch` (Probelauf) | Tests, Build, Web-Paket, Quellarchiv, CycloneDX-SBOM, Changelog, Prüfsummen als Workflow-Artefakt. Keine Attestierung, keine Signatur, kein Release. |
| Tag `vX.Y.Z` | Wie oben, danach nach Freigabe im Environment `release`: SLSA-Build-Provenance (`actions/attest-build-provenance`), SBOM-Attestierung (`actions/attest-sbom`), keyless Sigstore-Signatur (`cosign sign-blob --bundle`) und GitHub-Release mit allen Dateien. |

Der Tag muss zur Version in `package.json` passen, sonst bricht der Lauf ab. Der Changelog
entsteht aus den Commit-Titeln seit dem vorherigen Tag.

## Neustart mit 0.1.0 (Inhaber-Schritt)

Beschlossen ist: alte Releases v0.1.0 und v0.2.0 samt Tags löschen und genau ein neues
Release 0.1.0 veröffentlichen. Metadaten und Archive der alten Releases wurden vorher gesichert
(Dateiliste und Prüfsummen stehen in Issue #265). Die Sicherung liegt nur temporär auf dem
Arbeitsrechner und sollte dauerhaft abgelegt werden.

Alle Befehle in einem Zug, erst nach Freigabe:

```bash
gh release delete v0.2.0 --repo VectoDE/Notebook-LM-Klon --cleanup-tag --yes
gh release delete v0.1.0 --repo VectoDE/Notebook-LM-Klon --cleanup-tag --yes
git fetch --prune --prune-tags origin
git switch main && git pull --ff-only
git tag -s v0.1.0 -m "Notebook-LM-Klon 0.1.0"   # oder -a ohne Signaturschlüssel
git push origin v0.1.0
```

Danach den Lauf unter **Actions → Release** im Environment `release` freigeben.

## Verifikation nach dem Release

```bash
gh release download v0.1.0 --repo VectoDE/Notebook-LM-Klon --dir v0.1.0 && cd v0.1.0
sha256sum -c SHA256SUMS.txt
gh attestation verify notebook-lm-klon-web-0.1.0.tar.gz --repo VectoDE/Notebook-LM-Klon
gh attestation verify notebook-lm-klon-web-0.1.0.tar.gz --repo VectoDE/Notebook-LM-Klon \
  --predicate-type https://cyclonedx.org/bom
cosign verify-blob notebook-lm-klon-web-0.1.0.tar.gz \
  --bundle notebook-lm-klon-web-0.1.0.tar.gz.sigstore.json \
  --certificate-identity "https://github.com/VectoDE/Notebook-LM-Klon/.github/workflows/release.yml@refs/tags/v0.1.0" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
