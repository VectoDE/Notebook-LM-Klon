/**
 * Artifact Exporters (SVG, PNG, Anki-CSV, Markdown, Print-HTML / PDF).
 *
 * Implements Sub-Issue #124 (Decision #62, #70):
 * - Mindmap: SVG, PNG (Canvas-Export), JSON
 * - Flashcards: Anki-compatibles CSV (Tab-getrennt mit UTF-8 BOM), JSON
 * - Briefing/FAQ/Timeline: Markdown, HTML/Druck-optimiertes CSS für PDF-Export
 */

import {
  type BriefingArtifactPayload,
  type FAQArtifactPayload,
  type FlashcardItem,
  type MindmapNode,
  type QuizQuestion,
  type TimelineArtifactPayload,
  formatArtifactToPrintHtml,
  formatBriefingToMarkdown,
  formatFAQToMarkdown,
  formatTimelineToMarkdown,
  serializeFlashcardsToAnkiCsv
} from "@notebook-lm/shared";

export interface ExportDownloadResult {
  readonly filename: string;
  readonly mimeType: string;
  readonly content: string | Blob;
}

// Download-Helfer liegen in download.ts (ohne die Formatierer der gemeinsamen Bibliothek),
// damit die Oberfläche sie beim Start laden kann. Hier bleiben sie unter altem Namen erreichbar.
export {
  DOWNLOAD_FILENAME_MAX_LENGTH,
  escapeHtmlText,
  toSafeFilename,
  triggerBrowserDownload
} from "./download.js";

// ---------------------------------------------------------------------------
// Mindmap Exporters
// ---------------------------------------------------------------------------

export function exportMindmapToSvgString(svgElementOrMarkup: SVGSVGElement | string): string {
  if (typeof svgElementOrMarkup === "string") {
    return svgElementOrMarkup.startsWith("<?xml")
      ? svgElementOrMarkup
      : `<?xml version="1.0" encoding="UTF-8"?>\n${svgElementOrMarkup}`;
  }

  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svgElementOrMarkup);
  if (!source.match(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)) {
    source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${source}`;
}

export function exportMindmapToJson(rootNode: MindmapNode): string {
  return JSON.stringify({ root: rootNode }, null, 2);
}

/**
 * Converts an SVG element to a PNG Blob via an offscreen HTMLCanvasElement.
 */
export async function exportMindmapSvgToPngBlob(
  svgElement: SVGSVGElement,
  options?: { width?: number; height?: number }
): Promise<Blob> {
  const svgString = exportMindmapToSvgString(svgElement);
  const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  return new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = options?.width ?? svgElement.clientWidth ?? 1200;
      const height = options?.height ?? svgElement.clientHeight ?? 800;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Konnte Canvas-2D-Kontext nicht initialisieren"));
        return;
      }

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);

      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("PNG-Konvertierung auf Canvas fehlgeschlagen"));
        }
      }, "image/png");
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("SVG konnte nicht in Image gerendert werden"));
    };

    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Flashcards Exporters
// ---------------------------------------------------------------------------

export function exportFlashcardsToAnkiCsv(
  cards: readonly FlashcardItem[],
  options?: { defaultTag?: string }
): ExportDownloadResult {
  const csvContent = serializeFlashcardsToAnkiCsv(cards, options);
  return {
    filename: "relationnotes-flashcards-anki.csv",
    mimeType: "text/csv;charset=utf-8",
    content: csvContent
  };
}

export function exportFlashcardsToJson(cards: readonly FlashcardItem[]): string {
  return JSON.stringify({ cards }, null, 2);
}

// ---------------------------------------------------------------------------
// Quiz Exporters
// ---------------------------------------------------------------------------

export function exportQuizToJson(questions: readonly QuizQuestion[]): string {
  return JSON.stringify({ questions }, null, 2);
}

// ---------------------------------------------------------------------------
// Briefing, FAQ & Timeline Exporters
// ---------------------------------------------------------------------------

export function exportBriefingToMarkdown(
  briefing: BriefingArtifactPayload,
  title?: string
): ExportDownloadResult {
  const md = formatBriefingToMarkdown(briefing, title);
  return {
    filename: "executive-briefing.md",
    mimeType: "text/markdown;charset=utf-8",
    content: md
  };
}

export function exportFAQToMarkdown(faq: FAQArtifactPayload, title?: string): ExportDownloadResult {
  const md = formatFAQToMarkdown(faq, title);
  return {
    filename: "faq.md",
    mimeType: "text/markdown;charset=utf-8",
    content: md
  };
}

export function exportTimelineToMarkdown(
  timeline: TimelineArtifactPayload,
  title?: string
): ExportDownloadResult {
  const md = formatTimelineToMarkdown(timeline, title);
  return {
    filename: "timeline.md",
    mimeType: "text/markdown;charset=utf-8",
    content: md
  };
}

export function exportArtifactToPrintHtml(params: {
  title: string;
  markdownContent: string;
}): ExportDownloadResult {
  const html = formatArtifactToPrintHtml(params);
  return {
    filename: `${params.title.toLowerCase().replace(/[^a-z0-9]/g, "_")}.html`,
    mimeType: "text/html;charset=utf-8",
    content: html
  };
}
