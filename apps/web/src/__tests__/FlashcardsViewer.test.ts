import type { FlashcardItem } from "@notebook-lm/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FlashcardsViewer } from "../FlashcardsViewer.js";

const sampleCards: FlashcardItem[] = [
  {
    id: "c1",
    front: "Was ist RRF?",
    back: "Reciprocal Rank Fusion kombiniert semantische und Volltextsuchen.",
    sourceHint: "RAG Leitfaden S. 5"
  },
  {
    id: "c2",
    front: "Wie viel Speicher spart int8?",
    back: "75% gegenüber float32.",
    sourceHint: "Vektor-Architektur"
  }
];

describe("FlashcardsViewer Component (Sub-Issue #123)", () => {
  it("renders empty state when cards array is empty", () => {
    const html = renderToStaticMarkup(createElement(FlashcardsViewer, { cards: [] }));
    expect(html).toContain("Keine Lernkarten vorhanden.");
  });

  it("renders first card in front/question mode with accessible controls", () => {
    const html = renderToStaticMarkup(
      createElement(FlashcardsViewer, {
        cards: sampleCards,
        title: "Test Vektor-Karten"
      })
    );

    expect(html).toContain('aria-label="Lernkarten: Test Vektor-Karten"');
    expect(html).toContain("Test Vektor-Karten");
    expect(html).toContain("Karte 1 von 2");
    expect(html).toContain("Was ist RRF?");
    expect(html).toContain("Antwort aufdecken");
    expect(html).toContain("Quelle: RAG Leitfaden S. 5");
    expect(html).toContain("Nochmal (1)");
    expect(html).toContain("Schwer (2)");
    expect(html).toContain("Gut (3)");
    expect(html).toContain("Einfach (4)");
  });

  it("renders card with custom initial review states", () => {
    const html = renderToStaticMarkup(
      createElement(FlashcardsViewer, {
        cards: sampleCards,
        initialStates: {
          0: {
            repetitions: 3,
            intervalDays: 15,
            easeFactor: 2.6
          }
        }
      })
    );

    expect(html).toContain("Intervall: 15d | Reps: 3");
  });
});
