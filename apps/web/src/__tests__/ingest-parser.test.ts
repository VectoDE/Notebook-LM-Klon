import { readFileSync } from "node:fs";
import { TextTooLargeError } from "@notebook-lm/shared";
import { describe, expect, it } from "vitest";
import {
  DOCX_MIME_TYPE,
  type IngestParserWorkerRequest,
  type IngestParserWorkerResponse,
  type ParserOverrides,
  UnsupportedFormatError,
  extractMarkdownSections,
  extractPdfTextByPages,
  handleParserMessage,
  ingestErrorCode,
  parseDocument,
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
        fileName: "animation.gif",
        mimeType: "image/gif"
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
      expect(errorMsg.code).toBe("unsupported");
    }
  });
});

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe("PDF-Auszug aus einer echten mehrseitigen Datei (#87)", () => {
  it("liest jede Seite mit ihrer Seitenzahl aus", { timeout: 180_000 }, async () => {
    const data = fixture("three-pages.pdf");
    const pages = await extractPdfTextByPages(data);
    expect(pages).toEqual([
      { pageNumber: 1, text: "Seite eins: Einleitung in die Architektur des Klons." },
      { pageNumber: 2, text: "Seite zwei: Vektoren und hybride Suche im Durable Object." },
      { pageNumber: 3, text: "Seite drei: Zusammenfassung und Ausblick." }
    ]);
    // Die Datei des Aufrufers bleibt unverändert nutzbar (PDF.js bekommt eine Kopie)
    expect(await extractPdfTextByPages(data)).toHaveLength(3);
  });

  it("ordnet jedem Chunk die Seitenzahl seiner Seite zu", { timeout: 180_000 }, async () => {
    const { chunks, text } = await parseDocument({
      fileData: fixture("three-pages.pdf"),
      fileName: "three-pages.pdf",
      mimeType: "application/pdf"
    });
    expect(chunks).toHaveLength(3);
    const pageOf = (needle: string) => chunks.find((c) => c.text.includes(needle))?.pageNumber;
    expect(pageOf("Einleitung")).toBe(1);
    expect(pageOf("Vektoren")).toBe(2);
    expect(pageOf("Ausblick")).toBe(3);
    expect(new Set(chunks.map((c) => c.pageNumber))).toEqual(new Set([1, 2, 3]));
    chunks.forEach((chunk, index) => {
      expect(chunk.chunkIndex).toBe(index);
    });
    expect(text.split("\n\n")).toHaveLength(3);
  });

  it("überspringt leere Seiten und lehnt PDFs ganz ohne Text ab", async () => {
    const chunks = await parseDocumentToChunks({
      fileData: new Uint8Array([1]),
      fileName: "scan.pdf",
      mimeType: "",
      customPdfExtractor: async () => [
        { pageNumber: 1, text: "  " },
        { pageNumber: 2, text: "Nur Seite zwei hat Text." }
      ]
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.pageNumber).toBe(2);

    await expect(
      parseDocument({
        fileData: new Uint8Array([1]),
        fileName: "leer.pdf",
        mimeType: "application/pdf",
        customPdfExtractor: async () => [{ pageNumber: 1, text: "" }]
      })
    ).rejects.toThrow(/keinen auslesbaren Text/);
  });

  it("weist eine beschädigte PDF-Datei zurück", { timeout: 180_000 }, async () => {
    await expect(extractPdfTextByPages(new TextEncoder().encode("kein pdf"))).rejects.toThrow();
  });
});

describe("Markdown und TXT mit exakten Offsets (#86, #88)", () => {
  it("behält Überschriften-Kontext und zeigt mit Offsets exakt in die Originaldatei", async () => {
    const md = [
      "Vorwort ohne Überschrift.",
      "",
      "# Kapitel 1",
      "Erster Absatz im Kapitel.",
      "",
      "## Abschnitt 1.1",
      "Text im Abschnitt.",
      ""
    ].join("\r\n");
    const { chunks, text } = await parseDocument({
      fileData: new TextEncoder().encode(md),
      fileName: "notizen.markdown",
      mimeType: ""
    });
    expect(text).toBe(md);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
    expect(chunks[1]?.text.startsWith("# Kapitel 1")).toBe(true);
    expect(chunks[2]?.text.startsWith("## Abschnitt 1.1")).toBe(true);
    for (const chunk of chunks) {
      expect(md.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text);
    }
  });

  it("liefert Abschnittsgrenzen und überspringt leeren Vorspann", () => {
    const md = "\n\n# Titel\nInhalt";
    expect(extractMarkdownSections(md)).toEqual([
      { header: "Titel", level: 1, content: "Inhalt", startOffset: 2, endOffset: md.length }
    ]);
    expect(extractMarkdownSections("")).toEqual([
      { header: null, level: 0, content: "", startOffset: 0, endOffset: 0 }
    ]);
  });

  it("zerlegt TXT-Dateien auch ohne MIME-Typ anhand der Endung", async () => {
    const { chunks } = await parseDocument({
      fileData: new TextEncoder().encode("Einfacher Text."),
      fileName: "LIESMICH.TXT",
      mimeType: ""
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.text).toBe("Einfacher Text.");
  });
});

describe("DOCX und Bilder im Parser (#152, #153)", () => {
  it(
    "verarbeitet eine echte .docx-Datei mit Überschriften-Kontext",
    { timeout: 180_000 },
    async () => {
      const stages: string[] = [];
      const { chunks, text } = await parseDocument({
        fileData: fixture("structured.docx"),
        fileName: "bericht.docx",
        mimeType: DOCX_MIME_TYPE,
        maxTokens: 30,
        overlapTokens: 5,
        onProgress: (stage) => stages.push(stage)
      });
      expect(stages).toEqual(["docx", "chunking"]);
      expect(text.startsWith("# Projektbericht Quellen")).toBe(true);
      expect(chunks.find((c) => c.text.includes("Datei hochladen"))?.text).toContain("## Schritte");
      for (const chunk of chunks) {
        expect(text.slice(chunk.startOffset, chunk.endOffset)).toBe(chunk.text);
      }
    }
  );

  it("erkennt DOCX auch nur an der Endung und nutzt einen eingeschleusten Konverter", async () => {
    const { text } = await parseDocument({
      fileData: new Uint8Array([1]),
      fileName: "Notiz.DOCX",
      mimeType: "application/octet-stream",
      customDocxConverter: async () => "<h2>Kurz</h2><p>Inhalt</p>"
    });
    expect(text).toBe("## Kurz\n\nInhalt");
  });

  it("führt Bilder durch die OCR-Pipeline und skaliert deren Fortschritt auf 0–90 %", async () => {
    const progress: Array<[string, number]> = [];
    const { chunks, text } = await parseDocument({
      fileData: new Uint8Array([1, 2]),
      fileName: "foto.jpeg",
      mimeType: "image/jpeg",
      onProgress: (stage, value) => progress.push([stage, value]),
      customOcrRecognizer: async (_image, onLog) => {
        onLog({ status: "recognizing text", progress: 0.5 });
        return { text: "Text aus dem Bild", confidence: 90 };
      }
    });
    expect(text).toBe("Text aus dem Bild");
    expect(chunks).toHaveLength(1);
    expect(progress).toEqual([
      ["ocr", 0],
      ["ocr", 59],
      ["ocr", 90],
      ["chunking", 95]
    ]);
  });

  it("leitet den Bildtyp aus der Endung ab, wenn der Browser keinen liefert", async () => {
    const seen: string[] = [];
    for (const name of ["a.png", "b.webp", "c.jpg"]) {
      await parseDocument({
        fileData: new Uint8Array([1]),
        fileName: name,
        mimeType: "",
        customOcrRecognizer: async () => {
          seen.push(name);
          return { text: "ok", confidence: 99 };
        }
      });
    }
    expect(seen).toEqual(["a.png", "b.webp", "c.jpg"]);
  });
});

describe("Worker-Pipeline progress → chunks_ready / error (#88)", () => {
  it(
    "meldet steigenden Fortschritt mit Phase und zum Schluss Chunks samt Volltext",
    { timeout: 180_000 },
    async () => {
      const messages: IngestParserWorkerResponse[] = [];
      await handleParserMessage(
        {
          type: "PARSE_DOCUMENT",
          payload: {
            fileData: fixture("three-pages.pdf"),
            fileName: "three-pages.pdf",
            mimeType: "application/pdf"
          }
        },
        (m) => messages.push(m)
      );
      const types = messages.map((m) => m.type);
      expect(types.at(-1)).toBe("CHUNKS_EXTRACTED");
      expect(types.slice(0, -1).every((t) => t === "PROGRESS")).toBe(true);
      const progress = messages.flatMap((m) => (m.type === "PROGRESS" ? [m] : []));
      expect(progress.map((m) => m.stage)).toEqual(["reading", "pdf", "chunking", "chunking"]);
      expect(progress.map((m) => m.progress)).toEqual([5, 10, 70, 100]);
      const done = messages.at(-1);
      if (done?.type !== "CHUNKS_EXTRACTED") throw new Error("missing result");
      expect(done.chunks.map((c) => c.pageNumber)).toEqual([1, 2, 3]);
      expect(done.text).toContain("Seite drei");
    }
  );

  it("meldet Fehler mit Code: unlesbares Bild, zu viel Text, unbekannte Anfrage", async () => {
    const run = async (request: IngestParserWorkerRequest, overrides: ParserOverrides = {}) => {
      const messages: IngestParserWorkerResponse[] = [];
      await handleParserMessage(request, (m) => messages.push(m), overrides);
      return messages.at(-1);
    };

    expect(
      await run(
        {
          type: "PARSE_DOCUMENT",
          payload: { fileData: new Uint8Array([1]), fileName: "x.png", mimeType: "image/png" }
        },
        { customOcrRecognizer: async () => ({ text: "", confidence: 0 }) }
      )
    ).toMatchObject({ type: "ERROR", code: "unreadable" });

    expect(
      await run({
        type: "PARSE_DOCUMENT",
        payload: {
          fileData: new TextEncoder().encode("wort ".repeat(500_001)),
          fileName: "riesig.txt",
          mimeType: "text/plain"
        }
      })
    ).toMatchObject({ type: "ERROR", code: "too_large" });

    expect(await run({ type: "UNKNOWN" } as unknown as IngestParserWorkerRequest)).toMatchObject({
      type: "ERROR",
      code: "failed",
      error: "Unknown request type: UNKNOWN"
    });
  });

  it("ordnet Fehlerarten Codes zu, auch für Nicht-Error-Werte", () => {
    expect(ingestErrorCode(new UnsupportedFormatError("a/b", "c"))).toBe("unsupported");
    expect(ingestErrorCode(new TextTooLargeError(2, 1))).toBe("too_large");
    expect(ingestErrorCode("kaputt")).toBe("failed");
  });

  it("wandelt geworfene Nicht-Error-Werte in eine Fehlermeldung um", async () => {
    const messages: IngestParserWorkerResponse[] = [];
    await handleParserMessage(
      {
        type: "PARSE_DOCUMENT",
        payload: { fileData: new Uint8Array([1]), fileName: "x.pdf", mimeType: "application/pdf" }
      },
      (m) => messages.push(m),
      {
        customPdfExtractor: async () => {
          throw "kein Error-Objekt";
        }
      }
    );
    expect(messages.at(-1)).toEqual({ type: "ERROR", error: "kein Error-Objekt", code: "failed" });
  });
});
