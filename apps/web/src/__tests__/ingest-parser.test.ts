import { describe, expect, it } from "vitest";
import {
  type IngestParserWorkerRequest,
  type IngestParserWorkerResponse,
  extractMarkdownSections,
  handleParserMessage,
  parseDocumentToChunks
} from "../workers/ingest-parser.js";

describe("Markdown Section Extraction (#87)", () => {
  it("extracts hierarchy for markdown with #, ##, ### headers", () => {
    const md = `# Document Title
Intro paragraph.

## Section 1: Overview
Content for overview with multiple sentences.

### Subsection 1.1: Deep Dive
Detailed deep dive text here.

## Section 2: Summary
Final notes and conclusions.`;

    const sections = extractMarkdownSections(md);
    expect(sections.length).toBeGreaterThanOrEqual(4);

    expect(sections[0]).toMatchObject({
      header: "Document Title",
      level: 1
    });
    expect(sections[0]?.content).toContain("Intro paragraph.");

    expect(sections[1]).toMatchObject({
      header: "Section 1: Overview",
      level: 2
    });
    expect(sections[1]?.content).toContain("Content for overview");

    expect(sections[2]).toMatchObject({
      header: "Subsection 1.1: Deep Dive",
      level: 3
    });
    expect(sections[2]?.content).toContain("Detailed deep dive text here.");

    expect(sections[3]).toMatchObject({
      header: "Section 2: Summary",
      level: 2
    });
    expect(sections[3]?.content).toContain("Final notes");
  });

  it("handles markdown without headers as a single section", () => {
    const raw = "Just simple paragraphs.\n\nWithout any markdown headers.";
    const sections = extractMarkdownSections(raw);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.header).toBeNull();
    expect(sections[0]?.level).toBe(0);
    expect(sections[0]?.content).toBe(raw);
  });
});

describe("Document Parsing to Chunks (#86, #87, #88)", () => {
  it("parses plain text and markdown documents into token chunks", async () => {
    const content = `# Architecture Guide
This is the main introduction to the architecture of the system.

## Ingestion Layer
The ingestion layer parses markdown and text directly in the Web Worker.`;

    const chunks = await parseDocumentToChunks({
      fileData: new TextEncoder().encode(content),
      fileName: "guide.md",
      mimeType: "text/markdown"
    });

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.text).toContain("Architecture Guide");
    for (const chunk of chunks) {
      expect(chunk.chunkIndex).toBeDefined();
      expect(chunk.tokenCount).toBeGreaterThan(0);
      expect(chunk.startOffset).toBeGreaterThanOrEqual(0);
      expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);
    }
  });

  it("assigns accurate pageNumbers when parsing multi-page documents (PDF adapter)", async () => {
    const mockPdfPages = [
      { pageNumber: 1, text: "Page 1: Introduction to NotebookLM clone architecture." },
      { pageNumber: 2, text: "Page 2: Vector embeddings and hybrid retrieval details." }
    ];

    const chunks = await parseDocumentToChunks({
      fileData: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      fileName: "doc.pdf",
      mimeType: "application/pdf",
      customPdfExtractor: async () => mockPdfPages
    });

    expect(chunks.length).toBe(2);
    expect(chunks[0]?.pageNumber).toBe(1);
    expect(chunks[0]?.text).toContain("Page 1");
    expect(chunks[1]?.pageNumber).toBe(2);
    expect(chunks[1]?.text).toContain("Page 2");
  });

  it("throws for unsupported mime types", async () => {
    await expect(
      parseDocumentToChunks({
        fileData: new Uint8Array([0x00]),
        fileName: "image.png",
        mimeType: "image/png"
      })
    ).rejects.toThrow(/Unsupported mime type/);
  });
});

describe("Worker Event Protocol (#88)", () => {
  it("handles PARSE_DOCUMENT message and emits PROGRESS and CHUNKS_EXTRACTED events", async () => {
    const emittedMessages: IngestParserWorkerResponse[] = [];
    const postMessage = (msg: IngestParserWorkerResponse) => {
      emittedMessages.push(msg);
    };

    const request: IngestParserWorkerRequest = {
      type: "PARSE_DOCUMENT",
      payload: {
        fileData: new TextEncoder().encode("# Hello\nWorld"),
        fileName: "hello.md",
        mimeType: "text/markdown"
      }
    };

    await handleParserMessage(request, postMessage);

    const progressMessages = emittedMessages.filter((m) => m.type === "PROGRESS");
    const chunksMessage = emittedMessages.find((m) => m.type === "CHUNKS_EXTRACTED");

    expect(progressMessages.length).toBeGreaterThan(0);
    expect(progressMessages[0]?.progress).toBeGreaterThanOrEqual(0);
    expect(progressMessages[progressMessages.length - 1]?.progress).toBe(100);

    expect(chunksMessage).toBeDefined();
    if (chunksMessage && chunksMessage.type === "CHUNKS_EXTRACTED") {
      expect(chunksMessage.chunks.length).toBeGreaterThan(0);
      expect(chunksMessage.chunks[0]?.text).toContain("Hello");
    }
  });

  it("emits ERROR message if parsing fails or text is too large", async () => {
    const emittedMessages: IngestParserWorkerResponse[] = [];
    const postMessage = (msg: IngestParserWorkerResponse) => {
      emittedMessages.push(msg);
    };

    const request: IngestParserWorkerRequest = {
      type: "PARSE_DOCUMENT",
      payload: {
        fileData: new Uint8Array([0x01]),
        fileName: "unknown.xyz",
        mimeType: "application/octet-stream"
      }
    };

    await handleParserMessage(request, postMessage);

    const errorMsg = emittedMessages.find((m) => m.type === "ERROR");
    expect(errorMsg).toBeDefined();
    if (errorMsg && errorMsg.type === "ERROR") {
      expect(errorMsg.error).toContain("Unsupported mime type");
    }
  });
});
