import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import {
  C2PA_SIGNABLE_FORMATS,
  type ProvenanceCertificateKind,
  c2paExtensionFor
} from "@notebook-lm/shared";
import type { ProvenanceSigner } from "../provenance-routes.js";

/**
 * C2PA-Signatur über das offizielle Kommandozeilenwerkzeug c2patool (Issue #353).
 *
 * Nur in der Node-Laufzeit: Cloudflare Workers können keine Programme starten, und die
 * WASM-Variante der C2PA-Bibliothek ist mit rund 3,3 MB (gzip) größer als das Free-Limit.
 * Der private Schlüssel bleibt eine Datei auf dem Server (Pfad aus der Umgebung) und wird
 * nie ins Repository, in Antworten oder in Logs geschrieben.
 */

export interface C2paToolSignerOptions {
  /** Programm, z. B. der Pfad zu c2patool. */
  readonly command: string;
  /** Argumente vor den eigentlichen c2patool-Argumenten (Tests: Skript für node). */
  readonly commandArgs?: readonly string[] | undefined;
  /** PEM-Zertifikatskette (Leaf zuerst). */
  readonly certPath: string;
  /** PEM-Schlüssel (PKCS#8) zum Zertifikat. */
  readonly keyPath: string;
  readonly certificate: ProvenanceCertificateKind;
  /** Signaturalgorithmus des Schlüssels, Standard es256. */
  readonly algorithm?: string | undefined;
  /** Zeitstempeldienst (RFC 3161); ohne Angabe wird kein Zeitstempel geholt. */
  readonly timestampUrl?: string | undefined;
  /** Höchstdauer eines Aufrufs in ms. */
  readonly timeoutMs?: number | undefined;
}

export const DEFAULT_SIGN_TIMEOUT_MS = 60_000;

/** Fehler beim Signieren; die Meldung enthält keine Pfade und keine Schlüsseldaten. */
export class ProvenanceSignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvenanceSignError";
  }
}

function run(command: string, args: readonly string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { timeout: timeoutMs, windowsHide: true }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function createC2paToolSigner(options: C2paToolSignerOptions): ProvenanceSigner {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SIGN_TIMEOUT_MS;
  const formats = [...new Set(Object.keys(C2PA_SIGNABLE_FORMATS))];
  return {
    certificate: options.certificate,
    formats,
    async sign(data, mimeType, manifest) {
      const extension = c2paExtensionFor(mimeType);
      if (!extension) {
        throw new ProvenanceSignError(`Format ${mimeType} kann nicht signiert werden.`);
      }
      const dir = await mkdtemp(join(tmpdir(), "c2pa-"));
      try {
        const input = join(dir, `input.${extension}`);
        const output = join(dir, `signed.${extension}`);
        const manifestPath = join(dir, "manifest.json");
        await writeFile(input, data);
        const definition: Record<string, unknown> = {
          ...manifest,
          alg: options.algorithm ?? "es256",
          // c2patool liest relative Pfade relativ zur Manifest-Datei, die im Temp-Ordner liegt.
          sign_cert: resolvePath(options.certPath),
          private_key: resolvePath(options.keyPath)
        };
        if (options.timestampUrl) definition.ta_url = options.timestampUrl;
        await writeFile(manifestPath, JSON.stringify(definition));
        try {
          await run(
            options.command,
            [...(options.commandArgs ?? []), input, "-m", manifestPath, "-o", output, "-f"],
            timeoutMs
          );
        } catch {
          throw new ProvenanceSignError("c2patool konnte die Datei nicht signieren.");
        }
        return new Uint8Array(await readFile(output));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  };
}

/** Umgebungsvariablen der Node-Laufzeit für die Signatur. */
export const C2PA_ENV_VARS = [
  "C2PATOOL_PATH",
  "C2PA_SIGN_CERT",
  "C2PA_PRIVATE_KEY",
  "C2PA_CERT_KIND",
  "C2PA_TSA_URL"
] as const;

/**
 * Baut den Signierer aus der Umgebung. Fehlt Werkzeug, Zertifikat oder Schlüssel, gibt es
 * keinen Signierer: Exporte bleiben dann unsigniert und die Oberfläche sagt das offen.
 * Ohne C2PA_CERT_KIND=production gilt das Zertifikat als Testzertifikat.
 */
export function c2paSignerFromVars(
  vars: Readonly<Record<string, string | undefined>>
): ProvenanceSigner | undefined {
  const command = vars.C2PATOOL_PATH;
  const certPath = vars.C2PA_SIGN_CERT;
  const keyPath = vars.C2PA_PRIVATE_KEY;
  if (!command || !certPath || !keyPath) return undefined;
  return createC2paToolSigner({
    command,
    certPath,
    keyPath,
    certificate: vars.C2PA_CERT_KIND === "production" ? "production" : "test",
    timestampUrl: vars.C2PA_TSA_URL
  });
}
