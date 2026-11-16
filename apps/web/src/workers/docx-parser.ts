/**
 * DOCX lesen im Ingest-Worker (mammoth, nur Rohtext).
 *
 * Eine DOCX ist ein ZIP-Archiv. Bevor mammoth (über JSZip) entpackt, prüft dieses Modul das
 * Archiv selbst, damit eine Zip-Bombe den Browser-Tab nicht lahmlegt:
 *
 * 1. Dateigröße (wie die Upload-Grenze des Servers, 50 MB).
 * 2. Zentralverzeichnis: Zahl der Einträge, angegebene Gesamtgröße, Kompressionsverhältnis je
 *    Eintrag, keine ZIP64-Markierungen, word/document.xml vorhanden.
 * 3. Alle XML-Teile (.xml, .rels), die mammoth liest, werden zur Probe gestreamt entpackt und
 *    gezählt. So greifen die Grenzen auch, wenn die Größenangaben im Archiv gefälscht sind.
 *    Bilder und eingebettete Objekte liest extractRawText nicht; sie werden nicht entpackt.
 *
 * Gegen Hänger in mammoth selbst greift das Zeitlimit im Ingest-Client (Worker.terminate()).
 * mammoth wird erst beim ersten DOCX per import() geladen und landet in einem eigenen Chunk.
 */

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const MiB = 1024 * 1024;

export interface DocxLimits {
  /** Größte DOCX-Datei, gleich der Upload-Grenze des Servers. */
  readonly maxFileBytes: number;
  /** Einträge im ZIP; echte Word-Dateien haben selten mehr als 100. */
  readonly maxEntries: number;
  /** Summe der angegebenen unkomprimierten Größen aller Einträge (inklusive Bilder). */
  readonly maxTotalUncompressedBytes: number;
  /** Summe der tatsächlich entpackten XML-Bytes, die mammoth parsen würde. */
  readonly maxXmlBytes: number;
  /** Höchstes Verhältnis unkomprimiert zu komprimiert je Eintrag. */
  readonly maxCompressionRatio: number;
  /** Unterhalb dieser Größe wird das Verhältnis nicht geprüft (kleine Teile komprimieren stark). */
  readonly ratioMinBytes: number;
  /** Längster Text, der an den Chunker geht (500 000 Wörter brauchen rund 3,5 Mio. Zeichen). */
  readonly maxTextChars: number;
}

export const DOCX_LIMITS: DocxLimits = Object.freeze({
  maxFileBytes: 50 * MiB,
  maxEntries: 2_000,
  maxTotalUncompressedBytes: 256 * MiB,
  maxXmlBytes: 64 * MiB,
  maxCompressionRatio: 100,
  ratioMinBytes: 1 * MiB,
  maxTextChars: 5_000_000
});

export type DocxLimitCode =
  | "DOCX_TOO_LARGE"
  | "DOCX_TOO_COMPLEX"
  | "DOCX_INVALID"
  | "TEXT_TOO_LONG";

/** Verletzte Grenze oder kaputtes Archiv; code geht als Fehlercode an die Oberfläche. */
export class DocxLimitError extends Error {
  readonly code: DocxLimitCode;
  constructor(code: DocxLimitCode, message: string) {
    super(message);
    this.name = "DocxLimitError";
    this.code = code;
  }
}

export interface ZipEntryInfo {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_LENGTH = 22;
const MAX_COMMENT_LENGTH = 0xffff;
const ZIP64_MARKER_32 = 0xffffffff;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

const invalid = (message: string) => new DocxLimitError("DOCX_INVALID", message);
const tooComplex = (message: string) => new DocxLimitError("DOCX_TOO_COMPLEX", message);

function findEndOfCentralDirectory(view: DataView): number {
  const last = view.byteLength - EOCD_MIN_LENGTH;
  const first = Math.max(0, last - MAX_COMMENT_LENGTH);
  for (let pos = last; pos >= first; pos--) {
    if (view.getUint32(pos, true) === EOCD_SIGNATURE) return pos;
  }
  throw invalid("Die Datei ist kein ZIP-Archiv.");
}

/** Liest das Zentralverzeichnis eines ZIP-Archivs, ohne etwas zu entpacken. */
export function readZipDirectory(data: Uint8Array): ZipEntryInfo[] {
  if (data.byteLength < EOCD_MIN_LENGTH) throw invalid("Die Datei ist kein ZIP-Archiv.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  // ZIP64-Markierungen (0xFFFF, 0xFFFFFFFF) zeigen hinter das Verzeichnisende und scheitern hier
  if (centralOffset + centralSize > eocd) throw invalid("Das Zentralverzeichnis ist beschädigt.");

  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntryInfo[] = [];
  let pos = centralOffset;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > eocd || view.getUint32(pos, true) !== CENTRAL_SIGNATURE) {
      throw invalid("Das Zentralverzeichnis ist beschädigt.");
    }
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    entries.push({
      method: view.getUint16(pos + 10, true),
      compressedSize: view.getUint32(pos + 20, true),
      uncompressedSize: view.getUint32(pos + 24, true),
      localHeaderOffset: view.getUint32(pos + 42, true),
      name: decoder.decode(data.subarray(pos + 46, pos + 46 + nameLength))
    });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** XML-Teile liest mammoth; Bilder und eingebettete Objekte nicht. */
function isXmlPart(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".xml") || lower.endsWith(".rels");
}

function checkDeclaredSizes(entries: readonly ZipEntryInfo[], limits: DocxLimits): void {
  if (entries.length > limits.maxEntries) {
    throw tooComplex(`Das Archiv hat mehr als ${limits.maxEntries} Einträge.`);
  }
  let total = 0;
  for (const entry of entries) {
    const sizes = [entry.compressedSize, entry.uncompressedSize, entry.localHeaderOffset];
    if (sizes.includes(ZIP64_MARKER_32)) {
      throw tooComplex("ZIP64-Archive werden nicht gelesen.");
    }
    total += entry.uncompressedSize;
    if (
      entry.uncompressedSize > limits.ratioMinBytes &&
      entry.uncompressedSize > entry.compressedSize * limits.maxCompressionRatio
    ) {
      throw tooComplex(`${entry.name} ist auffällig stark komprimiert.`);
    }
  }
  if (total > limits.maxTotalUncompressedBytes) {
    throw tooComplex("Das Archiv wäre entpackt zu groß.");
  }
  if (!entries.some((entry) => entry.name === "word/document.xml")) {
    throw invalid("Die Datei ist kein Word-Dokument (word/document.xml fehlt).");
  }
}

/** Komprimierte Bytes eines Eintrags über seinen lokalen Kopf. */
function entryBody(data: Uint8Array, entry: ZipEntryInfo): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > data.byteLength || view.getUint32(offset, true) !== LOCAL_SIGNATURE) {
    throw invalid(`Der Eintrag ${entry.name} ist beschädigt.`);
  }
  const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
  const end = start + entry.compressedSize;
  if (end > data.byteLength) throw invalid(`Der Eintrag ${entry.name} ist unvollständig.`);
  return data.subarray(start, end);
}

/**
 * Entpackt zur Probe und zählt nur die Bytes; bricht ab, sobald cap überschritten ist.
 * Der Puffer wird nicht aufgehoben, der Speicherbedarf bleibt klein.
 */
async function inflatedLength(body: Uint8Array, cap: number, name: string): Promise<number> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(body);
      controller.close();
    }
  });
  const reader = source.pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return total;
      total += value.byteLength;
      if (total > cap) {
        throw tooComplex(`${name} wäre entpackt zu groß.`);
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof DocxLimitError) throw error;
    throw invalid(`${name} lässt sich nicht entpacken.`);
  }
}

/** Prüft ein DOCX-Archiv gegen die Grenzen, bevor mammoth es öffnet. */
export async function inspectDocxArchive(
  data: Uint8Array,
  limits: DocxLimits
): Promise<ZipEntryInfo[]> {
  const entries = readZipDirectory(data);
  checkDeclaredSizes(entries, limits);

  let xmlBytes = 0;
  for (const entry of entries) {
    if (!isXmlPart(entry.name)) continue;
    const body = entryBody(data, entry);
    if (entry.method === METHOD_STORED) {
      if (entry.uncompressedSize !== body.byteLength) {
        throw invalid(`Der Eintrag ${entry.name} ist beschädigt.`);
      }
      xmlBytes += body.byteLength;
    } else if (entry.method === METHOD_DEFLATE) {
      const ratioCap = Math.max(limits.ratioMinBytes, body.byteLength * limits.maxCompressionRatio);
      const cap = Math.min(ratioCap, limits.maxXmlBytes - xmlBytes);
      xmlBytes += await inflatedLength(body, cap, entry.name);
    } else {
      throw invalid(`Der Eintrag ${entry.name} nutzt ein unbekanntes Kompressionsverfahren.`);
    }
    if (xmlBytes > limits.maxXmlBytes) {
      throw tooComplex("Das Dokument wäre entpackt zu groß.");
    }
  }
  return entries;
}

/** Liest den Rohtext einer DOCX; Bilder, Formatierung und eingebettete Objekte fallen weg. */
export type DocxRawTextExtractor = (data: Uint8Array) => Promise<string>;

/** Standard: mammoth.extractRawText, erst beim ersten DOCX geladen (eigener Chunk). */
export const extractRawTextWithMammoth: DocxRawTextExtractor = async (data) => {
  const mammoth = await import("mammoth");
  const arrayBuffer = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength
  ) as ArrayBuffer;
  // Browser-Build liest arrayBuffer, der Node-Build (Tests) liest buffer (Ansatz aus PR #397)
  const result = await mammoth.extractRawText({ arrayBuffer, buffer: data } as {
    arrayBuffer: ArrayBuffer;
  });
  return result.value;
};

export interface ExtractDocxOptions {
  readonly limits?: Partial<DocxLimits> | undefined;
  readonly extractRawText?: DocxRawTextExtractor | undefined;
}

/** Prüft die DOCX gegen alle Grenzen und liefert den Text, Absätze mit Leerzeile getrennt. */
export async function extractDocxText(
  data: Uint8Array,
  options: ExtractDocxOptions = {}
): Promise<string> {
  const limits: DocxLimits = { ...DOCX_LIMITS, ...options.limits };
  if (data.byteLength > limits.maxFileBytes) {
    throw new DocxLimitError("DOCX_TOO_LARGE", "Die Word-Datei ist zu groß.");
  }
  await inspectDocxArchive(data, limits);

  const raw = await (options.extractRawText ?? extractRawTextWithMammoth)(data);
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > limits.maxTextChars) {
    throw new DocxLimitError("TEXT_TOO_LONG", "Der Text der Word-Datei ist zu lang.");
  }
  return text;
}
