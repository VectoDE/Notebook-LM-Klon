import { type TextChunk, TextTooLargeError, chunkText } from "@notebook-lm/shared";
import type { SourceErrorCode, SourceStage } from "../workspace-types.js";
import { type DocxHtmlConverter, extractDocx } from "./docx-extract.js";
import {
  OCR_MIME_TYPES,
  type OcrRecognizer,
  OcrUnreadableError,
  recognizeImageText
} from "./ocr-extract.js";

export interface DocumentSection {
  header: string | null;
  level: number;
  content: string;
  /** Beginn des Abschnitts (inklusive Überschriftenzeile) im Originaltext. */
  startOffset: number;
  /** Ende des Abschnitts im Originaltext (exklusiv). */
  endOffset: number;
}

export interface PdfPageText {
  pageNumber: number;
  text: string;
}

/** Phase der Verarbeitung, für Fortschrittstexte in der Oberfläche (Issue #154). */
export type IngestStage = SourceStage;

export type IngestErrorCode = SourceErrorCode;

export interface ParseDocumentOptions {
  fileData: Uint8Array;
  fileName: string;
  mimeType: string;
  maxTokens?: number | undefined;
  overlapTokens?: number | undefined;
  onProgress?: ((stage: IngestStage, progress: number) => void) | undefined;
  customPdfExtractor?: ((data: Uint8Array) => Promise<PdfPageText[]>) | undefined;
  customDocxConverter?: DocxHtmlConverter | undefined;
  customOcrRecognizer?: OcrRecognizer | undefined;
}

export interface ParsedDocument {
  chunks: TextChunk[];
  /** Erkannter Volltext für die Quellenvorschau. */
  text: string;
}

export interface IngestParserWorkerRequest {
  type: "PARSE_DOCUMENT";
  payload: {
    fileData: Uint8Array;
    fileName: string;
    mimeType: string;
    maxTokens?: number | undefined;
    overlapTokens?: number | undefined;
  };
}

export type IngestParserWorkerResponse =
  | { type: "PROGRESS"; progress: number; stage: IngestStage }
  | { type: "CHUNKS_EXTRACTED"; chunks: TextChunk[]; text: string }
  | { type: "ERROR"; error: string; code: IngestErrorCode };

export class UnsupportedFormatError extends Error {
  constructor(mimeType: string, fileName: string) {
    super(`Unsupported mime type: ${mimeType} for file: ${fileName}`);
    this.name = "UnsupportedFormatError";
  }
}

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Extracts sections from markdown preserving header hierarchy (#, ##, ###).
 * Jeder Abschnitt kennt seine Lage im Originaltext, damit Chunk-Offsets exakt bleiben.
 */
export function extractMarkdownSections(markdown: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const headerRegex = /^(#{1,6})\s+(.+)$/;

  let currentHeader: string | null = null;
  let currentLevel = 0;
  let currentLines: string[] = [];
  let sectionStart = 0;

  const flush = (end: number) => {
    const content = currentLines.join("\n").trim();
    if (content.length > 0 || currentHeader !== null) {
      sections.push({
        header: currentHeader,
        level: currentLevel,
        content,
        startOffset: sectionStart,
        endOffset: end
      });
    }
    currentLines = [];
  };

  let offset = 0;
  for (const raw of markdown.split(/(?<=\n)/)) {
    const line = raw.replace(/\r?\n$/, "");
    const header = headerRegex.exec(line);
    if (header?.[1] && header[2]) {
      flush(offset);
      sectionStart = offset;
      currentLevel = header[1].length;
      currentHeader = header[2].trim();
    } else {
      currentLines.push(line);
    }
    offset += raw.length;
  }
  flush(markdown.length);

  if (sections.length === 0) {
    return [
      {
        header: null,
        level: 0,
        content: markdown.trim(),
        startOffset: 0,
        endOffset: markdown.length
      }
    ];
  }

  return sections;
}

interface PdfjsWorkerGlobal {
  pdfjsWorker?: unknown;
}

/**
 * Page-by-page PDF text extractor.
 * Lädt pdfjs-dist erst bei Bedarf. Der PDF.js-Worker läuft im selben Thread (wir sind schon
 * in einem Web Worker), deshalb wird sein Modul direkt eingebunden statt per workerSrc.
 */
export async function extractPdfTextByPages(data: Uint8Array): Promise<PdfPageText[]> {
  const scope = globalThis as PdfjsWorkerGlobal;
  scope.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjsLib.getDocument({
    // PDF.js übernimmt den Puffer; die Kopie lässt die Datei des Aufrufers unverändert
    data: data.slice(),
    useSystemFonts: true,
    disableFontFace: true
  });
  const pdfDocument = await loadingTask.promise;
  const pages: PdfPageText[] = [];

  try {
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent({ includeMarkedContent: true });
      const pageText = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push({ pageNumber: pageNum, text: pageText });
    }
  } finally {
    await loadingTask.destroy();
  }

  return pages;
}

function chunkMarkdown(
  text: string,
  maxTokens: number | undefined,
  overlapTokens: number | undefined
): TextChunk[] {
  const allChunks: TextChunk[] = [];
  for (const section of extractMarkdownSections(text)) {
    // Abschnitt samt Überschrift aus dem Original: Kontext bleibt, Offsets bleiben exakt
    const sectionText = text.slice(section.startOffset, section.endOffset);
    for (const ch of chunkText({ text: sectionText, maxTokens, overlapTokens })) {
      allChunks.push({
        ...ch,
        chunkIndex: allChunks.length,
        startOffset: ch.startOffset + section.startOffset,
        endOffset: ch.endOffset + section.startOffset
      });
    }
  }
  return allChunks;
}

type DocumentFormat = "markdown" | "text" | "pdf" | "docx" | "image";

function detectFormat(mimeType: string, fileName: string): DocumentFormat | null {
  const mime = mimeType.toLowerCase();
  const name = fileName.toLowerCase();
  if (mime === "text/markdown" || mime === "text/x-markdown" || /\.(md|markdown)$/.test(name)) {
    return "markdown";
  }
  if (mime === "text/plain" || name.endsWith(".txt")) return "text";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mime === DOCX_MIME_TYPE || name.endsWith(".docx")) return "docx";
  if (OCR_MIME_TYPES.includes(mime) || /\.(png|jpe?g|webp)$/.test(name)) return "image";
  return null;
}

/** Bildformat aus dem Dateinamen, falls der Browser keinen passenden MIME-Typ liefert. */
function imageMimeType(mimeType: string, fileName: string): string {
  if (OCR_MIME_TYPES.includes(mimeType.toLowerCase())) return mimeType;
  const name = fileName.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

/**
 * Parses supported document formats into semantic token chunks and returns the full text.
 */
export async function parseDocument(options: ParseDocumentOptions): Promise<ParsedDocument> {
  const { fileData, fileName, mimeType, maxTokens, overlapTokens, onProgress } = options;
  const format = detectFormat(mimeType, fileName);

  if (format === "markdown" || format === "text") {
    onProgress?.("reading", 30);
    const text = new TextDecoder("utf-8").decode(fileData);
    onProgress?.("chunking", 70);
    const chunks =
      format === "markdown"
        ? chunkMarkdown(text, maxTokens, overlapTokens)
        : chunkText({ text, maxTokens, overlapTokens });
    return { chunks, text };
  }

  if (format === "docx") {
    onProgress?.("docx", 10);
    const { markdown } = await extractDocx(fileData, options.customDocxConverter);
    onProgress?.("chunking", 70);
    return { chunks: chunkMarkdown(markdown, maxTokens, overlapTokens), text: markdown };
  }

  if (format === "image") {
    const text = await recognizeImageText({
      data: fileData,
      mimeType: imageMimeType(mimeType, fileName),
      recognize: options.customOcrRecognizer,
      // OCR füllt 0–90 %, danach folgt das Zerlegen
      onProgress: (p) => onProgress?.("ocr", Math.round(p * 0.9))
    });
    onProgress?.("chunking", 95);
    return { chunks: chunkText({ text, maxTokens, overlapTokens }), text };
  }

  if (format === "pdf") {
    onProgress?.("pdf", 10);
    const extractor = options.customPdfExtractor ?? extractPdfTextByPages;
    const pages = await extractor(fileData);
    onProgress?.("chunking", 70);
    const allChunks: TextChunk[] = [];
    const texts: string[] = [];

    for (const page of pages) {
      if (page.text.trim().length === 0) continue;
      texts.push(page.text);
      // Offsets beziehen sich auf den Text der jeweiligen Seite
      for (const ch of chunkText({
        text: page.text,
        maxTokens,
        overlapTokens,
        pageNumber: page.pageNumber
      })) {
        allChunks.push({ ...ch, chunkIndex: allChunks.length });
      }
    }
    if (allChunks.length === 0) {
      throw new OcrUnreadableError("Das PDF enthält keinen auslesbaren Text.");
    }
    return { chunks: allChunks, text: texts.join("\n\n") };
  }

  throw new UnsupportedFormatError(mimeType, fileName);
}

/** Abwärtskompatibel: nur die Chunks. */
export async function parseDocumentToChunks(options: ParseDocumentOptions): Promise<TextChunk[]> {
  return (await parseDocument(options)).chunks;
}

/** Ordnet Fehler einem Code zu, den die Oberfläche übersetzt anzeigt. */
export function ingestErrorCode(error: unknown): IngestErrorCode {
  if (error instanceof UnsupportedFormatError) return "unsupported";
  if (error instanceof OcrUnreadableError) return "unreadable";
  if (error instanceof TextTooLargeError) return "too_large";
  return "failed";
}

export type ParserOverrides = Pick<
  ParseDocumentOptions,
  "customPdfExtractor" | "customDocxConverter" | "customOcrRecognizer"
>;

/**
 * Handler for ingest worker message events.
 * Ablauf: PROGRESS (mehrfach, steigend) → CHUNKS_EXTRACTED oder ERROR.
 */
export async function handleParserMessage(
  request: IngestParserWorkerRequest,
  postMessage: (response: IngestParserWorkerResponse) => void,
  overrides: ParserOverrides = {}
): Promise<void> {
  try {
    if (request.type !== "PARSE_DOCUMENT") {
      throw new Error(`Unknown request type: ${(request as { type: string }).type}`);
    }

    let last = 0;
    const progress = (stage: IngestStage, value: number) => {
      // Nur vorwärts: der Balken springt nie zurück
      if (value <= last) return;
      last = value;
      postMessage({ type: "PROGRESS", progress: value, stage });
    };
    progress("reading", 5);

    const { chunks, text } = await parseDocument({
      fileData: request.payload.fileData,
      fileName: request.payload.fileName,
      mimeType: request.payload.mimeType,
      maxTokens: request.payload.maxTokens,
      overlapTokens: request.payload.overlapTokens,
      onProgress: progress,
      ...overrides
    });

    progress("chunking", 100);
    postMessage({ type: "CHUNKS_EXTRACTED", chunks, text });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postMessage({ type: "ERROR", error: message, code: ingestErrorCode(error) });
  }
}
