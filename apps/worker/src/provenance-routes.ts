import {
  PROVENANCE_MAX_BYTES,
  type ProvenanceCertificateKind,
  type ProvenanceStatus,
  baseMimeType,
  buildManifestDefinition,
  createProblemDetails,
  isC2paSignable
} from "@notebook-lm/shared";
import type { Context, Hono } from "hono";
import { requireAuth } from "./auth-middleware.js";
import { WORKER_VERSION } from "./version.js";

/**
 * C2PA-Herkunftsnachweis für Exporte (Issue #353).
 *
 * - GET  /api/v1/provenance/status: ob der Server signieren kann, mit welchem Zertifikat
 *   (Test oder eigenes) und welche Formate. Öffentlich, damit die Oberfläche vor dem Export
 *   ehrlich anzeigen kann, ob die Datei signiert wird.
 * - POST /api/v1/provenance/sign: nimmt die exportierte Datei als Rohdaten (Content-Type =
 *   Medienart) und gibt sie mit eingebettetem C2PA-Manifest zurück. Nur angemeldet.
 *
 * Der Signierer kommt aus der Umgebung (PROVENANCE_SIGNER). In Cloudflare Workers gibt es
 * keinen: die Route antwortet dann 503 statt eine unsignierte Datei als signiert auszugeben.
 */

export interface ProvenanceSigner {
  readonly certificate: ProvenanceCertificateKind;
  readonly formats: readonly string[];
  sign(data: Uint8Array, mimeType: string, manifest: Record<string, unknown>): Promise<Uint8Array>;
}

export interface ProvenanceRoutesDependencies {
  /** Liefert den Signierer der Umgebung oder undefined. */
  readonly resolveSigner: (env: Env) => ProvenanceSigner | undefined;
  /** Größte angenommene Datei in Bytes (Standard PROVENANCE_MAX_BYTES). */
  readonly maxBytes?: number | undefined;
}

type ProvenanceApp = Hono<{ Bindings: Env; Variables: { sessionUser?: { id: string } } }>;

const PROBLEM_HEADERS = { "content-type": "application/problem+json; charset=utf-8" } as const;

function problem(
  c: Context,
  status: 400 | 413 | 415 | 502 | 503,
  title: string,
  detail: string,
  code: string
): Response {
  return c.json(
    createProblemDetails({ status, title, detail, instance: c.req.path, code }),
    status,
    PROBLEM_HEADERS
  );
}

/** Liest den Signierer aus env.PROVENANCE_SIGNER (nur die Node-Laufzeit setzt ihn). */
export function signerFromEnv(env: Env): ProvenanceSigner | undefined {
  const candidate = (env as unknown as { PROVENANCE_SIGNER?: ProvenanceSigner }).PROVENANCE_SIGNER;
  return candidate && typeof candidate.sign === "function" ? candidate : undefined;
}

export function registerProvenanceRoutes(
  app: ProvenanceApp,
  deps: ProvenanceRoutesDependencies = { resolveSigner: signerFromEnv }
): void {
  const maxBytes = deps.maxBytes ?? PROVENANCE_MAX_BYTES;
  app.get("/api/v1/provenance/status", (c) => {
    const signer = deps.resolveSigner(c.env);
    const status: ProvenanceStatus = signer
      ? { available: true, certificate: signer.certificate, formats: signer.formats }
      : { available: false, certificate: null, formats: [] };
    return c.json(status, 200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
  });

  app.post("/api/v1/provenance/sign", requireAuth(), async (c) => {
    const signer = deps.resolveSigner(c.env);
    if (!signer) {
      return problem(
        c,
        503,
        "Service Unavailable",
        "Auf diesem Server ist kein C2PA-Signaturzertifikat eingerichtet.",
        "PROVENANCE_NOT_CONFIGURED"
      );
    }
    const mimeType = baseMimeType(c.req.header("content-type") ?? "");
    if (!isC2paSignable(mimeType)) {
      return problem(
        c,
        415,
        "Unsupported Media Type",
        `C2PA unterstützt das Format '${mimeType || "unbekannt"}' nicht (z. B. WebM). Bitte als MP4, WAV, PNG oder SVG exportieren.`,
        "C2PA_FORMAT_UNSUPPORTED"
      );
    }
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > maxBytes) {
      return tooLarge(c, maxBytes);
    }
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.byteLength > maxBytes) {
      return tooLarge(c, maxBytes);
    }
    if (data.byteLength === 0) {
      return problem(c, 400, "Bad Request", "Die Datei ist leer.", "EMPTY_BODY");
    }
    const manifest = buildManifestDefinition({
      title: c.req.query("title") ?? "",
      mimeType,
      generatorVersion: WORKER_VERSION,
      aiGenerated: c.req.query("ai") !== "0"
    });
    let signed: Uint8Array;
    try {
      signed = await signer.sign(data, mimeType, manifest);
    } catch {
      return problem(
        c,
        502,
        "Bad Gateway",
        "Die Datei konnte nicht signiert werden.",
        "PROVENANCE_SIGN_FAILED"
      );
    }
    return new Response(signed as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: {
        "content-type": mimeType,
        "cache-control": "no-store",
        "x-c2pa-certificate": signer.certificate
      }
    });
  });
}

function tooLarge(c: Context, maxBytes: number): Response {
  return problem(
    c,
    413,
    "Content Too Large",
    `Die Datei ist größer als ${Math.round(maxBytes / (1024 * 1024))} MB.`,
    "PAYLOAD_TOO_LARGE"
  );
}
