/**
 * C2PA-Herkunftsnachweis für Exporte (Issue #353), Seite der Oberfläche.
 *
 * Vor dem Download wird die Datei an den Server geschickt, der sie mit c2patool signiert.
 * Geht das nicht (Cloudflare Workers ohne Zertifikat, nicht angemeldet, Format ohne
 * C2PA-Unterstützung wie WebM, Netzfehler), wird die unveränderte Datei geladen und die
 * Oberfläche nennt den Grund. Eine unsignierte Datei gilt nie als signiert.
 */
import {
  DIGITAL_SOURCE_TYPE_TRAINED_ALGORITHMIC,
  PROVENANCE_GENERATOR_NAME,
  PROVENANCE_MAX_BYTES,
  type ProvenanceCertificateKind,
  baseMimeType,
  isC2paSignable
} from "@notebook-lm/shared";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Gründe, aus denen eine Datei unsigniert bleibt. */
export type UnsignedReason =
  | "unsupported-format"
  | "too-large"
  | "not-configured"
  | "unauthorized"
  | "failed";

export type ProvenanceOutcome =
  | { readonly signed: true; readonly certificate: ProvenanceCertificateKind; readonly blob: Blob }
  | { readonly signed: false; readonly reason: UnsignedReason; readonly blob: Blob };

export interface SignExportOptions {
  readonly mimeType: string;
  readonly title: string;
  /** Vom KI-Modell erzeugt (Studio-Ausgaben); Standard true. */
  readonly aiGenerated?: boolean | undefined;
}

export const PROVENANCE_SIGN_URL = "/api/v1/provenance/sign";

function reasonForStatus(status: number): UnsignedReason {
  if (status === 401) return "unauthorized";
  if (status === 413) return "too-large";
  if (status === 415) return "unsupported-format";
  if (status === 503) return "not-configured";
  return "failed";
}

/** Signiert eine exportierte Datei über den Server, sonst bleibt sie unverändert. */
export async function signExport(
  fetchFn: FetchLike,
  blob: Blob,
  options: SignExportOptions
): Promise<ProvenanceOutcome> {
  const mimeType = baseMimeType(options.mimeType);
  const unsigned = (reason: UnsignedReason): ProvenanceOutcome => ({ signed: false, reason, blob });
  if (!isC2paSignable(mimeType)) return unsigned("unsupported-format");
  if (blob.size > PROVENANCE_MAX_BYTES) return unsigned("too-large");

  const query = new URLSearchParams({ title: options.title });
  if (options.aiGenerated === false) query.set("ai", "0");
  let res: Response;
  try {
    res = await fetchFn(`${PROVENANCE_SIGN_URL}?${query.toString()}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": mimeType },
      body: blob
    });
  } catch {
    return unsigned("failed");
  }
  if (!res.ok) return unsigned(reasonForStatus(res.status));
  try {
    const signed = await res.blob();
    const certificate: ProvenanceCertificateKind =
      res.headers.get("x-c2pa-certificate") === "production" ? "production" : "test";
    return { signed: true, certificate, blob: new Blob([signed], { type: mimeType }) };
  } catch {
    return unsigned("failed");
  }
}

/** Übersetzungsschlüssel für den sichtbaren Herkunftshinweis nach dem Export. */
export function provenanceNoteKey(outcome: ProvenanceOutcome): string {
  if (outcome.signed) {
    return outcome.certificate === "production" ? "provSignedProduction" : "provSignedTest";
  }
  const keys: Record<UnsignedReason, string> = {
    "unsupported-format": "provUnsignedFormat",
    "too-large": "provUnsignedTooLarge",
    "not-configured": "provUnsignedNotConfigured",
    unauthorized: "provUnsignedSignIn",
    failed: "provUnsignedFailed"
  };
  return keys[outcome.reason];
}

const XMP_METADATA = (aiGenerated: boolean) =>
  [
    "<metadata>",
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"',
    ' xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    ' xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/">',
    `<rdf:Description rdf:about="" xmp:CreatorTool="${PROVENANCE_GENERATOR_NAME}"`,
    ` Iptc4xmpExt:DigitalSourceType="${
      aiGenerated
        ? DIGITAL_SOURCE_TYPE_TRAINED_ALGORITHMIC
        : "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCreation"
    }"/>`,
    "</rdf:RDF>",
    "</metadata>"
  ].join("");

/**
 * Schreibt Erzeuger und IPTC-Herkunft als XMP in ein SVG (direkt nach dem öffnenden
 * svg-Tag). Das gilt auch, wenn die Datei danach nicht signiert werden kann.
 */
export function addSvgProvenanceMetadata(svg: string, aiGenerated = true): string {
  if (svg.includes("Iptc4xmpExt:DigitalSourceType")) return svg;
  return svg.replace(/<svg\b[^>]*>/, (open) => `${open}${XMP_METADATA(aiGenerated)}`);
}
