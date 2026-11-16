/**
 * Herkunftsnachweis nach C2PA für exportierte Medien (Issue #353).
 *
 * Signiert werden nur Formate, die die offizielle C2PA-Implementierung (c2pa-rs, c2patool)
 * einbetten kann. WebM, Ogg und Opus gehören nicht dazu (docs/supported-formats.md im Repo
 * contentauth/c2pa-rs); Videos werden deshalb bevorzugt als MP4 aufgenommen.
 * Diese Datei enthält nur reine Daten und Funktionen; signiert wird serverseitig.
 */

/** Medienarten mit Dateiendung, die c2patool 0.29 signieren kann und die die App exportiert. */
export const C2PA_SIGNABLE_FORMATS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "video/mp4": "mp4"
};

/** Formate, die C2PA nicht unterstützt; der Export bleibt dann unsigniert. */
export const C2PA_UNSUPPORTED_FORMATS: readonly string[] = [
  "video/webm",
  "audio/webm",
  "audio/ogg",
  "audio/opus"
];

/** Größte Datei, die zum Signieren angenommen wird (Bytes). */
export const PROVENANCE_MAX_BYTES = 64 * 1024 * 1024;

/** IPTC-Code für Inhalte, die ein trainiertes Modell erzeugt hat. */
export const DIGITAL_SOURCE_TYPE_TRAINED_ALGORITHMIC =
  "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

export const PROVENANCE_GENERATOR_NAME = "RelationNotes";

/** Grundtyp ohne Parameter, klein geschrieben: "video/mp4;codecs=avc1" -> "video/mp4". */
export function baseMimeType(mimeType: string): string {
  return (mimeType.split(";")[0] as string).trim().toLowerCase();
}

/** Dateiendung für einen signierbaren Typ, sonst null. */
export function c2paExtensionFor(mimeType: string): string | null {
  return C2PA_SIGNABLE_FORMATS[baseMimeType(mimeType)] ?? null;
}

export function isC2paSignable(mimeType: string): boolean {
  return c2paExtensionFor(mimeType) !== null;
}

/** Art des Signaturzertifikats: Testzertifikat der C2PA-Projekte oder eigenes Zertifikat. */
export type ProvenanceCertificateKind = "test" | "production";

export interface ProvenanceStatus {
  /** Server kann signieren. */
  readonly available: boolean;
  readonly certificate: ProvenanceCertificateKind | null;
  readonly formats: readonly string[];
}

export interface ManifestOptions {
  readonly title: string;
  readonly mimeType: string;
  readonly generatorVersion: string;
  /** Von einem KI-Modell erzeugt (Studio-Ausgaben); sonst "digital erstellt". */
  readonly aiGenerated: boolean;
}

/** Höchstlänge des Titels im Manifest. */
export const MANIFEST_TITLE_MAX_LENGTH = 200;

/**
 * Manifest-Definition im Format von c2patool (ohne Schlüsselpfade, die setzt der Signierer).
 * Sie hält fest, wer die Datei erzeugt hat und dass sie aus einem KI-Modell stammt
 * (c2pa.actions.v2, Aktion c2pa.created mit IPTC digitalSourceType).
 */
export function buildManifestDefinition(options: ManifestOptions): Record<string, unknown> {
  const title =
    options.title
      .replace(/\p{Cc}/gu, " ")
      .trim()
      .slice(0, MANIFEST_TITLE_MAX_LENGTH) || "Export";
  const created: Record<string, unknown> = { action: "c2pa.created" };
  created.digitalSourceType = options.aiGenerated
    ? DIGITAL_SOURCE_TYPE_TRAINED_ALGORITHMIC
    : "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCreation";
  return {
    claim_generator_info: [{ name: PROVENANCE_GENERATOR_NAME, version: options.generatorVersion }],
    title,
    format: baseMimeType(options.mimeType),
    assertions: [{ label: "c2pa.actions.v2", data: { actions: [created] } }]
  };
}
