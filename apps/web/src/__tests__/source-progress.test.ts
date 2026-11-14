import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SOURCE_FILE_ACCEPT, SourceProgress, SourcesPanel } from "../SourcesPanel.js";
import { ThemeProvider, type ThemeProviderProps } from "../useTheme.js";
import type { WorkspaceSource } from "../workspace-types.js";

const renderEn = (node: ReactNode) =>
  renderToStaticMarkup(
    createElement(ThemeProvider, { defaultLanguage: "en" } as ThemeProviderProps, node)
  );

const scan: WorkspaceSource = {
  id: "src_scan",
  title: "Rechnung Scan",
  originalName: "rechnung.png",
  mimeType: "image/png",
  byteSize: 204800,
  status: "processing",
  stage: "ocr",
  progress: 42
};

const word: WorkspaceSource = {
  id: "src_word",
  title: "Bericht",
  originalName: "bericht.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  byteSize: 4096,
  status: "processing",
  stage: "docx",
  progress: 10
};

describe("Fortschritt im Quellen-Panel (#154)", () => {
  it("zeigt während der OCR einen Fortschrittsbalken mit vollständigen ARIA-Attributen", () => {
    const html = renderToStaticMarkup(createElement(SourcesPanel, { sources: [scan] }));
    expect(html).toContain('data-status="processing"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Verarbeitung von Rechnung Scan"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('aria-valuetext="Texterkennung läuft: 42 %"');
    expect(html).toContain("width:42%");
    expect(html).toContain('data-testid="source-progress-src_scan"');
    // Dateiart-Kürzel für Bilder
    expect(html).toContain(">IMG<");
  });

  it("beschreibt die DOCX-Verarbeitung auf Englisch", () => {
    const html = renderEn(createElement(SourcesPanel, { sources: [word] }));
    expect(html).toContain('aria-label="Processing Bericht"');
    expect(html).toContain('aria-valuetext="Extracting Word document: 10%"');
    expect(html).toContain(">DOCX<");
  });

  it("wechselt von processing zu ready: der Balken verschwindet", () => {
    const processing = renderToStaticMarkup(createElement(SourcesPanel, { sources: [scan] }));
    const ready = renderToStaticMarkup(
      createElement(SourcesPanel, {
        sources: [{ ...scan, status: "ready", progress: 100, chunksCount: 3 }]
      })
    );
    expect(processing).toContain('role="progressbar"');
    expect(ready).toContain('data-status="ready"');
    expect(ready).not.toContain('role="progressbar"');
    // Quellen ohne Status (Demo-Daten) gelten als bereit
    const legacy = renderToStaticMarkup(
      createElement(SourcesPanel, { sources: [{ ...scan, status: undefined }] })
    );
    expect(legacy).toContain('data-status="ready"');
  });

  it("begrenzt den Wert auf 0–100 und nutzt Standardwerte für fehlende Angaben", () => {
    const over = renderToStaticMarkup(
      createElement(SourceProgress, { source: { ...scan, progress: 140.6 } })
    );
    expect(over).toContain('aria-valuenow="100"');
    const bare = renderToStaticMarkup(
      createElement(SourceProgress, {
        source: { ...scan, progress: undefined, stage: undefined }
      })
    );
    expect(bare).toContain('aria-valuenow="0"');
    expect(bare).toContain('aria-valuetext="Datei wird gelesen: 0 %"');
    const under = renderToStaticMarkup(
      createElement(SourceProgress, { source: { ...scan, progress: -5, stage: "chunking" } })
    );
    expect(under).toContain('aria-valuetext="Text wird aufgeteilt: 0 %"');
    const pdf = renderToStaticMarkup(
      createElement(SourceProgress, { source: { ...scan, stage: "pdf" } })
    );
    expect(pdf).toContain("PDF wird ausgelesen: 42 %");
  });

  it("zeigt Fehler als Text statt Balken, in beiden Sprachen", () => {
    const de = renderToStaticMarkup(
      createElement(SourcesPanel, {
        sources: [{ ...scan, status: "error", errorCode: "unreadable" }]
      })
    );
    expect(de).toContain('data-status="error"');
    expect(de).not.toContain('role="progressbar"');
    expect(de).toContain("Kein lesbarer Text gefunden.");
    const en = renderEn(
      createElement(SourceProgress, {
        source: { ...scan, status: "error", errorCode: "too_large" }
      })
    );
    expect(en).toContain("Too much text: 500,000 words per source at most.");
    const fallback = renderToStaticMarkup(
      createElement(SourceProgress, { source: { ...scan, status: "error" } })
    );
    expect(fallback).toContain("Die Datei konnte nicht verarbeitet werden.");
    const unsupported = renderToStaticMarkup(
      createElement(SourceProgress, {
        source: { ...scan, status: "error", errorCode: "unsupported" }
      })
    );
    expect(unsupported).toContain("Dieses Dateiformat wird nicht unterstützt.");
  });

  it("nimmt Word-Dateien und Bilder im Dateidialog an", () => {
    for (const type of [".docx", ".png", ".jpg", ".jpeg", ".webp", "image/webp"]) {
      expect(SOURCE_FILE_ACCEPT.split(",")).toContain(type);
    }
  });
});
