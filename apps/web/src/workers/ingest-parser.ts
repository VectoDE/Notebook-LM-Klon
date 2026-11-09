import { type TextChunk, chunkText } from "@notebook-lm/shared";

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
  | { type: "CHUNKS_EXTRACTED"; chunks: TextChunk[] }
  | { type: "ERROR"; error: string };

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

/**
 * Page-by-page PDF text extractor.
 * Dynamically imports pdfjs-dist when in browser/worker environment.
 */
export async function extractPdfTextByPages(
  data: Uint8Array
): Promise<Array<{ pageNumber: number; text: string }>> {
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

/**
 * Parses supported document formats into semantic token chunks.
 */
export async function parseDocumentToChunks(options: ParseDocumentOptions): Promise<TextChunk[]> {
  const { fileData, fileName, mimeType, maxTokens, overlapTokens, customPdfExtractor } = options;

  const normalizedMime = mimeType.toLowerCase();
  const isMarkdown =
    normalizedMime === "text/markdown" ||
    normalizedMime === "text/x-markdown" ||
    fileName.endsWith(".md") ||
    fileName.endsWith(".markdown");

  const isPlainText = normalizedMime === "text/plain" || fileName.endsWith(".txt");

  const isPdf = normalizedMime === "application/pdf" || fileName.endsWith(".pdf");

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
    return allChunks;
  }

  if (isPlainText) {
    const text = new TextDecoder("utf-8").decode(fileData);
    return chunkText({
      text,
      maxTokens,
      overlapTokens
    });
  }

  if (isPdf) {
    const extractor = customPdfExtractor ?? extractPdfTextByPages;
    const pages = await extractor(fileData);
    const allChunks: TextChunk[] = [];
    let globalIndex = 0;

    for (const page of pages) {
      if (!page.text || page.text.trim().length === 0) continue;
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
    return allChunks;
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

    const chunks = await parseDocumentToChunks({
      fileData: request.payload.fileData,
      fileName: request.payload.fileName,
      mimeType: request.payload.mimeType,
      maxTokens: request.payload.maxTokens,
      overlapTokens: request.payload.overlapTokens
    });

    postMessage({ type: "PROGRESS", progress: 80 });
    postMessage({ type: "PROGRESS", progress: 100 });
    postMessage({ type: "CHUNKS_EXTRACTED", chunks });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postMessage({ type: "ERROR", error: message });
  }
}
