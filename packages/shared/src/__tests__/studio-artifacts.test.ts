import { describe, expect, it } from "vitest";
import {
  type BriefingArtifactPayload,
  type FAQArtifactPayload,
  type FlashcardItem,
  MindmapArtifactPayloadSchema,
  type MindmapNode,
  type QuizQuestion,
  type TimelineArtifactPayload,
  evaluateQuiz,
  flattenMindmapTree,
  formatArtifactToPrintHtml,
  formatBriefingToMarkdown,
  formatFAQToMarkdown,
  formatTimelineToMarkdown,
  serializeFlashcardsToAnkiCsv
} from "../studio-artifacts.js";

describe("Studio Artifacts Utilities & Generators (Sub-Issues #122, #123, #124)", () => {
  describe("Mindmap Tree Traversals", () => {
    it("flattens recursive mindmap tree preserving depth and parent relationships", () => {
      const tree: MindmapNode = {
        id: "root",
        label: "Hauptknoten",
        sourceCitation: "Doc 0",
        children: [
          {
            id: "child1",
            label: "Kind 1",
            sourceId: "src1",
            chunkId: "chk1",
            sourceCitation: "Doc 1",
            children: [{ id: "subchild1", label: "Unterkind 1" }]
          },
          {
            id: "child2",
            label: "Kind 2"
          }
        ]
      };

      // Also validate with Zod schema to execute MindmapNodeSchema lazy evaluation
      expect(MindmapArtifactPayloadSchema.parse({ root: tree }).root.id).toBe("root");

      const flat = flattenMindmapTree(tree);
      expect(flat).toHaveLength(4);
      expect(flat[0]).toEqual({
        id: "root",
        label: "Hauptknoten",
        depth: 0,
        parentId: null,
        childIds: ["child1", "child2"],
        sourceCitation: "Doc 0"
      });
      expect(flat[1]).toEqual({
        id: "child1",
        label: "Kind 1",
        depth: 1,
        parentId: "root",
        childIds: ["subchild1"],
        sourceId: "src1",
        chunkId: "chk1",
        sourceCitation: "Doc 1"
      });
      expect(flat[2]).toEqual({
        id: "subchild1",
        label: "Unterkind 1",
        depth: 2,
        parentId: "child1",
        childIds: []
      });
      expect(flat[3]).toEqual({
        id: "child2",
        label: "Kind 2",
        depth: 1,
        parentId: "root",
        childIds: []
      });
    });
  });

  describe("Anki CSV Serialization", () => {
    it("serializes flashcards into valid Anki CSV with UTF-8 BOM, tab separation and source hints", () => {
      const cards: FlashcardItem[] = [
        {
          id: "fc1",
          front: "Was ist RAG?",
          back: "Retrieval-Augmented Generation",
          sourceHint: "Dokumentation S. 12",
          tags: ["ki", "architektur"]
        },
        {
          id: "fc2",
          front: "Zeilenumbruch\nFrage",
          back: "Antwort mit\tTab",
          tags: []
        }
      ];

      const csv = serializeFlashcardsToAnkiCsv(cards);
      expect(csv.startsWith("\uFEFF")).toBe(true);
      expect(csv).toContain("#separator:tab");
      expect(csv).toContain("#html:true");
      expect(csv).toContain("#tags column:3");

      const lines = csv.split("\n");
      expect(lines).toHaveLength(5);

      // Card 1
      expect(lines[3]).toContain(
        'Was ist RAG?\tRetrieval-Augmented Generation<br><small class="source-hint">Quelle: Dokumentation S. 12</small>\tki architektur'
      );
      // Card 2: newlines replaced with <br>, tab in back replaced with space
      expect(lines[4]).toContain(
        "Zeilenumbruch<br>Frage\tAntwort mit Tab\trelationnotes_flashcard"
      );
    });
  });

  describe("Quiz Evaluation", () => {
    const questions: QuizQuestion[] = [
      {
        id: "q1",
        question: "1+1=?",
        options: ["1", "2", "3", "4"],
        correctAnswerIndex: 1,
        explanation: "1+1 ist 2."
      },
      {
        id: "q2",
        question: "Hauptstadt von DE?",
        options: ["München", "Hamburg", "Berlin", "Köln"],
        correctAnswerIndex: 2,
        explanation: "Berlin ist die Hauptstadt."
      }
    ];

    it("evaluates fully correct quiz responses", () => {
      const result = evaluateQuiz(questions, { q1: 1, q2: 2 });
      expect(result.totalQuestions).toBe(2);
      expect(result.answeredCount).toBe(2);
      expect(result.correctCount).toBe(2);
      expect(result.incorrectCount).toBe(0);
      expect(result.scorePercentage).toBe(100);
      expect(result.isComplete).toBe(true);
      expect(result.details[0]?.isCorrect).toBe(true);
      expect(result.details[1]?.isCorrect).toBe(true);
    });

    it("evaluates partially answered or incorrect quiz responses", () => {
      const result = evaluateQuiz(questions, { q1: 0 }); // wrong answer, q2 unanswered
      expect(result.totalQuestions).toBe(2);
      expect(result.answeredCount).toBe(1);
      expect(result.correctCount).toBe(0);
      expect(result.incorrectCount).toBe(1);
      expect(result.scorePercentage).toBe(0);
      expect(result.isComplete).toBe(false);
      expect(result.details[0]?.isCorrect).toBe(false);
      expect(result.details[0]?.selectedIndex).toBe(0);
      expect(result.details[1]?.selectedIndex).toBeNull();
    });

    it("handles empty questions list gracefully", () => {
      const result = evaluateQuiz([], {});
      expect(result.totalQuestions).toBe(0);
      expect(result.scorePercentage).toBe(0);
      expect(result.isComplete).toBe(false);
    });
  });

  describe("Briefing, FAQ & Timeline Formatters", () => {
    it("formats Executive Briefing into structured Markdown", () => {
      const briefing: BriefingArtifactPayload = {
        executiveSummary: "Zusammenfassung des Dokuments.",
        keyTakeaways: ["Punkt A", "Punkt B"],
        actionItems: ["Aufgabe 1", "Aufgabe 2"]
      };

      const md = formatBriefingToMarkdown(briefing, "Custom Briefing Title");
      expect(md).toContain("# Custom Briefing Title");
      expect(md).toContain("## Zusammenfassung\nZusammenfassung des Dokuments.");
      expect(md).toContain("- Punkt A\n- Punkt B");
      expect(md).toContain("1. Aufgabe 1\n1. Aufgabe 2");
    });

    it("formats FAQs into Markdown", () => {
      const faq: FAQArtifactPayload = {
        faqs: [
          {
            question: "Wie funktioniert X?",
            answer: "X funktioniert via Y.",
            sourceHint: "Handbuch S. 4"
          },
          {
            question: "Ohne Quelle?",
            answer: "Einfach so."
          }
        ]
      };

      const md = formatFAQToMarkdown(faq);
      expect(md).toContain("# Häufig gestellte Fragen (FAQ)");
      expect(md).toContain("### Wie funktioniert X?");
      expect(md).toContain("X funktioniert via Y.");
      expect(md).toContain("*Quelle: Handbuch S. 4*");
      expect(md).toContain("### Ohne Quelle?");
      expect(md).toContain("Einfach so.");
    });

    it("formats Timeline into Markdown", () => {
      const timeline: TimelineArtifactPayload = {
        events: [
          {
            dateOrPhase: "2026-Q1",
            title: "Kickoff",
            description: "Start des Projekts",
            sourceHint: "Roadmap"
          },
          {
            dateOrPhase: "2026-Q2",
            title: "Phase 2",
            description: "Rollout"
          }
        ]
      };

      const md = formatTimelineToMarkdown(timeline);
      expect(md).toContain("# Chronologische Timeline");
      expect(md).toContain("### 2026-Q1: Kickoff");
      expect(md).toContain("Start des Projekts");
      expect(md).toContain("*Quelle: Roadmap*");
      expect(md).toContain("### 2026-Q2: Phase 2");
    });

    it("formats artifact to print-optimized HTML", () => {
      const html = formatArtifactToPrintHtml({
        title: "Test <Report> & Summary",
        markdownContent: "# Überschrift\nText & Notizen"
      });

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<title>Test &lt;Report&gt; &amp; Summary</title>");
      expect(html).toContain("@page {");
      expect(html).toContain("Text &amp; Notizen");
    });
  });
});
