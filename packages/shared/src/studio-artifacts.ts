/**
 * Studio Artifacts: Models, Schemas, Generators, and Formatters.
 *
 * Implements Sub-Issue #122, #123, #124 (Decision #2, #31, #62, #70):
 * - Mindmap Data Structures & Tree Traversals
 * - Spaced Repetition Flashcards & Anki-CSV serialization
 * - Multiple-Choice Quiz Evaluation & Citation Explanations
 * - Executive Briefing, FAQ, Timeline Generators & Markdown/HTML Formatters
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// 1. Mindmap Models & Schemas (Sub-Issue #122)
// ---------------------------------------------------------------------------

export const MindmapNodeSchema: z.ZodType<MindmapNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    sourceId: z.string().optional(),
    chunkId: z.string().optional(),
    sourceCitation: z.string().optional(),
    children: z.array(MindmapNodeSchema).optional()
  })
);

export interface MindmapNode {
  readonly id: string;
  readonly label: string;
  readonly sourceId?: string | undefined;
  readonly chunkId?: string | undefined;
  readonly sourceCitation?: string | undefined;
  readonly children?: readonly MindmapNode[] | undefined;
}

export const MindmapArtifactPayloadSchema = z.object({
  root: MindmapNodeSchema
});
export type MindmapArtifactPayload = z.infer<typeof MindmapArtifactPayloadSchema>;

export interface FlatMindmapNode {
  readonly id: string;
  readonly label: string;
  readonly depth: number;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly sourceId?: string | undefined;
  readonly chunkId?: string | undefined;
  readonly sourceCitation?: string | undefined;
}

/**
 * Flattens a recursive mindmap tree into a list of items with depth and parent/child references.
 */
export function flattenMindmapTree(root: MindmapNode): FlatMindmapNode[] {
  const result: FlatMindmapNode[] = [];

  function traverse(node: MindmapNode, parentId: string | null, depth: number) {
    const childIds = (node.children ?? []).map((c) => c.id);
    result.push({
      id: node.id,
      label: node.label,
      depth,
      parentId,
      childIds,
      ...(node.sourceId ? { sourceId: node.sourceId } : {}),
      ...(node.chunkId ? { chunkId: node.chunkId } : {}),
      ...(node.sourceCitation ? { sourceCitation: node.sourceCitation } : {})
    });

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        traverse(child, node.id, depth + 1);
      }
    }
  }

  traverse(root, null, 0);
  return result;
}

// ---------------------------------------------------------------------------
// 2. Flashcards Models & Schemas (Sub-Issue #123)
// ---------------------------------------------------------------------------

export const FlashcardItemSchema = z.object({
  id: z.string().min(1).optional(),
  front: z.string().min(1),
  back: z.string().min(1),
  sourceHint: z.string().optional(),
  sourceId: z.string().optional(),
  chunkId: z.string().optional(),
  tags: z.array(z.string()).optional()
});
export type FlashcardItem = z.infer<typeof FlashcardItemSchema>;

export const FlashcardsArtifactPayloadSchema = z.object({
  cards: z.array(FlashcardItemSchema)
});
export type FlashcardsArtifactPayload = z.infer<typeof FlashcardsArtifactPayloadSchema>;

/**
 * Formats flashcards into an Anki-compatible CSV string with UTF-8 BOM,
 * tab separation and optional tag column.
 */
export function serializeFlashcardsToAnkiCsv(
  cards: readonly FlashcardItem[],
  options?: { readonly defaultTag?: string | undefined }
): string {
  const UTF8_BOM = "\uFEFF";
  const rows: string[] = ["#separator:tab", "#html:true", "#tags column:3"];

  for (const card of cards) {
    const frontEscaped = card.front.replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
    let backContent = card.back.replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
    if (card.sourceHint) {
      const hint = card.sourceHint.replace(/\t/g, " ").replace(/\r?\n/g, " ");
      backContent += `<br><small class="source-hint">Quelle: ${hint}</small>`;
    }

    const tagList =
      card.tags && card.tags.length > 0
        ? card.tags.map((t) => t.trim().replace(/\s+/g, "_")).join(" ")
        : (options?.defaultTag ?? "relationnotes_flashcard");

    rows.push(`${frontEscaped}\t${backContent}\t${tagList}`);
  }

  return UTF8_BOM + rows.join("\n");
}

// ---------------------------------------------------------------------------
// 3. Quiz Models & Schemas (Sub-Issue #123)
// ---------------------------------------------------------------------------

export const QuizQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(2),
  correctAnswerIndex: z.number().int().min(0),
  explanation: z.string().min(1),
  sourceCitation: z.string().optional(),
  sourceId: z.string().optional(),
  chunkId: z.string().optional()
});
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const QuizArtifactPayloadSchema = z.object({
  questions: z.array(QuizQuestionSchema)
});
export type QuizArtifactPayload = z.infer<typeof QuizArtifactPayloadSchema>;

export interface QuizEvaluationResult {
  readonly totalQuestions: number;
  readonly answeredCount: number;
  readonly correctCount: number;
  readonly incorrectCount: number;
  readonly scorePercentage: number;
  readonly isComplete: boolean;
  readonly details: readonly {
    readonly questionId: string;
    readonly selectedIndex: number | null;
    readonly correctIndex: number;
    readonly isCorrect: boolean;
  }[];
}

/**
 * Evaluates user answers against a list of quiz questions.
 */
export function evaluateQuiz(
  questions: readonly QuizQuestion[],
  userAnswers: Readonly<Record<string, number>>
): QuizEvaluationResult {
  let correctCount = 0;
  let answeredCount = 0;

  const details = questions.map((q) => {
    const selected = userAnswers[q.id];
    const hasAnswered = selected !== undefined && selected !== null;
    if (hasAnswered) {
      answeredCount++;
    }
    const isCorrect = hasAnswered && selected === q.correctAnswerIndex;
    if (isCorrect) {
      correctCount++;
    }

    return {
      questionId: q.id,
      selectedIndex: hasAnswered ? selected : null,
      correctIndex: q.correctAnswerIndex,
      isCorrect
    };
  });

  const totalQuestions = questions.length;
  const incorrectCount = answeredCount - correctCount;
  const scorePercentage =
    totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
  const isComplete = answeredCount === totalQuestions && totalQuestions > 0;

  return {
    totalQuestions,
    answeredCount,
    correctCount,
    incorrectCount,
    scorePercentage,
    isComplete,
    details
  };
}

// ---------------------------------------------------------------------------
// 4. Briefing, FAQ & Timeline Models & Schemas (Sub-Issue #124)
// ---------------------------------------------------------------------------

export const BriefingArtifactPayloadSchema = z.object({
  executiveSummary: z.string().min(1),
  keyTakeaways: z.array(z.string().min(1)),
  actionItems: z.array(z.string().min(1))
});
export type BriefingArtifactPayload = z.infer<typeof BriefingArtifactPayloadSchema>;

export const FAQItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  sourceHint: z.string().optional()
});
export type FAQItem = z.infer<typeof FAQItemSchema>;

export const FAQArtifactPayloadSchema = z.object({
  faqs: z.array(FAQItemSchema)
});
export type FAQArtifactPayload = z.infer<typeof FAQArtifactPayloadSchema>;

export const TimelineEventSchema = z.object({
  dateOrPhase: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  sourceHint: z.string().optional()
});
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;

export const TimelineArtifactPayloadSchema = z.object({
  events: z.array(TimelineEventSchema)
});
export type TimelineArtifactPayload = z.infer<typeof TimelineArtifactPayloadSchema>;

/**
 * Formats an Executive Briefing into structured Markdown.
 */
export function formatBriefingToMarkdown(
  briefing: BriefingArtifactPayload,
  title = "Executive Briefing"
): string {
  const lines: string[] = [
    `# ${title}`,
    "",
    "## Zusammenfassung",
    briefing.executiveSummary,
    "",
    "## Kern-Erkenntnisse (Key Takeaways)"
  ];

  for (const takeaway of briefing.keyTakeaways) {
    lines.push(`- ${takeaway}`);
  }

  lines.push("", "## Handlungsempfehlungen (Action Items)");
  for (const item of briefing.actionItems) {
    lines.push(`1. ${item}`);
  }

  return lines.join("\n");
}

/**
 * Formats FAQs into structured Markdown.
 */
export function formatFAQToMarkdown(
  faqPayload: FAQArtifactPayload,
  title = "Häufig gestellte Fragen (FAQ)"
): string {
  const lines: string[] = [`# ${title}`, ""];

  for (const item of faqPayload.faqs) {
    lines.push(`### ${item.question}`);
    lines.push(item.answer);
    if (item.sourceHint) {
      lines.push(`*Quelle: ${item.sourceHint}*`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/**
 * Formats a chronological Timeline into structured Markdown.
 */
export function formatTimelineToMarkdown(
  timelinePayload: TimelineArtifactPayload,
  title = "Chronologische Timeline"
): string {
  const lines: string[] = [`# ${title}`, ""];

  for (const event of timelinePayload.events) {
    lines.push(`### ${event.dateOrPhase}: ${event.title}`);
    lines.push(event.description);
    if (event.sourceHint) {
      lines.push(`*Quelle: ${event.sourceHint}*`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/**
 * Formats documents into print-optimized HTML for PDF export.
 */
export function formatArtifactToPrintHtml(params: {
  readonly title: string;
  readonly markdownContent: string;
}): string {
  // Simple clean HTML wrapper with print stylesheet
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(params.title)}</title>
  <style>
    @page {
      size: A4;
      margin: 20mm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.6;
      color: #1a202c;
      background: #ffffff;
      padding: 0;
      margin: 0;
    }
    h1 {
      font-size: 24pt;
      margin-bottom: 12pt;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 6pt;
    }
    h2 {
      font-size: 16pt;
      margin-top: 18pt;
      margin-bottom: 8pt;
      color: #2b6cb0;
    }
    h3 {
      font-size: 13pt;
      margin-top: 14pt;
      margin-bottom: 4pt;
    }
    p, li {
      font-size: 11pt;
    }
    ul, ol {
      margin-top: 4pt;
      margin-bottom: 12pt;
      padding-left: 20pt;
    }
    @media print {
      body {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="document-content">
    <pre style="white-space: pre-wrap; font-family: inherit;">${escapeHtml(params.markdownContent)}</pre>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
