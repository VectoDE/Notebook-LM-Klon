import { type ProblemDetails, countWords, createProblemDetails } from "@notebook-lm/shared";

export const SOURCE_WORD_LIMIT_CODE = "SOURCE_WORD_LIMIT";

/**
 * Prüft die Wortzahl einer Quelle gegen die Grenze des Profils.
 * Genau die Grenze ist erlaubt, ein Wort mehr wird abgelehnt.
 */
export function exceedsWordLimit(wordCount: number, limit: number): boolean {
  return wordCount > limit;
}

/** Zählt Wörter und prüft gegen die Grenze, ohne das Wort-Array anzulegen. */
export function checkTextWordLimit(
  text: string,
  limit: number
): { readonly wordCount: number; readonly exceeded: boolean } {
  const wordCount = countWords(text);
  return { wordCount, exceeded: exceedsWordLimit(wordCount, limit) };
}

/** RFC-9457-Antwort (Status 413) für eine Quelle über der Wortgrenze. */
export function sourceWordLimitProblem(
  wordCount: number,
  limit: number,
  instance: string
): ProblemDetails {
  return createProblemDetails({
    status: 413,
    title: "Payload Too Large",
    detail: `Die Quelle hat ${wordCount.toLocaleString("de-DE")} Wörter und überschreitet das Limit von ${limit.toLocaleString("de-DE")} Wörtern pro Quelle.`,
    instance,
    code: SOURCE_WORD_LIMIT_CODE
  });
}
