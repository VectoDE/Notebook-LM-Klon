import { z } from "zod";

/**
 * Gemischtes Quiz (Issue #242): wählbare Anzahl und vier Fragetypen.
 *
 * - Multiple Choice: genau eine richtige Option
 * - Richtig/Falsch: Aussage prüfen
 * - Zuordnung: linke Begriffe den rechten zuordnen, Teilpunkte je Paar
 * - Freitext: Bewertung durch die KI mit Begründung und Quelle
 *
 * Die Auswertung ist deterministisch. Freitext gilt als offen, bis eine
 * Bewertung vorliegt; nichts wird geraten.
 */

export const QUIZ_COUNT_MIN = 5;
export const QUIZ_COUNT_MAX = 20;
export const QUIZ_COUNT_DEFAULT = 10;

/** Begrenzt die gewünschte Anzahl auf 5 bis 20; ohne gültige Angabe gilt 10. */
export function clampQuizCount(count?: number | null): number {
  if (typeof count !== "number" || !Number.isFinite(count)) {
    return QUIZ_COUNT_DEFAULT;
  }
  return Math.min(QUIZ_COUNT_MAX, Math.max(QUIZ_COUNT_MIN, Math.round(count)));
}

export const QUIZ_ITEM_TYPES = ["multiple-choice", "true-false", "matching", "free-text"] as const;
export type QuizItemType = (typeof QUIZ_ITEM_TYPES)[number];

/** Verteilt die Fragetypen gleichmäßig, damit jedes Quiz alle vier enthält. */
export function planQuizItemTypes(count?: number | null): QuizItemType[] {
  const total = clampQuizCount(count);
  return Array.from(
    { length: total },
    (_, index) => QUIZ_ITEM_TYPES[index % QUIZ_ITEM_TYPES.length] as QuizItemType
  );
}

const QuizItemBaseSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  explanation: z.string().min(1),
  sourceCitation: z.string().optional(),
  sourceId: z.string().optional(),
  page: z.number().int().positive().optional()
});

export const MultipleChoiceItemSchema = QuizItemBaseSchema.extend({
  type: z.literal("multiple-choice"),
  options: z.array(z.string().min(1)).min(2),
  correctAnswerIndex: z.number().int().min(0)
}).refine((item) => item.correctAnswerIndex < item.options.length, {
  message: "correctAnswerIndex liegt außerhalb der Optionen",
  path: ["correctAnswerIndex"]
});

export const TrueFalseItemSchema = QuizItemBaseSchema.extend({
  type: z.literal("true-false"),
  correctAnswer: z.boolean()
});

export const MatchingItemSchema = QuizItemBaseSchema.extend({
  type: z.literal("matching"),
  pairs: z
    .array(z.object({ left: z.string().min(1), right: z.string().min(1) }))
    .min(2)
    .refine((pairs) => new Set(pairs.map((pair) => pair.left)).size === pairs.length, {
      message: "Linke Begriffe müssen eindeutig sein"
    })
});

export const FreeTextItemSchema = QuizItemBaseSchema.extend({
  type: z.literal("free-text"),
  referenceAnswer: z.string().min(1)
});

export const MixedQuizItemSchema = z.union([
  MultipleChoiceItemSchema,
  TrueFalseItemSchema,
  MatchingItemSchema,
  FreeTextItemSchema
]);
export type MixedQuizItem = z.infer<typeof MixedQuizItemSchema>;

export const MixedQuizPayloadSchema = z.object({
  items: z.array(MixedQuizItemSchema).min(QUIZ_COUNT_MIN).max(QUIZ_COUNT_MAX)
});
export type MixedQuizPayload = z.infer<typeof MixedQuizPayloadSchema>;

/** Ergebnis der KI-Bewertung einer Freitextantwort. */
export const FreeTextGradeSchema = z.object({
  verdict: z.enum(["correct", "partial", "incorrect"]),
  score: z.number().min(0).max(1),
  reasoning: z.string().min(1),
  sourceCitation: z.string().min(1),
  sourceId: z.string().optional(),
  page: z.number().int().positive().optional()
});
export type FreeTextGrade = z.infer<typeof FreeTextGradeSchema>;

export type MixedQuizAnswer =
  | { readonly type: "multiple-choice"; readonly selectedIndex: number }
  | { readonly type: "true-false"; readonly value: boolean }
  | { readonly type: "matching"; readonly matches: Readonly<Record<string, string>> }
  | { readonly type: "free-text"; readonly text: string; readonly grade?: FreeTextGrade };

export type QuizItemStatus = "correct" | "partial" | "incorrect" | "unanswered" | "pending";

export interface MixedQuizItemResult {
  readonly itemId: string;
  readonly type: QuizItemType;
  readonly status: QuizItemStatus;
  /** Punkte zwischen 0 und 1; bei offener Freitextbewertung null. */
  readonly score: number | null;
  readonly reasoning?: string;
  readonly sourceCitation?: string;
}

export interface MixedQuizResult {
  readonly totalItems: number;
  readonly answeredCount: number;
  readonly pendingCount: number;
  readonly points: number;
  readonly scorePercentage: number;
  readonly isComplete: boolean;
  readonly details: readonly MixedQuizItemResult[];
}

function statusFromScore(score: number): QuizItemStatus {
  if (score >= 1) return "correct";
  if (score <= 0) return "incorrect";
  return "partial";
}

/** Bewertet eine einzelne Antwort. Falscher Antworttyp zählt als falsch. */
export function evaluateQuizItem(
  item: MixedQuizItem,
  answer: MixedQuizAnswer | undefined
): MixedQuizItemResult {
  const base = { itemId: item.id, type: item.type };
  if (answer === undefined) {
    return { ...base, status: "unanswered", score: 0 };
  }
  if (answer.type !== item.type) {
    return { ...base, status: "incorrect", score: 0 };
  }

  let score: number;
  if (item.type === "multiple-choice") {
    const choice = answer as Extract<MixedQuizAnswer, { type: "multiple-choice" }>;
    score = choice.selectedIndex === item.correctAnswerIndex ? 1 : 0;
  } else if (item.type === "true-false") {
    const statement = answer as Extract<MixedQuizAnswer, { type: "true-false" }>;
    score = statement.value === item.correctAnswer ? 1 : 0;
  } else if (item.type === "matching") {
    const matching = answer as Extract<MixedQuizAnswer, { type: "matching" }>;
    const hits = item.pairs.filter((pair) => matching.matches[pair.left] === pair.right).length;
    score = hits / item.pairs.length;
  } else {
    const freeText = answer as Extract<MixedQuizAnswer, { type: "free-text" }>;
    if (freeText.text.trim() === "") {
      return { ...base, status: "unanswered", score: 0 };
    }
    if (freeText.grade === undefined) {
      return { ...base, status: "pending", score: null };
    }
    return {
      ...base,
      status: freeText.grade.verdict,
      score: freeText.grade.score,
      reasoning: freeText.grade.reasoning,
      sourceCitation: freeText.grade.sourceCitation
    };
  }
  return { ...base, status: statusFromScore(score), score };
}

/** Wertet ein gemischtes Quiz aus; Prozent beziehen sich auf alle Fragen. */
export function evaluateMixedQuiz(
  items: readonly MixedQuizItem[],
  answers: Readonly<Record<string, MixedQuizAnswer>>
): MixedQuizResult {
  const details = items.map((item) => evaluateQuizItem(item, answers[item.id]));
  const answeredCount = details.filter((detail) => detail.status !== "unanswered").length;
  const pendingCount = details.filter((detail) => detail.status === "pending").length;
  const points = details.reduce((sum, detail) => sum + (detail.score ?? 0), 0);
  const totalItems = items.length;
  return {
    totalItems,
    answeredCount,
    pendingCount,
    points: Math.round(points * 100) / 100,
    scorePercentage: totalItems > 0 ? Math.round((points / totalItems) * 100) : 0,
    isComplete: totalItems > 0 && answeredCount === totalItems && pendingCount === 0,
    details
  };
}
