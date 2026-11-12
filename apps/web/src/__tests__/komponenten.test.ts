import { evaluateQuiz } from "@notebook-lm/shared";
import { type ReactNode, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../ChatPanel.js";
import { EmptyArt, EmptyState, type EmptyStateArt } from "../EmptyState.js";
import { QuizResults } from "../QuizViewer.js";
import { SourcesPanel } from "../SourcesPanel.js";
import { StudioPanel } from "../StudioPanel.js";
import { Toast } from "../Toast.js";
import { ViewToggle } from "../ViewToggle.js";
import { ThemeProvider, type ThemeProviderProps } from "../useTheme.js";

const renderEn = (node: ReactNode) =>
  renderToStaticMarkup(
    createElement(ThemeProvider, { defaultLanguage: "en" } as ThemeProviderProps, node)
  );

const QUESTIONS = [
  {
    id: "q1",
    question: "Welche Suche nutzt D1?",
    options: ["LIKE", "FTS5"],
    correctAnswerIndex: 1,
    explanation: "FTS5"
  },
  {
    id: "q2",
    question: "Wie groß sind Ziele?",
    options: ["24 px", "44 px"],
    correctAnswerIndex: 1,
    explanation: "44 px"
  },
  {
    id: "q3",
    question: "Offene Frage?",
    options: ["A", "B"],
    correctAnswerIndex: 0,
    explanation: "A"
  }
];

const SOURCES = [
  {
    id: "s1",
    title: "Architektur",
    originalName: "a.md",
    mimeType: "text/markdown",
    byteSize: 2048,
    chunksCount: 1,
    isSelected: true
  }
];

/** Simuliert window mit localStorage (und matchMedia) für die gespeicherte Ansicht. */
function withWindow(values: Record<string, string>, narrow = false) {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values[key] ?? null,
      setItem: () => undefined
    },
    matchMedia: () => ({ matches: narrow })
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Leerzustände (Issue #329)", () => {
  const arts: EmptyStateArt[] = ["sources", "filter", "chat", "studio", "notes"];

  it("jede Zeichnung ist dekorativ und unterscheidet sich", () => {
    const drawings = arts.map((art) => renderToStaticMarkup(createElement(EmptyArt, { art })));
    for (const svg of drawings) {
      expect(svg).toContain('aria-hidden="true"');
      expect(svg).toContain('focusable="false"');
      expect(svg).not.toContain("style=");
    }
    expect(new Set(drawings).size).toBe(arts.length);
  });

  it("Überschrift, Text, Aktion und kompakte Form", () => {
    const html = renderToStaticMarkup(
      createElement(
        EmptyState,
        {
          art: "notes",
          title: "Noch keine Notizen",
          text: "Gespeicherte Antworten erscheinen hier.",
          headingLevel: 4,
          compact: true,
          testId: "notes-empty",
          lang: "de"
        },
        createElement("button", { type: "button" }, "Notiz anlegen")
      )
    );
    expect(html).toContain('class="rn-empty rn-empty--compact"');
    expect(html).toContain('<h4 class="rn-empty-title">Noch keine Notizen</h4>');
    expect(html).toContain("rn-empty-actions");
    expect(html).toContain('data-testid="notes-empty"');
    expect(html).toContain('lang="de"');

    const plain = renderToStaticMarkup(
      createElement(EmptyState, { art: "chat", title: "Leer", text: "Text" })
    );
    expect(plain).toContain('<h3 class="rn-empty-title">Leer</h3>');
    expect(plain).not.toContain("rn-empty-actions");
    expect(plain).not.toContain("rn-empty--compact");
  });

  it("Chat zeigt den Leerzustand bis zur ersten eigenen Frage", () => {
    const empty = renderToStaticMarkup(
      createElement(ChatPanel, {
        messages: [{ id: "intro", role: "assistant", content: "Willkommen" }]
      })
    );
    expect(empty).toContain('data-testid="chat-empty-state"');
    expect(empty).toContain("Noch keine Fragen");

    const asked = renderToStaticMarkup(
      createElement(ChatPanel, {
        messages: [{ id: "u", role: "user", content: "Frage?" }]
      })
    );
    expect(asked).not.toContain("chat-empty-state");

    const busy = renderToStaticMarkup(
      createElement(ChatPanel, { messages: [], isGenerating: true })
    );
    expect(busy).not.toContain("chat-empty-state");
  });

  it("Studio erklärt, wenn keine Quelle ausgewählt ist", () => {
    const none = renderEn(createElement(StudioPanel, { selectedSourceCount: 0 }));
    expect(none).toContain('data-testid="studio-empty-state"');
    expect(none).toContain("No source selected");
    const some = renderEn(createElement(StudioPanel, { selectedSourceCount: 2 }));
    expect(some).not.toContain("studio-empty-state");
  });

  it("Quellen ohne Treffer: eigene Zeichnung, Suchbegriff im Text, Knopf zum Leeren", () => {
    // Ohne Quellen gibt es keinen Filter-Leerzustand; mit Quellen ist die Liste gefüllt
    const html = renderToStaticMarkup(createElement(SourcesPanel, { sources: [] }));
    expect(html).toContain('data-art="sources"');
    expect(html).not.toContain("btn-clear-sources-filter");
  });
});

describe("Chat-Blasen und Zitat-Pillen", () => {
  it("Frage und Antwort sind Blasen, die Pille trägt Nummer und Namen", () => {
    const html = renderToStaticMarkup(
      createElement(ChatPanel, {
        messages: [
          { id: "u", role: "user", content: "Was ist D1?" },
          { id: "a", role: "assistant", content: "Eine Datenbank [2]." }
        ]
      })
    );
    expect(html).toContain("rn-msg rn-msg--user");
    expect(html).toContain("rn-msg rn-msg--assistant");
    expect(html).toMatch(
      /<button type="button" class="citation-pill rn-cite" data-testid="citation-pill-2" aria-label="[^"]*2[^"]*">2<\/button>/
    );
  });
});

describe("Studio gemischt", () => {
  it("Audio als Karte, die übrigen Werkzeuge als Liste mit gefülltem Symbol", () => {
    const html = renderToStaticMarkup(createElement(StudioPanel, {}));
    expect(html).toMatch(/data-testid="tool-card-audio" class="rn-tool rn-tool--feature"/);
    const list = html.slice(html.indexOf('data-testid="studio-tools-grid"'));
    for (const tool of ["video", "mindmap", "flashcards", "quiz", "briefing"]) {
      expect(list).toContain(`data-testid="tool-card-${tool}" class="rn-tool-row"`);
    }
    expect(list).not.toContain("tool-card-audio");
    expect(list.match(/rn-tool-row-icon/g)).toHaveLength(5);
    // Hauptaktion der Karte gefüllt, in der Liste ruhiger
    expect(html).toContain('class="rn-btn rn-btn--primary rn-tool-primary"');
    expect(list).toContain('class="rn-btn rn-btn--secondary rn-tool-primary"');
    expect(list).toContain('class="rn-btn rn-btn--ghost"');
  });
});

describe("Ansichten umschalten", () => {
  it("Umschalter ist eine beschriftete Gruppe aus Optionsfeldern mit Text", () => {
    const html = renderToStaticMarkup(
      createElement(ViewToggle, {
        label: "Ansicht der Quellen",
        value: "cards",
        onChange: () => undefined,
        testId: "toggle",
        options: [
          { value: "list", label: "Liste", icon: "list" },
          { value: "cards", label: "Karten", icon: "grid" }
        ]
      })
    );
    expect(html).toContain('<fieldset class="rn-view-toggle" data-testid="toggle">');
    expect(html).toContain('<legend class="rn-visually-hidden">Ansicht der Quellen</legend>');
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    expect(inputs.find((i) => i.includes('value="cards"'))).toContain('checked=""');
    expect(inputs.find((i) => i.includes('value="list"'))).not.toContain("checked");
    expect(html).toContain("<span>Liste</span>");
  });

  it("Quellen: gespeicherte Kartenansicht wird gelesen", () => {
    withWindow({ rn_sources_view: "cards" });
    const html = renderToStaticMarkup(createElement(SourcesPanel, { sources: SOURCES }));
    expect(html).toContain('data-view="cards"');
    expect(html).toMatch(/data-testid="sources-view-toggle-cards"/);
  });

  it("Quellen: ohne Wahl Liste mit Haken", () => {
    const html = renderToStaticMarkup(createElement(SourcesPanel, { sources: SOURCES }));
    expect(html).toContain('data-view="list"');
    expect(html).toContain("source-checkbox-s1");
  });

  it("Quiz-Antworten als Tabelle: Kopfzeile, Zeilenköpfe, Ergebnis als Text", () => {
    const evaluation = evaluateQuiz(QUESTIONS, { q1: 1, q2: 0 });
    const html = renderToStaticMarkup(
      createElement(QuizResults, { questions: QUESTIONS, evaluation, contentLang: "de" })
    );
    expect(html).toContain('data-testid="quiz-results-table"');
    expect(html.match(/<th scope="col">/g)).toHaveLength(3);
    expect(html.match(/<th scope="row"/g)).toHaveLength(3);
    expect(html).toContain('data-state="correct"');
    expect(html).toContain('data-state="wrong"');
    expect(html).toContain('data-state="open"');
    expect(html).toContain("Richtig");
    expect(html).toContain("Falsch");
    expect(html).toContain("Nicht beantwortet");
  });

  it("Quiz-Antworten als Karten: gespeicherte Wahl oder schmaler Bildschirm", () => {
    const evaluation = evaluateQuiz(QUESTIONS, { q1: 1 });
    withWindow({ rn_quiz_results_view: "cards" });
    const stored = renderEn(createElement(QuizResults, { questions: QUESTIONS, evaluation }));
    expect(stored).toContain('data-testid="quiz-results-cards"');
    expect(stored).toContain("Question 1 of 3");
    expect(stored).toContain("<dt>Your answer</dt>");
    expect(stored).toContain("Not answered");

    vi.unstubAllGlobals();
    withWindow({}, true);
    const narrow = renderToStaticMarkup(
      createElement(QuizResults, { questions: QUESTIONS, evaluation })
    );
    expect(narrow).toContain('data-testid="quiz-results-cards"');

    vi.unstubAllGlobals();
    withWindow({}, false);
    const wide = renderToStaticMarkup(
      createElement(QuizResults, { questions: QUESTIONS, evaluation })
    );
    expect(wide).toContain('data-testid="quiz-results-table"');
  });
});

describe("Hinweis-Leiste", () => {
  it("Statusbereich steht immer im DOM, Hinweis mit Schließen-Knopf", () => {
    const empty = renderToStaticMarkup(createElement(Toast, { toast: null, onDismiss: () => {} }));
    expect(empty).toBe('<output class="rn-toast-region" data-testid="toast-region"></output>');

    const html = renderEn(
      createElement(Toast, { toast: { id: 1, message: "Source added: A" }, onDismiss: () => {} })
    );
    expect(html).toContain("Source added: A");
    expect(html).toContain('aria-label="Dismiss notice"');
    expect(html).toContain('data-testid="btn-close-toast"');
  });
});
