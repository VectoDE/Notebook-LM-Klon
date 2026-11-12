import type { FlashcardItem } from "@notebook-lm/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FlashcardsViewer, describeNextReview, describeRepetitions } from "../FlashcardsViewer.js";

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
    expect(html).toContain("Quelle: <span>RAG Leitfaden S. 5</span>");
    expect(html).toContain(
      '<span class="rn-rating-label">Nochmal</span> <kbd class="rn-rating-key">1</kbd>'
    );
    expect(html).toContain('aria-keyshortcuts="1"');
    expect(html).toContain(
      '<span class="rn-rating-label">Schwer</span> <kbd class="rn-rating-key">2</kbd>'
    );
    expect(html).toContain('aria-keyshortcuts="2"');
    expect(html).toContain(
      '<span class="rn-rating-label">Gut</span> <kbd class="rn-rating-key">3</kbd>'
    );
    expect(html).toContain('aria-keyshortcuts="3"');
    expect(html).toContain(
      '<span class="rn-rating-label">Einfach</span> <kbd class="rn-rating-key">4</kbd>'
    );
    expect(html).toContain('aria-keyshortcuts="4"');
    // WCAG 2.5.3 (#314): kein eigenes aria-label, Zusatz als Beschreibung
    expect(html).not.toMatch(/class="rn-rating"[^>]*aria-label=/);
    expect(html).not.toMatch(/aria-label="[^"]*Taste/);
    expect(html).toContain("Taste 1: Falsch erinnert");
    expect(html).toContain("Taste 4: Sofort fehlerfrei gewusst");
    expect(html).toMatch(/aria-describedby="[^"]+-again"/);
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

    expect(html).toContain("Nächste Wiederholung: in 15 Tagen");
    expect(html).toContain("3 Wiederholungen");
    expect(html).not.toContain("Reps");
  });

  it("shows Klartext meta and no own aria-label on flip and source buttons (WCAG 2.5.3)", () => {
    const html = renderToStaticMarkup(createElement(FlashcardsViewer, { cards: sampleCards }));
    expect(html).toContain("Nächste Wiederholung: heute");
    expect(html).toContain("0 Wiederholungen");
    expect(html).not.toContain("Karte umdrehen");
    expect(html).not.toContain("Quelle öffnen");
  });

  it("describes intervals and repetitions in plain language", () => {
    expect(describeNextReview(0)).toBe("heute");
    expect(describeNextReview(1)).toBe("morgen");
    expect(describeNextReview(6)).toBe("in 6 Tagen");
    expect(describeRepetitions(0)).toBe("0 Wiederholungen");
    expect(describeRepetitions(1)).toBe("1 Wiederholung");
    expect(describeRepetitions(4)).toBe("4 Wiederholungen");
  });
});
