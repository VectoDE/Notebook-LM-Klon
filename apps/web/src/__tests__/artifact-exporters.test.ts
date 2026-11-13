import type {
  BriefingArtifactPayload,
  FAQArtifactPayload,
  FlashcardItem,
  MindmapNode,
  QuizQuestion,
  TimelineArtifactPayload
} from "@notebook-lm/shared";
import { describe, expect, it, vi } from "vitest";
import {
  DOWNLOAD_FILENAME_MAX_LENGTH,
  escapeHtmlText,
  exportArtifactToPrintHtml,
  exportBriefingToMarkdown,
  exportFAQToMarkdown,
  exportFlashcardsToAnkiCsv,
  exportFlashcardsToJson,
  exportMindmapSvgToPngBlob,
  exportMindmapToJson,
  exportMindmapToSvgString,
  exportQuizToJson,
  exportTimelineToMarkdown,
  toSafeFilename,
  triggerBrowserDownload
} from "../artifact-exporters.js";

describe("Titel als reiner Text in Exporten (Issue #325)", () => {
  it("maskiert HTML-Sonderzeichen und lässt normalen Text unverändert", () => {
    expect(escapeHtmlText("Cloudflare Edge Stack")).toBe("Cloudflare Edge Stack");
    expect(escapeHtmlText(`<img src="x" onerror='a()'> & Co`)).toBe(
      "&lt;img src=&quot;x&quot; onerror=&#39;a()&#39;&gt; &amp; Co"
    );
  });
});

describe("Sichere Dateinamen (Issue #325)", () => {
  it("lässt übliche Namen stehen und ersetzt Pfad-, Markup- und Leerzeichen", () => {
    expect(toSafeFilename("export.csv")).toBe("export.csv");
    expect(toSafeFilename("Größe_Übersicht-2.svg")).toBe("Größe_Übersicht-2.svg");
    expect(toSafeFilename("Mein Projekt_mindmap.svg")).toBe("Mein_Projekt_mindmap.svg");
    expect(toSafeFilename('<img src=x onerror="a()">_quiz.json')).toBe(
      "img_src_x_onerror_a_quiz.json"
    );
    expect(toSafeFilename("../../etc/passwd")).toBe("etc_passwd");
    expect(toSafeFilename("a\u0000b\nc")).toBe("a_b_c");
  });

  it("kürzt lange Namen und fällt bei leerem Ergebnis auf „download“ zurück", () => {
    expect(toSafeFilename("x".repeat(300))).toHaveLength(DOWNLOAD_FILENAME_MAX_LENGTH);
    expect(toSafeFilename("")).toBe("download");
    expect(toSafeFilename("<>/")).toBe("download");
  });
});

describe("Artifact Exporters (Sub-Issue #124)", () => {
  describe("triggerBrowserDownload", () => {
    it("returns false in node/server-side environment without window or document", () => {
      const res = triggerBrowserDownload("test.txt", "hello", "text/plain");
      expect(res).toBe(false);
    });

    it("triggers DOM anchor click and revokes object URL in browser environment", () => {
      const originalDoc = globalThis.document;
      const originalWindow = globalThis.window;

      const clickMock = vi.fn();
      const appendChildMock = vi.fn();
      const removeChildMock = vi.fn();
      const createObjectURLMock = vi.fn().mockReturnValue("blob:http://localhost/123");
      const revokeObjectURLMock = vi.fn();

      const fakeAnchor: Record<string, unknown> = {
        href: "",
        download: "",
        click: clickMock,
        // Der Download-Helfer setzt href und download über setAttribute.
        setAttribute: (name: string, value: string) => {
          fakeAnchor[name] = value;
        }
      };

      const fakeDoc = {
        createElement: (tag: string) => {
          if (tag === "a") return fakeAnchor;
          return {};
        },
        body: {
          appendChild: appendChildMock,
          removeChild: removeChildMock
        }
      };

      (globalThis as unknown as { document: unknown }).document = fakeDoc;
      (globalThis as unknown as { window: unknown }).window = {};
      (globalThis as unknown as { URL: unknown }).URL = {
        createObjectURL: createObjectURLMock,
        revokeObjectURL: revokeObjectURLMock
      };

      try {
        const success = triggerBrowserDownload("export.csv", "a,b,c", "text/csv");
        expect(success).toBe(true);
        expect(fakeAnchor.download).toBe("export.csv");
        expect(fakeAnchor.href).toBe("blob:http://localhost/123");
        expect(clickMock).toHaveBeenCalledOnce();
        expect(appendChildMock).toHaveBeenCalledWith(fakeAnchor);
        expect(removeChildMock).toHaveBeenCalledWith(fakeAnchor);
        expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:http://localhost/123");
      } finally {
        (globalThis as unknown as { document: unknown }).document = originalDoc;
        (globalThis as unknown as { window: unknown }).window = originalWindow;
      }
    });
  });

  describe("Mindmap Exporter", () => {
    const node: MindmapNode = {
      id: "root",
      label: "Root",
      children: [{ id: "c1", label: "Child" }]
    };

    it("exports mindmap JSON string", () => {
      const jsonStr = exportMindmapToJson(node);
      const parsed = JSON.parse(jsonStr);
      expect(parsed.root.label).toBe("Root");
    });

    it("exports SVG string with XML declaration", () => {
      const svgMarkup = '<svg width="100"><circle r="10"/></svg>';
      const svg = exportMindmapToSvgString(svgMarkup);
      expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(svg).toContain('<svg width="100">');

      const alreadyXml = '<?xml version="1.0" encoding="UTF-8"?>\n<svg></svg>';
      expect(exportMindmapToSvgString(alreadyXml)).toBe(alreadyXml);
    });

    it("serializes SVGSVGElement instance to SVG string adding xmlns if missing", () => {
      const fakeSvg = {
        nodeType: 1
      } as unknown as SVGSVGElement;

      const originalXMLSerializer = globalThis.XMLSerializer;
      globalThis.XMLSerializer = class {
        serializeToString() {
          return '<svg width="200"><g></g></svg>';
        }
      } as unknown as typeof XMLSerializer;

      try {
        const res = exportMindmapToSvgString(fakeSvg);
        expect(res).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(res.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      } finally {
        globalThis.XMLSerializer = originalXMLSerializer;
      }
    });

    it("converts SVG element to PNG blob via mock Canvas", async () => {
      const originalImage = globalThis.Image;
      const originalDocument = globalThis.document;
      const originalXMLSerializer = globalThis.XMLSerializer;

      globalThis.XMLSerializer = class {
        serializeToString() {
          return '<svg xmlns="http://www.w3.org/2000/svg" width="200"></svg>';
        }
      } as unknown as typeof XMLSerializer;

      let capturedOnLoad: (() => void) | null = null;
      class MockImage {
        src = "";
        set onload(fn: () => void) {
          capturedOnLoad = fn;
        }
      }

      const mockCtx = {
        fillStyle: "",
        fillRect: vi.fn(),
        drawImage: vi.fn()
      };

      const mockCanvas = {
        width: 0,
        height: 0,
        getContext: () => mockCtx,
        toBlob: (cb: (blob: Blob | null) => void) => {
          cb(new Blob(["png-data"], { type: "image/png" }));
        }
      };

      (globalThis as unknown as { Image: unknown }).Image = MockImage;
      (globalThis as unknown as { document: unknown }).document = {
        createElement: (tag: string) => {
          if (tag === "canvas") return mockCanvas;
          return {};
        }
      };

      try {
        const fakeSvg = { clientWidth: 800, clientHeight: 600 } as SVGSVGElement;
        const promise = exportMindmapSvgToPngBlob(fakeSvg);
        // trigger image onload
        if (capturedOnLoad) {
          (capturedOnLoad as () => void)();
        }
        const blob = await promise;
        expect(blob.type).toBe("image/png");
        expect(mockCtx.fillRect).toHaveBeenCalled();
        expect(mockCtx.drawImage).toHaveBeenCalled();
      } finally {
        (globalThis as unknown as { Image: unknown }).Image = originalImage;
        (globalThis as unknown as { document: unknown }).document = originalDocument;
        globalThis.XMLSerializer = originalXMLSerializer;
      }
    });
  });

  describe("Flashcard & Quiz Exporters", () => {
    const cards: FlashcardItem[] = [
      { front: "Frage 1", back: "Antwort 1", sourceHint: "Quelle A" }
    ];

    it("exports flashcards to Anki CSV result with correct filename and mime", () => {
      const res = exportFlashcardsToAnkiCsv(cards);
      expect(res.filename).toBe("relationnotes-flashcards-anki.csv");
      expect(res.mimeType).toBe("text/csv;charset=utf-8");
      expect(typeof res.content).toBe("string");
      expect(res.content as string).toContain("Frage 1\tAntwort 1");
    });

    it("exports flashcards and quiz to JSON", () => {
      const jsonCards = exportFlashcardsToJson(cards);
      expect(JSON.parse(jsonCards).cards).toHaveLength(1);

      const questions: QuizQuestion[] = [
        {
          id: "q1",
          question: "F?",
          options: ["A", "B"],
          correctAnswerIndex: 0,
          explanation: "Weil A"
        }
      ];
      const jsonQuiz = exportQuizToJson(questions);
      expect(JSON.parse(jsonQuiz).questions).toHaveLength(1);
    });
  });

  describe("Briefing, FAQ & Timeline Exporters", () => {
    it("exports Briefing to Markdown result", () => {
      const briefing: BriefingArtifactPayload = {
        executiveSummary: "Zusammenfassung",
        keyTakeaways: ["K1"],
        actionItems: ["A1"]
      };
      const res = exportBriefingToMarkdown(briefing, "Titel");
      expect(res.filename).toBe("executive-briefing.md");
      expect(res.mimeType).toBe("text/markdown;charset=utf-8");
      expect(res.content as string).toContain("# Titel");
    });

    it("exports FAQ to Markdown result", () => {
      const faq: FAQArtifactPayload = {
        faqs: [{ question: "Was?", answer: "Das." }]
      };
      const res = exportFAQToMarkdown(faq);
      expect(res.filename).toBe("faq.md");
      expect(res.mimeType).toBe("text/markdown;charset=utf-8");
      expect(res.content as string).toContain("### Was?");
    });

    it("exports Timeline to Markdown result", () => {
      const timeline: TimelineArtifactPayload = {
        events: [{ dateOrPhase: "2026", title: "Go-Live", description: "Start" }]
      };
      const res = exportTimelineToMarkdown(timeline);
      expect(res.filename).toBe("timeline.md");
      expect(res.mimeType).toBe("text/markdown;charset=utf-8");
      expect(res.content as string).toContain("### 2026: Go-Live");
    });

    it("exports Artifact to Print HTML result", () => {
      const res = exportArtifactToPrintHtml({
        title: "Executive Report",
        markdownContent: "Inhalt"
      });
      expect(res.filename).toBe("executive_report.html");
      expect(res.mimeType).toBe("text/html;charset=utf-8");
      expect(res.content as string).toContain("<!DOCTYPE html>");
    });
  });
});
