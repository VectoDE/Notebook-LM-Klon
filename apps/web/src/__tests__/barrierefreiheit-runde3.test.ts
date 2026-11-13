import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatPanel } from "../ChatPanel.js";
import { FlashcardsViewer } from "../FlashcardsViewer.js";
import { MindmapViewer } from "../MindmapViewer.js";
import { QuizViewer } from "../QuizViewer.js";
import { SourcesPanel } from "../SourcesPanel.js";
import { StudioPanel } from "../StudioPanel.js";
import { DEFAULT_CONTENT_LANGS, DEFAULT_SOURCES, WorkspaceLayout } from "../WorkspaceLayout.js";
import { AREA_DE, AREA_EN } from "../translations-areas.js";
import { validateSourceUrl } from "../url-validation.js";

describe("URL-Prüfung im Import-Dialog (#323)", () => {
  it("verlangt eine Eingabe", () => {
    expect(validateSourceUrl("")).toBe("srcUrlRequired");
    expect(validateSourceUrl("   ")).toBe("srcUrlRequired");
  });

  it("lehnt unvollständige Adressen und fremde Schemata ab", () => {
    expect(validateSourceUrl("kein link")).toBe("srcUrlInvalid");
    expect(validateSourceUrl("docs.google.com/document/d/1")).toBe("srcUrlInvalid");
    expect(validateSourceUrl("javascript:alert(1)")).toBe("srcUrlInvalid");
    expect(validateSourceUrl("ftp://example.org/datei")).toBe("srcUrlInvalid");
  });

  it("akzeptiert http und https, auch mit Leerraum", () => {
    expect(validateSourceUrl("https://example.org/artikel")).toBeNull();
    expect(validateSourceUrl("  http://example.org  ")).toBeNull();
  });

  it("hat Meldungen in beiden Sprachen", () => {
    for (const key of ["srcUrlRequired", "srcUrlInvalid", "podStateError", "audioRetry"]) {
      expect(AREA_DE[key], key).toBeTruthy();
      expect(AREA_EN[key], key).toBeTruthy();
    }
    expect(AREA_DE.srcUrlInvalid).toContain("https://");
    expect(AREA_EN.srcUrlInvalid).toContain("https://");
  });

  it("der Dialog nutzt eigene Meldungen statt der Browserblase", () => {
    const src = readFileSync(resolve(__dirname, "../SourcesPanel.tsx"), "utf8");
    expect(src).toContain("noValidate");
    expect(src).toContain("aria-invalid={urlError");
    expect(src).toContain("aria-describedby={urlError ? urlErrorId");
  });
});

describe("Sprachauszeichnung der Inhalte (#323)", () => {
  it("Quellentitel und Volltext tragen ihre Sprache", () => {
    const html = renderToStaticMarkup(
      createElement(SourcesPanel, {
        sources: DEFAULT_SOURCES,
        activeCitation: { sourceId: "src_1" }
      })
    );
    expect(html).toContain('<span class="rn-source-title" lang="en">Cloudflare Worker');
    expect(html).toContain('<h3 lang="en">Cloudflare Worker &amp; DO Architecture</h3>');
    expect(html).toMatch(/class="rn-inspector-content" lang="en"/);
  });

  it("ohne Sprachangabe kein lang-Attribut", () => {
    const html = renderToStaticMarkup(
      createElement(SourcesPanel, {
        sources: [
          { id: "a", title: "Notiz", originalName: "a.txt", mimeType: "text/plain", byteSize: 1 }
        ]
      })
    );
    expect(html).not.toContain(" lang=");
  });

  it("die Demodaten nennen ihre Sprache", () => {
    expect(DEFAULT_SOURCES.every((s) => s.lang === "en")).toBe(true);
    expect(DEFAULT_CONTENT_LANGS).toEqual({
      summary: "de",
      mindmap: "en",
      flashcards: "de",
      quiz: "de",
      sources: "en"
    });
  });

  it("Zusammenfassung, Lernkarten, Quiz und Mindmap übernehmen die Sprache", () => {
    const chat = renderToStaticMarkup(
      createElement(ChatPanel, {
        messages: [],
        notebookSummary: "Zusammenfassung",
        notebookSummaryLang: "de"
      })
    );
    expect(chat).toContain('<p class="rn-summary-text" lang="de">Zusammenfassung</p>');

    const cards = renderToStaticMarkup(
      createElement(FlashcardsViewer, {
        cards: [{ id: "c", front: "Vorderseite", back: "Rückseite", sourceHint: "Guide" }],
        contentLang: "de",
        sourceLang: "en"
      })
    );
    expect(cards).toContain('<p class="rn-flashcard-text" lang="de">Vorderseite</p>');
    expect(cards).toContain('Quelle: <span lang="en">Guide</span>');

    const quiz = renderToStaticMarkup(
      createElement(QuizViewer, {
        questions: [
          {
            id: "q",
            question: "Frage?",
            options: ["A", "B"],
            correctAnswerIndex: 0,
            explanation: "E"
          }
        ],
        contentLang: "de"
      })
    );
    expect(quiz).toContain('<legend class="rn-quiz-question" lang="de">Frage?</legend>');
    expect(quiz).toContain('<span class="rn-quiz-option-text" lang="de">A</span>');

    const mindmap = renderToStaticMarkup(
      createElement(MindmapViewer, {
        rootNode: { id: "r", label: "Compute" },
        contentLang: "en"
      })
    );
    // Beschriftung bricht in <tspan>-Zeilen um (Issue #279), die Sprache sitzt am <text>
    expect(mindmap).toMatch(/class="rn-mm-label" lang="en"><tspan[^>]*>Compute<\/tspan><\/text>/);
    expect(mindmap).toContain('<span class="rn-tree-text" lang="en"><strong>Compute</strong>');
  });

  it("das Studio reicht die Sprachen an die Werkzeuge weiter", () => {
    const html = renderToStaticMarkup(
      createElement(StudioPanel, {
        activeTool: "quiz",
        quizData: [
          { id: "q", question: "Frage?", options: ["A"], correctAnswerIndex: 0, explanation: "E" }
        ],
        contentLangs: DEFAULT_CONTENT_LANGS
      })
    );
    expect(html).toContain('lang="de">Frage?</legend>');
  });
});

describe("Fokusziele der Bereiche (#323)", () => {
  it("data-panel sitzt auf der benannten Region, nicht auf dem Wrapper", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceLayout));
    expect(html).toMatch(
      /<section aria-label="Quellen-Panel" class="sources-panel rn-panel-body" data-testid="sources-panel" data-panel="sources" tabindex="-1"/
    );
    expect(html).toMatch(
      /<section aria-label="Wissens- und Chat-Panel"[^>]*data-panel="chat" tabindex="-1"/
    );
    expect(html).toMatch(
      /<section aria-label="Studio-Panel"[^>]*data-panel="studio" tabindex="-1"/
    );
    // Die Layout-Wrapper sind keine Fokusziele mehr
    expect(html).not.toMatch(/data-testid="panel-left-wrapper"[^>]*tabindex/);
    expect(html.match(/data-panel=/g)).toHaveLength(3);
  });
});
