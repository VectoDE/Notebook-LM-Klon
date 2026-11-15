import { type TextChunk, chunkText } from "@notebook-lm/shared";
import { DOCX_MIME_TYPE, DocxLimitError, extractDocxText } from "./docx-parser.js";

export interface DocumentSection {
  header: string | null;
  level: number;
  content: string;
}

export interface ParseDocumentOptions {
  fileData: Uint8Array;
  fileName: string;
  mimeType: string;
  maxTokens?: number | undefined;
  overlapTokens?: number | undefined;
  customPdfExtractor?:
    | ((data: Uint8Array) => Promise<Array<{ pageNumber: number; text: string }>>)
    | undefined;
  /** Ersetzt den DOCX-Leser (Tests); Standard ist extractDocxText mit mammoth. */
  customDocxExtractor?: ((data: Uint8Array) => Promise<string>) | undefined;
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
  | { type: "PROGRESS"; progress: number }
  | { type: "CHUNKS_EXTRACTED"; chunks: TextChunk[]; text: string }
  | { type: "ERROR"; error: string; code?: string | undefined };

/** Fehlercode für die Oberfläche: Grenzen beim DOCX-Lesen und die Wortgrenze des Chunkers. */
function errorCodeOf(error: unknown): string | undefined {
  if (error instanceof DocxLimitError) return error.code;
  if (error instanceof Error && error.name === "TextTooLargeError") return "TEXT_TOO_LONG";
  return undefined;
}

/**
 * Extracts sections from markdown preserving header hierarchy (#, ##, ###).
 */
export function extractMarkdownSections(markdown: string): DocumentSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: DocumentSection[] = [];

  let currentHeader: string | null = null;
  let currentLevel = 0;
  let currentLines: string[] = [];

  const flush = () => {
    const content = currentLines.join("\n").trim();
    if (content.length > 0 || currentHeader !== null) {
      sections.push({
        header: currentHeader,
        level: currentLevel,
        content
      });
    }
    currentLines = [];
  };

  const headerRegex = /^(#{1,6})\s+(.+)$/;

  for (const line of lines) {
    const match = headerRegex.exec(line);
    if (match?.[1] && match[2]) {
      flush();
      currentLevel = match[1].length;
      currentHeader = match[2].trim();
    } else {
      currentLines.push(line);
    }
  }

  flush();

  if (sections.length === 0) {
    return [
      {
        header: null,
        level: 0,
        content: markdown.trim()
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
 * Lädt pdfjs-dist erst bei Bedarf. Wir laufen schon in einem Web Worker: der PDF.js-Worker
 * wird deshalb als Modul im selben Thread eingebunden statt über workerSrc (Ansatz aus PR #397).
 */
export async function extractPdfTextByPages(
  data: Uint8Array
): Promise<Array<{ pageNumber: number; text: string }>> {
  const scope = globalThis as PdfjsWorkerGlobal;
  scope.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true
  });
  const pdfDocument = await loadingTask.promise;
  const numPages = pdfDocument.numPages;
  const pages: Array<{ pageNumber: number; text: string }> = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDocument.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .trim();

    pages.push({
      pageNumber: pageNum,
      text: pageText
    });
  }

  return pages;
}

export interface ParsedDocument {
  chunks: TextChunk[];
  /** Volltext für die Vorschau der Quelle (PDF: Seiten mit Leerzeile getrennt). */
  text: string;
}

/**
 * Parses supported document formats into semantic token chunks.
 */
export async function parseDocumentToChunks(options: ParseDocumentOptions): Promise<TextChunk[]> {
  return (await parseDocument(options)).chunks;
}

/**
 * Liest ein Dokument und liefert Chunks und Volltext.
 */
export async function parseDocument(options: ParseDocumentOptions): Promise<ParsedDocument> {
  const {
    fileData,
    fileName,
    mimeType,
    maxTokens,
    overlapTokens,
    customPdfExtractor,
    customDocxExtractor
  } = options;

  const normalizedMime = mimeType.toLowerCase();
  const isMarkdown =
    normalizedMime === "text/markdown" ||
    normalizedMime === "text/x-markdown" ||
    fileName.endsWith(".md") ||
    fileName.endsWith(".markdown");

  const isPlainText = normalizedMime === "text/plain" || fileName.endsWith(".txt");

  const isPdf = normalizedMime === "application/pdf" || fileName.endsWith(".pdf");

  const isDocx = normalizedMime === DOCX_MIME_TYPE || fileName.toLowerCase().endsWith(".docx");

  if (isMarkdown) {
    const text = new TextDecoder("utf-8").decode(fileData);
    const sections = extractMarkdownSections(text);
    const allChunks: TextChunk[] = [];
    let globalIndex = 0;

    for (const section of sections) {
      const sectionText = section.header
        ? `${"#".repeat(Math.max(1, section.level))} ${section.header}\n\n${section.content}`
        : section.content;

      const chunks = chunkText({
        text: sectionText,
        maxTokens,
        overlapTokens
      });

      for (const ch of chunks) {
        allChunks.push({
          ...ch,
          chunkIndex: globalIndex++
        });
      }
    }
    return { chunks: allChunks, text };
  }

  if (isPlainText) {
    const text = new TextDecoder("utf-8").decode(fileData);
    return {
      chunks: chunkText({
        text,
        maxTokens,
        overlapTokens
      }),
      text
    };
  }

  if (isPdf) {
    const extractor = customPdfExtractor ?? extractPdfTextByPages;
    const pages = await extractor(fileData);
    const allChunks: TextChunk[] = [];
    const pageTexts: string[] = [];
    let globalIndex = 0;

    for (const page of pages) {
      if (!page.text || page.text.trim().length === 0) continue;
      pageTexts.push(page.text);
      const chunks = chunkText({
        text: page.text,
        maxTokens,
        overlapTokens,
        pageNumber: page.pageNumber
      });
      for (const ch of chunks) {
        allChunks.push({
          ...ch,
          chunkIndex: globalIndex++
        });
      }
    }
    return { chunks: allChunks, text: pageTexts.join("\n\n") };
  }

  if (isDocx) {
    // Bilder und eingebettete Objekte fallen weg; Seitenzahlen kennt eine DOCX nicht
    const text = await (customDocxExtractor ?? extractDocxText)(fileData);
    return { chunks: chunkText({ text, maxTokens, overlapTokens }), text };
  }

  throw new Error(`Unsupported mime type: ${mimeType} for file: ${fileName}`);
}

/**
 * Handler for ingest worker message events.
 */
export async function handleParserMessage(
  request: IngestParserWorkerRequest,
  postMessage: (response: IngestParserWorkerResponse) => void
): Promise<void> {
  try {
    if (request.type !== "PARSE_DOCUMENT") {
      throw new Error(`Unknown request type: ${(request as { type: string }).type}`);
    }

    postMessage({ type: "PROGRESS", progress: 10 });

    const { chunks, text } = await parseDocument({
      fileData: request.payload.fileData,
      fileName: request.payload.fileName,
      mimeType: request.payload.mimeType,
      maxTokens: request.payload.maxTokens,
      overlapTokens: request.payload.overlapTokens
    });

    postMessage({ type: "PROGRESS", progress: 80 });
    postMessage({ type: "PROGRESS", progress: 100 });
    postMessage({ type: "CHUNKS_EXTRACTED", chunks, text });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postMessage({ type: "ERROR", error: message, code: errorCodeOf(error) });
  }
}
