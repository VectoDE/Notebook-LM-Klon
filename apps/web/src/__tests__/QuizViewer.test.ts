import type { QuizQuestion } from "@notebook-lm/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuizViewer } from "../QuizViewer.js";

const sampleQuestions: QuizQuestion[] = [
  {
    id: "q_eval_1",
    question: "Welches Protokoll nutzt SSE?",
    options: ["HTTP/1.1 oder HTTP/2", "Raw TCP", "UDP", "Bluetooth"],
    correctAnswerIndex: 0,
    explanation: "Server-Sent Events basieren auf standardmäßigem HTTP-Streaming.",
    sourceCitation: "RFC 8895"
  },
  {
    id: "q_eval_2",
    question: "Wie viele Bytes belegt ein 768d int8 Vektor?",
    options: ["3072", "768", "1536", "384"],
    correctAnswerIndex: 1,
    explanation: "768 Dimensionen mal 1 Byte (int8) = 768 Bytes.",
    sourceCitation: "Skalarquantisierung Spezifikation"
  }
];

describe("QuizViewer Component (Sub-Issue #123)", () => {
  it("renders empty state when questions array is empty", () => {
    const html = renderToStaticMarkup(createElement(QuizViewer, { questions: [] }));
    expect(html).toContain("Keine Quizfragen vorhanden.");
  });

  it("renders first question with options in accessible radiogroup", () => {
    const html = renderToStaticMarkup(
      createElement(QuizViewer, {
        questions: sampleQuestions,
        title: "Test Edge Quiz"
      })
    );

    expect(html).toContain('aria-label="Quiz: Test Edge Quiz"');
    expect(html).toContain("Test Edge Quiz");
    expect(html).toContain("Frage 1 von 2");
    expect(html).toContain("Welches Protokoll nutzt SSE?");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain("HTTP/1.1 oder HTTP/2");
    expect(html).toContain("Weiter");
  });
});
